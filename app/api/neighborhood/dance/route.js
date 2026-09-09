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
  DANCE_CYCLE_MS,
  DANCE_FLOOD_WINDOW_MS,
  DANCE_FLOOD_MAX,
} from "@/lib/neighborhood/dance";

export const dynamic = "force-dynamic";

// ============================================================
// POST /api/neighborhood/dance — "start dancing" and "stop
// dancing" (milestones 26, 27).
// ------------------------------------------------------------
// Milestone 26 broadcast a three and a half second clip.
// Milestone 27 turned a dance into a STATE with no end time, so
// this route has two jobs now instead of one:
//
//   { action: "start" }  park a dance on the player's row and
//                        tell the room
//   { action: "stop" }   take it off the row and tell the room
//
// Same shape as /throw and /party, for the same reason: clients
// cannot publish on the gameplay topic, so a dance only exists
// because this route validated one and broadcast it. The client
// still sends NOTHING but its own id and which of the two
// things it wants — the room, the timestamp and the dance id
// are all the server's, which is what makes every browser in
// the room loop the identical routine on the identical frame
// (the routine variant is hashed off the id; see
// lib/neighborhood/dance.js).
//
// WHY IT IS ON THE ROW NOW: an event can live in one broadcast.
// A state cannot. dance_id/dance_at on neighborhood_players is
// what lets somebody who walks in late pick up a dance already
// in progress, lets a reconnect heal a `dance_stop` it never
// heard, and lets the ordinary stale prune sweep away a dancer
// who danced off into a closed laptop.
//
// THERE IS NO COOLDOWN, and there must not be one: start, stop,
// start again on the very next frame is the whole point of the
// milestone. A redundant start is answered 'already_dancing'
// with the running dance attached — an ok, not an error. The
// only refusal left is a flood guard sized for scripts rather
// than for hands (DANCE_FLOOD_MAX starts per
// DANCE_FLOOD_WINDOW_MS).
//
// MUTED PLAYERS MAY STILL DANCE. Mute is the CHAT sanction;
// dancing is a gesture, exactly like a tomato. A kick still
// blocks it. Nothing is written to neighborhood_messages: a
// dance leaves no moderation trail.
// ============================================================

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
    // Anything that is not an explicit "stop" is a start, so a
    // tab left open across the deploy — which sends a playerId
    // and nothing else — still dances instead of erroring.
    const stopping = String(body.action || "start") === "stop";
    if (!PLAYER_ID_RE.test(playerId)) {
      return NextResponse.json(
        { error: "Bad player id.", code: "bad_player" },
        { status: 400 }
      );
    }

    const { data: row, error: readErr } = await supabase
      .from(TABLE)
      .select("id, username, room, kicked_until, dance_id, dance_at")
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
    const id = stopping
      ? null
      : `${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

    // One atomic, row-locked SQL call does all of it: flips the
    // state, keeps the flood window, and reports the two no-op
    // cases rather than pretending they happened.
    const { data: gate, error: gateErr } = await supabase.rpc(
      "neighborhood_record_dance",
      {
        p_id: playerId,
        p_now_ms: now,
        p_action: stopping ? "stop" : "start",
        p_dance_id: id,
        p_window_ms: DANCE_FLOOD_WINDOW_MS,
        p_max: DANCE_FLOOD_MAX,
      }
    );
    if (gateErr) throw gateErr;

    if (gate === "not_joined") {
      return NextResponse.json(
        { error: "Join the room first.", code: "not_joined" },
        { status: 404 }
      );
    }
    if (gate === "rate_limited") {
      return NextResponse.json(
        { error: "Easy on the dance button.", code: "rate_limited" },
        { status: 429 }
      );
    }

    await supabase
      .from(TABLE)
      .update({ last_seen: new Date(now).toISOString() })
      .eq("id", playerId);

    // ---- stop ------------------------------------------------
    if (stopping) {
      // Nothing was running. Stay quiet on the wire: the room
      // already believes exactly what we would be telling it.
      if (gate === "not_dancing") {
        return NextResponse.json({
          ok: true,
          code: "not_dancing",
          serverNow: now,
        });
      }
      await broadcastToRoom(row.room, "dance_stop", {
        playerId,
        room: row.room,
        at: now,
      });
      return NextResponse.json({ ok: true, code: "stopped", serverNow: now });
    }

    // ---- start -----------------------------------------------
    // Already dancing: hand back the dance that is RUNNING
    // instead of starting a second one, so a double tap (or a
    // retry) cannot restart the routine underneath the room.
    if (gate === "already_dancing") {
      return NextResponse.json({
        ok: true,
        code: "already_dancing",
        dance: {
          id: row.dance_id,
          playerId,
          username: row.username,
          room: row.room,
          at: Number(row.dance_at) || now,
          cycleMs: DANCE_CYCLE_MS,
        },
        serverNow: now,
      });
    }

    const wire = {
      id,
      playerId,
      username: row.username,
      room: row.room,
      at: now,
      cycleMs: DANCE_CYCLE_MS,
    };

    await broadcastToRoom(row.room, "dance", wire);

    return NextResponse.json({ ok: true, dance: wire, serverNow: now });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
