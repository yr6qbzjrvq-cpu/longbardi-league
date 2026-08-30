import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood } from "@/lib/neighborhoodAccess";
import { ROOMS } from "@/lib/neighborhood/rooms";
import { validateChatText } from "@/lib/neighborhood/chat";
import {
  TABLE,
  PLAYER_ID_RE,
  activeBan,
  broadcastToRoom,
} from "@/lib/neighborhood/multiplayerServer";

export const dynamic = "force-dynamic";

// ============================================================
// /api/neighborhood/chat — say something in the room.
// ------------------------------------------------------------
// POST: validate (plain text only, 200-char cap, the same
// keep-it-friendly filter as usernames), respect the muted
// flag AND any live timed ban on neighborhood_players
// (milestone 7 — both enforced here, whatever the client
// claims), rate-limit ~1 message per 2s via the row-locked SQL
// function neighborhood_record_chat (same pattern as moves —
// in-memory limits don't survive serverless), INSERT into
// neighborhood_messages (moderation trail + log backfill),
// then broadcast a "chat" event on the room's Realtime
// channel.
// GET ?room=<id>: recent history, oldest → newest, for the
// chat log backfill on join. Both admin-gated (404) like every
// other neighborhood route.
// ============================================================

const MESSAGES_TABLE = "neighborhood_messages";
const HISTORY_LIMIT = 50;

// DB row → what goes over the wire (and into the log).
function toWireMessage(row) {
  return {
    id: row.id,
    playerId: row.player_id,
    username: row.username,
    text: row.text,
    at: row.created_at ? Date.parse(row.created_at) : Date.now(),
  };
}

export async function GET(request) {
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
    const roomId = request.nextUrl.searchParams.get("room") || "";
    if (!ROOMS[roomId]) {
      return NextResponse.json(
        { error: "Unknown room.", code: "bad_room" },
        { status: 400 }
      );
    }
    const { data, error } = await supabase
      .from(MESSAGES_TABLE)
      .select("id, player_id, username, text, created_at")
      .eq("room", roomId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      messages: (data || []).map(toWireMessage).reverse(),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

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
    const v = validateChatText(body.text);
    if (!v.ok) {
      return NextResponse.json(
        { error: v.error, code: v.code || "bad_message" },
        { status: 400 }
      );
    }

    const { data: row, error: readErr } = await supabase
      .from(TABLE)
      .select("id, username, room, muted, kicked_until")
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
    if (row.muted) {
      return NextResponse.json(
        {
          error:
            "You're muted right now, so messages won't send. Talk to the commissioner if that seems wrong.",
          code: "muted",
        },
        { status: 403 }
      );
    }

    // Postgres-backed sliding window (~1 message / 2s) — the
    // same atomic row-locked pattern as neighborhood_record_move,
    // so parallel lambdas can't race past the cap.
    const { data: gate, error: gateErr } = await supabase.rpc(
      "neighborhood_record_chat",
      { p_id: playerId, p_now_ms: Date.now() }
    );
    if (gateErr) throw gateErr;
    if (gate === "rate_limited") {
      return NextResponse.json(
        {
          error: "Whoa — one message every couple of seconds.",
          code: "rate_limited",
        },
        { status: 429 }
      );
    }
    if (gate === "not_joined") {
      return NextResponse.json(
        { error: "Join the room first.", code: "not_joined" },
        { status: 404 }
      );
    }

    // Insert first (the moderation trail + backfill source),
    // then broadcast the stored row so every client shows the
    // exact same message with the server's id + timestamp.
    const { data: inserted, error: insertErr } = await supabase
      .from(MESSAGES_TABLE)
      .insert({
        player_id: playerId,
        username: row.username,
        room: row.room,
        text: v.value,
      })
      .select("id, player_id, username, text, created_at")
      .single();
    if (insertErr) throw insertErr;

    const wire = toWireMessage(inserted);
    await broadcastToRoom(row.room, "chat", wire);
    return NextResponse.json({ ok: true, message: wire });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
