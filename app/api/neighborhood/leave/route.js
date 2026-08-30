import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood, sameOrigin } from "@/lib/neighborhoodAccess";
import { PLAYER_ID_RE, TABLE, broadcastToRoom, noBanFilter } from "@/lib/neighborhood/multiplayerServer";

export const dynamic = "force-dynamic";

// ============================================================
// POST /api/neighborhood/leave — clean exit.
// ------------------------------------------------------------
// Deletes the player's row and tells the room, so peers drop
// the avatar immediately instead of waiting for the presence
// timeout or the 75s stale prune. Sent with keepalive on tab
// close; harmless to call twice. A row carrying a live timed
// ban (milestone 7) is spared — the row IS the ban record, and
// deleting it here would let a kicked player erase their own
// timeout with one API call.
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
    if (!PLAYER_ID_RE.test(playerId)) {
      return NextResponse.json(
        { error: "Bad request.", code: "bad_request" },
        { status: 400 }
      );
    }
    const { data, error } = await supabase
      .from(TABLE)
      .delete()
      .eq("id", playerId)
      .or(noBanFilter())
      .select("id, room");
    if (error) throw error;
    if (data && data.length > 0 && data[0].room) {
      await broadcastToRoom(data[0].room, "leave", { id: playerId });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood } from "@/lib/neighborhoodAccess";
import { TABLE, broadcastToRoom, noBanFilter } from "@/lib/neighborhood/multiplayerServer";

export const dynamic = "force-dynamic";

// ============================================================
// POST /api/neighborhood/leave — clean exit.
// ------------------------------------------------------------
// Deletes the player's row and tells the room, so peers drop
// the avatar immediately instead of waiting for the presence
// timeout or the 75s stale prune. Sent with keepalive on tab
// close; harmless to call twice. A row carrying a live timed
// ban (milestone 7) is spared — the row IS the ban record, and
// deleting it here would let a kicked player erase their own
// timeout with one API call.
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
    if (!playerId) {
      return NextResponse.json(
        { error: "Bad request.", code: "bad_request" },
        { status: 400 }
      );
    }
    const { data, error } = await supabase
      .from(TABLE)
      .delete()
      .eq("id", playerId)
      .or(noBanFilter())
      .select("id, room");
    if (error) throw error;
    if (data && data.length > 0 && data[0].room) {
      await broadcastToRoom(data[0].room, "leave", { id: playerId });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
