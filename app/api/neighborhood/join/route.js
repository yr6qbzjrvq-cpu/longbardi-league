import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood } from "@/lib/neighborhoodAccess";
import { validateUsername } from "@/lib/neighborhoodPlayer";
import { normalizeAvatar } from "@/lib/neighborhoodAvatar";
import { ROOMS } from "@/lib/neighborhood/rooms";
import { currentPosition } from "@/lib/neighborhood/movement";
import { getNavGrid, nearestWalkable } from "@/lib/neighborhood/pathing";
import {
  TABLE,
  PLAYER_ID_RE,
  activeBan,
  broadcastToRoom,
  pruneStale,
  listActivePlayers,
  activeCutoffIso,
  toWirePlayer,
} from "@/lib/neighborhood/multiplayerServer";

export const dynamic = "force-dynamic";

// ============================================================
// POST /api/neighborhood/join — enter (or re-enter) a room.
// ------------------------------------------------------------
// Claims the username against everyone ACTIVE right now
// (case-insensitive — the uniqueness enforcement deferred from
// milestone 1's neighborhoodPlayer notes), enforces the room
// capacity cap, and upserts the player row. Rejoining with the
// same playerId is idempotent and keeps your spot (walk state
// snaps to the current deterministic position) so a refresh or
// websocket resync never teleports you or leaves a ghost row.
// Joining a DIFFERENT room moves you through the door
// (milestone 6): capacity is enforced on the target room, you
// appear at its spawn (or the validated `entry` door point),
// and the room you left gets a "leave" broadcast so nobody
// ghosts there. A live timed ban (milestone 7: the kicked row
// lingers as the ban record) bounces the join with code
// "kicked" before anything else. Errors carry a machine `code`
// the client routes on: bad_name / room_full / name_taken /
// bad_room / kicked.
// ============================================================

export async function POST(request) {
  if (!(await canSeeNeighborhood())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const supabase = getAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Multiplayer is not configured.", code: "not_configured" },
        { status: 503 }
      );
    }

    const body = await request.json();
    const playerId = String(body.playerId || "");
    if (!PLAYER_ID_RE.test(playerId)) {
      return NextResponse.json(
        { error: "Bad player id.", code: "bad_player" },
        { status: 400 }
      );
    }
    const v = validateUsername(body.username);
    if (!v.ok) {
      return NextResponse.json({ error: v.error, code: "bad_name" }, { status: 400 });
    }
    const roomId = String(body.roomId || "");
    const room = ROOMS[roomId];
    if (!room) {
      return NextResponse.json(
        { error: "Unknown room.", code: "bad_room" },
        { status: 400 }
      );
    }

    // Tidy first so dead rows never hold a name or a seat
    // (rows with a live ban survive the prune on purpose).
    await pruneStale(supabase);

    // Serving a timeout? The door stays shut until it lapses.
    const { data: myRow, error: myErr } = await supabase
      .from(TABLE)
      .select("id, kicked_until")
      .eq("id", playerId)
      .maybeSingle();
    if (myErr) throw myErr;
    const ban = activeBan(myRow);
    if (ban) {
      return NextResponse.json(
        { error: ban.message, code: "kicked", until: ban.until },
        { status: 403 }
      );
    }

    const { data: active, error: readErr } = await supabase
      .from(TABLE)
      .select("id, username, room, x, y, path, path_started_at")
      .gte("last_seen", activeCutoffIso());
    if (readErr) throw readErr;

    const self = (active || []).find((r) => r.id === playerId) || null;
    const othersInRoom = (active || []).filter(
      (r) => r.room === roomId && r.id !== playerId
    );

    const changingRooms = !!self && self.room !== roomId;

    // Full rooms bounce newcomers AND door-hoppers (a bounced
    // door-hopper's row still sits safely in the old room).
    if ((!self || changingRooms) && othersInRoom.length >= room.capacity) {
      return NextResponse.json(
        {
          error: `${room.name} is full right now (${room.capacity} max). Try again in a bit.`,
          code: "room_full",
        },
        { status: 409 }
      );
    }

    const wanted = v.value.toLowerCase();
    const clash = (active || []).find(
      (r) => r.id !== playerId && String(r.username).toLowerCase() === wanted
    );
    if (clash) {
      return NextResponse.json(
        {
          error: `"${v.value}" is taken by someone in the neighborhood right now. Pick another name.`,
          code: "name_taken",
        },
        { status: 409 }
      );
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    // Rejoin in the SAME room keeps your spot (snapped to the
    // deterministic current position, walk cancelled). A fresh
    // join — or stepping through a door from another room —
    // spawns at the room's spawn point, or at the validated
    // `entry` point (the interior side of the door they used).
    let pos;
    if (self && !changingRooms) {
      pos = currentPosition(self, now);
    } else {
      pos = { ...room.spawn };
      const ex = Number(body.entry && body.entry.x);
      const ey = Number(body.entry && body.entry.y);
      if (Number.isFinite(ex) && Number.isFinite(ey)) {
        const spot = nearestWalkable(room, getNavGrid(room), ex, ey);
        if (spot && Math.hypot(spot.x - ex, spot.y - ey) <= 120) {
          pos = spot;
        }
      }
    }
    const row = {
      id: playerId,
      username: v.value,
      avatar: normalizeAvatar(body.avatar),
      room: roomId,
      x: pos.x,
      y: pos.y,
      path: [],
      path_started_at: null,
      last_seen: nowIso,
      kicked_until: null, // a lapsed ban is spent — clear it
    };
    const { error: upsertErr } = await supabase.from(TABLE).upsert(row);
    if (upsertErr) {
      // 23505 = the case-insensitive unique index beat us in a
      // race between the check above and the write.
      if (upsertErr.code === "23505") {
        return NextResponse.json(
          {
            error: `"${v.value}" is taken by someone in the neighborhood right now. Pick another name.`,
            code: "name_taken",
          },
          { status: 409 }
        );
      }
      throw upsertErr;
    }

    // Tell the room we just left so its players drop our
    // avatar immediately (the presence-leave lands later, when
    // the mover unsubscribes the old channel).
    if (changingRooms) {
      await broadcastToRoom(self.room, "leave", { id: playerId });
    }

    const players = (await listActivePlayers(supabase, roomId)).map(toWirePlayer);
    return NextResponse.json({ ok: true, serverNow: now, roomId, players });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
