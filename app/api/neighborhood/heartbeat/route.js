import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood, sameOrigin } from "@/lib/neighborhoodAccess";
import { PLAYER_ID_RE, TABLE, noBanFilter } from "@/lib/neighborhood/multiplayerServer";

export const dynamic = "force-dynamic";

// ============================================================
// POST /api/neighborhood/heartbeat — "still here".
// ------------------------------------------------------------
// Clients ping every 30s to keep last_seen inside the active
// window (75s) that capacity and username-uniqueness checks
// use. Answers ok:false/not_joined (with a 200, so the client
// treats it as data, not an error) when the row was pruned —
// the client then quietly rejoins. A kicked row (milestone 7)
// never gets its last_seen bumped: the ban-record row must
// stay inactive, so a kicked client also lands on not_joined,
// tries to rejoin, and gets the "kicked" answer there.
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
      .update({ last_seen: new Date().toISOString() })
      .eq("id", playerId)
      .or(noBanFilter())
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json({ ok: false, code: "not_joined" });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood } from "@/lib/neighborhoodAccess";
import { TABLE, noBanFilter } from "@/lib/neighborhood/multiplayerServer";

export const dynamic = "force-dynamic";

// ============================================================
// POST /api/neighborhood/heartbeat — "still here".
// ------------------------------------------------------------
// Clients ping every 30s to keep last_seen inside the active
// window (75s) that capacity and username-uniqueness checks
// use. Answers ok:false/not_joined (with a 200, so the client
// treats it as data, not an error) when the row was pruned —
// the client then quietly rejoins. A kicked row (milestone 7)
// never gets its last_seen bumped: the ban-record row must
// stay inactive, so a kicked client also lands on not_joined,
// tries to rejoin, and gets the "kicked" answer there.
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
      .update({ last_seen: new Date().toISOString() })
      .eq("id", playerId)
      .or(noBanFilter())
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json({ ok: false, code: "not_joined" });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
