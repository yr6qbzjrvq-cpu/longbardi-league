import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood, sameOrigin } from "@/lib/neighborhoodAccess";
import { ROOMS, roomHasScreen, SCREEN_ROOM_IDS } from "@/lib/neighborhood/rooms";
import {
  TABLE,
  PLAYER_ID_RE,
  activeBan,
  broadcastToRoom,
} from "@/lib/neighborhood/multiplayerServer";
import {
  CHANNELS_TABLE,
  TV_STATE_TABLE,
  TV_STATE_ID,
  CHANNEL_GAP_MS,
  CHANNEL_FLOOD_WINDOW_MS,
  CHANNEL_FLOOD_MAX,
  isChannelKind,
  popupLive,
  toWireChannel,
  toWireTvState,
} from "@/lib/neighborhood/channels";

export const dynamic = "force-dynamic";

// ============================================================
// /api/neighborhood/channels — the remote (milestone 28).
// ------------------------------------------------------------
// GET  → the lineup plus what the board is showing right now.
//        Anyone who can see the neighborhood can read it; it
//        is a list of channel names and public YouTube links.
// POST → change the channel. Same shape as /party and /throw,
//        for the same reason: clients cannot publish on the
//        gameplay topic, so a channel change only exists
//        because this route validated one and broadcast it. A
//        forged "tv_channel" is exactly as impossible as a
//        forged kick.
//
// Five gates, in order:
//   • the asker has to be an active, unbanned player
//   • standing in a room that HAS a screen (Mission Control or
//     the Sports Bar — the two rooms in SCREENS). Nobody
//     changes the bar's channel from the arcade.
//   • the channel has to exist, be enabled, and be of the kind
//     that is currently on the air
//   • for a "tv" channel, Austin has to actually be
//     broadcasting in popup mode RIGHT NOW — otherwise there
//     is no window to navigate and the request is meaningless
//   • one change per room per CHANNEL_GAP_MS, globally, plus a
//     loose per-player flood guard
//
// The last gate is one atomic, row-locked SQL call
// (neighborhood_record_channel). If that function has not been
// installed yet the route degrades to a per-lambda in-memory
// version rather than 500ing — the same FALLBACK shape /party
// uses.
//
// MUTED PLAYERS MAY STILL CHANGE THE CHANNEL. Mute is the CHAT
// sanction; reaching for the remote is a gesture, exactly like
// a tomato. A kick still blocks everything.
// ============================================================

// FALLBACK, used only while neighborhood_record_channel is
// missing from the database. Per lambda instance, so it is
// weaker than the Postgres one (a cold start forgets it) — but
// it still stops the obvious hold-the-remote spam, and the SQL
// function takes over the moment it exists.
const memoryBoard = new Map(); // board id -> { at, by }
const memoryPlayers = new Map(); // playerId -> [ms, ms, ...]

function memoryGate(playerId, username, board, now) {
  const last = memoryBoard.get(board);
  if (last && now - last.at < CHANNEL_GAP_MS) {
    return {
      code: "cooling",
      retryInMs: CHANNEL_GAP_MS - (now - last.at),
      changedBy: last.by,
      changedAt: last.at,
    };
  }
  const mine = (memoryPlayers.get(playerId) || []).filter(
    (t) => t > now - CHANNEL_FLOOD_WINDOW_MS
  );
  if (mine.length >= CHANNEL_FLOOD_MAX) {
    memoryPlayers.set(playerId, mine);
    return { code: "rate_limited" };
  }
  mine.push(now);
  memoryPlayers.set(playerId, mine);
  memoryBoard.set(board, { at: now, by: username });
  if (memoryPlayers.size > 500) {
    for (const [k, v] of memoryPlayers) {
      if (!v.length || v[v.length - 1] < now - 5 * 60_000) memoryPlayers.delete(k);
    }
  }
  return { code: "ok", at: now };
}

async function readState(supabase) {
  const { data } = await supabase
    .from(TV_STATE_TABLE)
    .select("*")
    .eq("id", TV_STATE_ID)
    .maybeSingle();
  return data || null;
}

