import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";
import {
  TABLE,
  KICK_DEFAULT_MINUTES,
  activeCutoffIso,
  broadcastToRoom,
  pruneStale,
} from "@/lib/neighborhood/multiplayerServer";

export const dynamic = "force-dynamic";

// ============================================================
// /api/neighborhood/admin — moderation (milestone 7).
// ------------------------------------------------------------
// STRICTLY commissioner-only: gated on isAuthed() directly
// (not canSeeNeighborhood), so these endpoints stay locked
// even after NEIGHBORHOOD_PUBLIC flips. Logged out = the same
// 404 as every other neighborhood route.
//
// GET → one snapshot for the dashboard: active players (rows
//   inside the 75s window), players serving a timed ban, and
//   the most recent messages across all rooms.
//
// POST {action, ...} →
//   mute   {playerId, muted}  flip the muted flag; the chat
//          route enforces it and answers the polite toast.
//   kick   {playerId, minutes?=10}  stamp kicked_until and
//          zero last_seen: the row stays as the BAN RECORD but
//          drops out of rosters/capacity/name checks. A
//          "kicked" broadcast sends the player's own client to
//          the removed screen; everyone else treats it as a
//          leave. Every gameplay route refuses the id until
//          the ban lapses, however the client behaves.
//   unkick {playerId}  lift a ban early by deleting the
//          ban-record row.
//   delete_message {id}  remove one message from the trail and
//          broadcast "chat_delete" so open logs drop it live.
// ============================================================

const MESSAGES_TABLE = "neighborhood_messages";
const MESSAGE_LIMIT = 40;
const EPOCH_ISO = new Date(0).toISOString();

export async function GET() {
  if (!(await isAuthed())) {
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
    const nowIso = new Date(now).toISOString();

    const [playersRes, bannedRes, messagesRes] = await Promise.all([
      supabase
        .from(TABLE)
        .select("id, username, room, created_at, last_seen, muted, kicked_until")
        .gte("last_seen", activeCutoffIso(now))
        .order("created_at", { ascending: true }),
      supabase
        .from(TABLE)
        .select("id, username, room, muted, kicked_until")
        .gt("kicked_until", nowIso),
      supabase
        .from(MESSAGES_TABLE)
        .select("id, player_id, username, room, text, created_at")
        .order("created_at", { ascending: false })
        .limit(MESSAGE_LIMIT),
    ]);
    if (playersRes.error) throw playersRes.error;
    if (bannedRes.error) throw bannedRes.error;
    if (messagesRes.error) throw messagesRes.error;

    return NextResponse.json({
      ok: true,
      serverNow: now,
      players: playersRes.data || [],
      banned: bannedRes.data || [],
      messages: messagesRes.data || [],
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  if (!(await isAuthed())) {
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
    const action = String(body.action || "");

    if (action === "mute") {
      const playerId = String(body.playerId || "");
      const muted = Boolean(body.muted);
      const { data, error } = await supabase
        .from(TABLE)
        .update({ muted })
        .eq("id", playerId)
        .select("id, username, muted");
      if (error) throw error;
      if (!data || data.length === 0) {
        return NextResponse.json(
          { error: "That player isn't in the neighborhood.", code: "not_found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, player: data[0] });
    }

    if (action === "kick") {
      const playerId = String(body.playerId || "");
      const minutes = Math.min(
        Math.max(Math.round(Number(body.minutes) || KICK_DEFAULT_MINUTES), 1),
        24 * 60
      );
      const { data: row, error: readErr } = await supabase
        .from(TABLE)
        .select("id, username, room")
        .eq("id", playerId)
        .maybeSingle();
      if (readErr) throw readErr;
      if (!row) {
        return NextResponse.json(
          { error: "That player isn't in the neighborhood.", code: "not_found" },
          { status: 404 }
        );
      }
      const until = Date.now() + minutes * 60_000;
      const untilIso = new Date(until).toISOString();
      const { error: writeErr } = await supabase
        .from(TABLE)
        .update({
          kicked_until: untilIso,
          // Inactive immediately: out of rosters, capacity and
          // name-uniqueness. The row lives on as the ban record
          // (pruneStale and /leave both spare it).
          last_seen: EPOCH_ISO,
          path: [],
          path_started_at: null,
        })
        .eq("id", playerId);
      if (writeErr) throw writeErr;
      if (row.room) {
        // Their own client shows the removed screen; everyone
        // else just sees them go. "leave" keeps any not-yet-
        // refreshed client ghost-free too.
        await broadcastToRoom(row.room, "kicked", {
          id: playerId,
          until,
          message: `You were removed from the neighborhood by the commissioner. You can come back in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        });
        await broadcastToRoom(row.room, "leave", { id: playerId });
      }
      return NextResponse.json({
        ok: true,
        player: { id: playerId, username: row.username, kicked_until: untilIso },
      });
    }

    if (action === "unkick") {
      const playerId = String(body.playerId || "");
      // Only ban-record rows (live kicked_until) qualify — an
      // active player has nothing to lift.
      const { data, error } = await supabase
        .from(TABLE)
        .delete()
        .eq("id", playerId)
        .not("kicked_until", "is", null)
        .gt("kicked_until", new Date().toISOString())
        .select("id, username");
      if (error) throw error;
      if (!data || data.length === 0) {
        return NextResponse.json(
          { error: "No live ban found for that player.", code: "not_found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, player: data[0] });
    }

    if (action === "delete_message") {
      const id = String(body.id || "");
      if (!id) {
        return NextResponse.json(
          { error: "Bad request.", code: "bad_request" },
          { status: 400 }
        );
      }
      const { data, error } = await supabase
        .from(MESSAGES_TABLE)
        .delete()
        .eq("id", id)
        .select("id, player_id, room");
      if (error) throw error;
      if (!data || data.length === 0) {
        return NextResponse.json(
          { error: "That message is already gone.", code: "not_found" },
          { status: 404 }
        );
      }
      if (data[0].room) {
        await broadcastToRoom(data[0].room, "chat_delete", {
          id: data[0].id,
          playerId: data[0].player_id,
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "prune") {
      // Convenience broom for the dashboard's refresh.
      await pruneStale(supabase);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: "Unknown action.", code: "bad_action" },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
