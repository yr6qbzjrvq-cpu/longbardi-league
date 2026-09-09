import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood, sameOrigin } from "@/lib/neighborhoodAccess";
import { ROOMS, getRoom } from "@/lib/neighborhood/rooms";
import {
  TABLE,
  PLAYER_ID_RE,
  activeBan,
  broadcastToRoom,
} from "@/lib/neighborhood/multiplayerServer";
import {
  PARTY_DURATION_MS,
  PARTY_COOLDOWN_MS,
} from "@/lib/neighborhood/party";

export const dynamic = "force-dynamic";

// ============================================================
// POST /api/neighborhood/party — "somebody hit the big red
// button behind the bar".
// ------------------------------------------------------------
// Same shape as /throw, for the same reason: clients cannot
// publish on the gameplay topic, so a party only exists because
// this route validated one and broadcast it. The client sends
// NOTHING but its own id — the room, the timestamp and the
// party id are all the server's, which is what makes every
// browser in the room build the identical light show (the
// confetti is seeded off the id; see lib/neighborhood/party.js).
//
// Three gates, in order:
//   • the presser has to be an active, unbanned player standing
//     in a room that actually HAS a button (today: the Sports
//     Bar, by way of `partyButton` in the room registry — add
//     the key to another room and it works there with no change
//     here)
//   • one press per player per 20s
//   • while a party is running in that room, extra presses do
//     nothing rather than restarting the show
//
// The last two are one atomic, row-locked, room-serialised SQL
// call (neighborhood_record_party). If that function has not
// been installed yet the route degrades to a per-lambda
// in-memory version rather than 500ing — see FALLBACK below.
//
// MUTED PLAYERS MAY STILL PRESS IT. Mute is the CHAT sanction;
// pressing a button is a gesture, exactly like a tomato. A kick
// still blocks everything. Nothing is written to
// neighborhood_messages: a party is ephemeral and leaves no
// moderation trail.
// ============================================================

// FALLBACK, used only while neighborhood_record_party is
// missing from the database. Per lambda instance, so it is
// weaker than the Postgres one (a cold start forgets it) — but
// it still stops the obvious hold-the-button spam, and the SQL
// function takes over the moment it exists.
const memoryPresses = new Map(); // playerId -> last press ms
const memoryRooms = new Map(); // roomId -> last party start ms

function memoryGate(playerId, roomId, now) {
  const mine = memoryPresses.get(playerId) || 0;
  if (now - mine < PARTY_COOLDOWN_MS) return "rate_limited";
  const room = memoryRooms.get(roomId) || 0;
  if (now - room < PARTY_DURATION_MS) return "party_running";
  memoryPresses.set(playerId, now);
  memoryRooms.set(roomId, now);
  if (memoryPresses.size > 500) {
    for (const [k, v] of memoryPresses) {
      if (now - v > 60_000) memoryPresses.delete(k);
    }
  }
  return "ok";
}

export async function POST(request) {
  if (!(await canSeeNeighborhood())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Bad origin." }, { status: 403 });
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

    const { data: row, error: readErr } = await supabase
      .from(TABLE)
      .select("id, username, room, kicked_until")
      .eq("id", playerId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row || !ROOMS[row.room]) {
      return NextResponse.json(
        { error: "Join the room first.", code: "not_joined" },
        { status: 404 }
      );
    }
    const ban = activeBan(row);
    if (ban) {
      return NextResponse.json(
        { error: ban.message, code: "kicked", until: ban.until },
        { status: 403 }
      );
    }

    // Config decides which rooms have a button, not this file.
    const room = getRoom(row.room);
    if (!room || !room.partyButton) {
      return NextResponse.json(
        { error: "There's no button in here.", code: "no_button" },
        { status: 400 }
      );
    }

    const now = Date.now();

    let gate = null;
    const { data: rpcGate, error: gateErr } = await supabase.rpc(
      "neighborhood_record_party",
      {
        p_id: playerId,
        p_room: row.room,
        p_now_ms: now,
        p_cooldown_ms: PARTY_COOLDOWN_MS,
        p_party_ms: PARTY_DURATION_MS,
      }
    );
    if (gateErr) {
      const missing =
        gateErr.code === "42883" ||
        gateErr.code === "PGRST202" ||
        /could not find the function|does not exist/i.test(gateErr.message || "");
      if (!missing) throw gateErr;
      gate = memoryGate(playerId, row.room, now);
    } else {
      gate = rpcGate;
    }

    if (gate === "not_joined") {
      return NextResponse.json(
        { error: "Join the room first.", code: "not_joined" },
        { status: 404 }
      );
    }
    if (gate === "party_running") {
      // Not an error the player did anything about — the show
      // they are already watching IS the answer.
      return NextResponse.json(
        { ok: true, code: "party_running", running: true, serverNow: now },
        { status: 200 }
      );
    }
    if (gate === "rate_limited") {
      return NextResponse.json(
        {
          error: "Easy on the button — give it a minute.",
          code: "rate_limited",
        },
        { status: 429 }
      );
    }

    const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const wire = {
      id,
      playerId,
      username: row.username,
      room: row.room,
      at: now,
      durationMs: PARTY_DURATION_MS,
    };

    await supabase
      .from(TABLE)
      .update({ last_seen: new Date(now).toISOString() })
      .eq("id", playerId);

    await broadcastToRoom(row.room, "party", wire);

    return NextResponse.json({ ok: true, party: wire, serverNow: now });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
