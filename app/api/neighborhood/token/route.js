import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood, sameOrigin } from "@/lib/neighborhoodAccess";
import { ROOMS } from "@/lib/neighborhood/rooms";
import { TABLE, PLAYER_ID_RE, activeBan } from "@/lib/neighborhood/multiplayerServer";
import { mintRealtimeToken, realtimeTokensEnabled } from "@/lib/neighborhood/realtimeAuth";

export const dynamic = "force-dynamic";

// ============================================================
// POST /api/neighborhood/token — mint a Realtime credential.
// ------------------------------------------------------------
// Called by the client transport immediately BEFORE it
// subscribes to a room's private channels (milestone 10). The
// response says which mode this deployment is in:
//
//   mode "scoped" — a signed token pinned to one room. The RLS
//     policy on realtime.messages only lets this token read
//     that room's topics.
//   mode "shared" — no signing secret configured, so the
//     browser presents the project's anon key instead. It can
//     still only READ; publishing gameplay events stays
//     impossible either way, because that is enforced by the
//     policy's write rule, not by the token.
//
// The gate is the same one the rest of the gameplay API uses
// (flag or admin cookie) plus real validation of what is being
// asked for: a well-formed player id, a room that exists, and
// no live ban. A kicked player cannot even listen in.
// ============================================================

export async function POST(request) {
  if (!(await canSeeNeighborhood())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Bad origin." }, { status: 403 });
  }
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const playerId = String((body && body.playerId) || "");
    const roomId = String((body && body.roomId) || "");
    if (!PLAYER_ID_RE.test(playerId)) {
      return NextResponse.json(
        { error: "Bad player id.", code: "bad_player" },
        { status: 400 }
      );
    }
    if (!ROOMS[roomId]) {
      return NextResponse.json(
        { error: "Unknown room.", code: "bad_room" },
        { status: 400 }
      );
    }

    if (!realtimeTokensEnabled()) {
      return NextResponse.json({ ok: true, mode: "shared" });
    }

    // Serving a timeout? No credential, so no listening in on
    // the room you were removed from.
    const supabase = getAdminClient();
    if (supabase) {
      const { data: row } = await supabase
        .from(TABLE)
        .select("id, kicked_until")
        .eq("id", playerId)
        .maybeSingle();
      const ban = activeBan(row);
      if (ban) {
        return NextResponse.json(
          { error: ban.message, code: "kicked", until: ban.until },
          { status: 403 }
        );
      }
    }

    const minted = mintRealtimeToken(playerId, roomId);
    if (!minted) return NextResponse.json({ ok: true, mode: "shared" });
    return NextResponse.json({
      ok: true,
      mode: "scoped",
      token: minted.token,
      expiresAt: minted.expiresAt,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
