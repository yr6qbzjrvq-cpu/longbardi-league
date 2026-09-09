import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood, sameOrigin } from "@/lib/neighborhoodAccess";
import { ROOMS } from "@/lib/neighborhood/rooms";
import {
  TABLE,
  PLAYER_ID_RE,
  activeBan,
  broadcastToRoom,
} from "@/lib/neighborhood/multiplayerServer";
import {
  DANCE_DURATION_MS,
  DANCE_COOLDOWN_MS,
} from "@/lib/neighborhood/dance";

export const dynamic = "force-dynamic";

// ============================================================
// POST /api/neighborhood/dance — "somebody hit the dance
// button" (milestone 26).
// ------------------------------------------------------------
// Same shape as /throw and /party, for the same reason: clients
// cannot publish on the gameplay topic, so a dance only exists
// because this route validated one and broadcast it. The client
// sends NOTHING but its own id — the room, the timestamp and
// the dance id are all the server's, which is what makes every
// browser in the room play the identical routine on the
// identical frame (the routine variant is hashed off the id;
// see lib/neighborhood/dance.js).
//
// Two gates, in order:
//   • the dancer has to be an active, unbanned player standing
//     in a real room — and EVERY room qualifies, which is the
//     one deliberate difference from the party button. You can
//     dance in the Town Square, in the Dairy, on the casino
//     floor. There is no room registry key to add.
//   • one dance per player per DANCE_COOLDOWN_MS
//
// The rate limit is one atomic, row-locked SQL call
// (neighborhood_record_dance). If that function has not been
// installed yet the route degrades to a per-lambda in-memory
// version rather than 500ing — see FALLBACK below.
//
// MUTED PLAYERS MAY STILL DANCE. Mute is the CHAT sanction;
// dancing is a gesture, exactly like a tomato. A kick still
// blocks everything. Nothing is written to
// neighborhood_messages: a dance is ephemeral and leaves no
// moderation trail.
// ============================================================

// FALLBACK, used only while neighborhood_record_dance is
// missing from the database. Per lambda instance, so it is
// weaker than the Postgres one (a cold start forgets it) — but
// it still stops the obvious hold-the-button spam, and the SQL
// function takes over the moment it exists.
const memoryDances = new Map(); // playerId -> last dance ms

function memoryGate(playerId, now) {
  const mine = memoryDances.get(playerId) || 0;
  if (now - mine < DANCE_COOLDOWN_MS) return "rate_limited";
  memoryDances.set(playerId, now);
  if (memoryDances.size > 500) {
    for (const [k, v] of memoryDances) {
      if (now - v > 60_000) memoryDances.delete(k);
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

    const now = Date.now();

    let gate = null;
    const { data: rpcGate, error: gateErr } = await supabase.rpc(
      "neighborhood_record_dance",
      {
        p_id: playerId,
        p_now_ms: now,
        p_cooldown_ms: DANCE_COOLDOWN_MS,
      }
    );
    if (gateErr) {
      const missing =
        gateErr.code === "42883" ||
        gateErr.code === "PGRST202" ||
        /could not find the function|does not exist/i.test(gateErr.message || "");
      if (!missing) throw gateErr;
      gate = memoryGate(playerId, now);
    } else {
      gate = rpcGate;
    }

    if (gate === "not_joined") {
      return NextResponse.json(
        { error: "Join the room first.", code: "not_joined" },
        { status: 404 }
      );
    }
    if (gate === "rate_limited") {
      return NextResponse.json(
        {
          error: "Catch your breath — one dance at a time.",
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
      durationMs: DANCE_DURATION_MS,
    };

    await supabase
      .from(TABLE)
      .update({ last_seen: new Date(now).toISOString() })
      .eq("id", playerId);

    await broadcastToRoom(row.room, "dance", wire);

    return NextResponse.json({ ok: true, dance: wire, serverNow: now });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
