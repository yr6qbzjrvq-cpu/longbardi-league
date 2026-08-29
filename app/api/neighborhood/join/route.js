import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood } from "@/lib/neighborhoodAccess";
import { validateUsername } from "@/lib/neighborhoodPlayer";
import { normalizeAvatar } from "@/lib/neighborhoodAvatar";
import { ROOMS } from "@/lib/neighborhood/rooms";
import { currentPosition } from "@/lib/neighborhood/movement";
import {
  TABLE,
  PLAYER_ID_RE,
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
// Errors carry a machine `code` the client routes on:
// bad_name / room_full / name_taken.
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

    // Tidy first so dead rows never hold a name or a seat.
    await pruneStale(supabase);

    const { data: active, error: readErr } = await supabase
      .from(TABLE)
      .select("id, username, room, x, y, path, path_started_at")
      .gte("last_seen", activeCutoffIso());
    if (readErr) throw readErr;

    const self = (active || []).find((r) => r.id === playerId) || null;
    const othersInRoom = (active || []).filter(
      (r) => r.room === roomId && r.id !== playerId
    );

    if (!self && othersInRoom.length >= room.capacity) {
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
    // Rejoin keeps your spot (snapped to the deterministic
    // current position, walk cancelled); fresh join spawns.
    const pos = self ? currentPosition(self, now) : { ...room.spawn };
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

    const players = (await listActivePlayers(supabase, roomId)).map(toWirePlayer);
    return NextResponse.json({ ok: true, serverNow: now, roomId, players });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