async function readLineup(supabase) {
  const { data, error } = await supabase
    .from(CHANNELS_TABLE)
    .select("id, kind, name, url, sort, enabled")
    .eq("enabled", true)
    .order("sort", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = (data || []).map(toWireChannel).filter(Boolean);
  return {
    tv: rows.filter((c) => c.kind === "tv"),
    // A row whose link stopped parsing (an edit gone wrong)
    // would be a channel that can never tune — leave it out
    // rather than put a broken button in the guide.
    youtube: rows.filter((c) => c.kind === "youtube" && c.videoId),
  };
}

export async function GET() {
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
    const now = Date.now();
    const [channels, state] = await Promise.all([
      readLineup(supabase),
      readState(supabase),
    ]);
    return NextResponse.json({
      ok: true,
      channels,
      state: toWireTvState(state, now),
      serverNow: now,
      gapMs: CHANNEL_GAP_MS,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
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

    // A sync is a read, and any player in a screen room may ask
    // for one (walking in, waking a phone, a missed broadcast).
    if (String(body.action || "") === "sync") {
      const state = await readState(supabase);
      return NextResponse.json({
        ok: true,
        state: toWireTvState(state, now),
        serverNow: now,
      });
    }

    if (String(body.action || "change") !== "change") {
      return NextResponse.json(
        { error: "Unknown action.", code: "bad_action" },
        { status: 400 }
      );
    }

    // Config decides which rooms have a screen, not this file.
    if (!roomHasScreen(row.room)) {
      return NextResponse.json(
        { error: "There's no TV in here.", code: "no_screen" },
        { status: 400 }
      );
    }

    const kind = String(body.kind || "");
    if (!isChannelKind(kind)) {
      return NextResponse.json(
        { error: "Unknown channel type.", code: "bad_kind" },
        { status: 400 }
      );
    }
    const channelId = String(body.channelId || "");
    if (!channelId) {
      return NextResponse.json(
        { error: "Pick a channel.", code: "bad_channel" },
        { status: 400 }
      );
    }

    const { data: channel, error: chErr } = await supabase
      .from(CHANNELS_TABLE)
      .select("id, kind, name, url, sort, enabled")
      .eq("id", channelId)
      .maybeSingle();
    if (chErr) throw chErr;
    if (!channel || !channel.enabled || channel.kind !== kind) {
      return NextResponse.json(
        { error: "That channel isn't in the lineup.", code: "bad_channel" },
        { status: 404 }
      );
    }
    const wireChannel = toWireChannel(channel);
    if (kind === "youtube" && !wireChannel.videoId) {
      return NextResponse.json(
        { error: "That channel's link is broken.", code: "bad_channel" },
        { status: 400 }
      );
    }

    const state = await readState(supabase);

    // The popup gate. Asking for a YouTube TV channel when
    // nobody is broadcasting one is not an error the player
    // did anything about — there is simply no window to point
    // anywhere.
    if (kind === "tv" && !popupLive(state, now)) {
      return NextResponse.json(
        {
          error: "Nobody's broadcasting YouTube TV right now.",
          code: "no_popup",
        },
        { status: 409 }
      );
    }

    let gate = null;
    const { data: rpcGate, error: gateErr } = await supabase.rpc(
      "neighborhood_record_channel",
      {
        p_id: playerId,
        p_by: row.username,
        p_board: TV_STATE_ID,
        p_kind: kind,
        p_channel: channel.id,
        p_now_ms: now,
        p_gap_ms: CHANNEL_GAP_MS,
        p_window_ms: CHANNEL_FLOOD_WINDOW_MS,
        p_max: CHANNEL_FLOOD_MAX,
      }
    );
    if (gateErr) {
      const missing =
        gateErr.code === "42883" ||
        gateErr.code === "PGRST202" ||
        /could not find the function|does not exist/i.test(gateErr.message || "");
      if (!missing) throw gateErr;
      gate = memoryGate(playerId, row.username, TV_STATE_ID, now);
    } else {
      gate = rpcGate || { code: "not_joined" };
    }

    if (gate.code === "not_joined") {
      return NextResponse.json(
        { error: "Join the room first.", code: "not_joined" },
        { status: 404 }
      );
    }
    if (gate.code === "cooling") {
      return NextResponse.json(
        {
          error: gate.changedBy
            ? `${gate.changedBy} just changed it — give it a second.`
            : "The channel just changed — give it a second.",
          code: "cooling",
          retryInMs: Number(gate.retryInMs) || CHANNEL_GAP_MS,
          changedBy: gate.changedBy || null,
          changedAt: Number(gate.changedAt) || null,
        },
        { status: 429 }
      );
    }
    if (gate.code === "rate_limited") {
      return NextResponse.json(
        { error: "Easy on the remote.", code: "rate_limited" },
        { status: 429 }
      );
    }

    const wire = {
      kind,
      channelId: channel.id,
      name: channel.name,
      // Only a "tv" channel's URL travels, and only because
      // the broadcaster's own tab is the thing that has to act
      // on it. A YouTube channel travels as an id the player
      // embeds.
      url: kind === "tv" ? channel.url : null,
      videoId: kind === "youtube" ? wireChannel.videoId : null,
      startedAt: kind === "youtube" ? now : null,
      by: row.username,
      byId: playerId,
      at: now,
      gapMs: CHANNEL_GAP_MS,
    };

    await supabase
      .from(TABLE)
      .update({ last_seen: new Date(now).toISOString() })
      .eq("id", playerId);

    // One remote, every room with a screen — the same reason
    // one broadcast lights up both.
    for (const roomId of SCREEN_ROOM_IDS) {
      await broadcastToRoom(roomId, "tv_channel", wire);
    }

    return NextResponse.json({ ok: true, channel: wire, serverNow: now });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
