import { NextResponse } from "next/server";
import { canSeeNeighborhood, sameOrigin } from "@/lib/neighborhoodAccess";
import { verifyGrant, NONCE_RE } from "@/lib/neighborhood/broadcastGrant";

export const dynamic = "force-dynamic";

// ============================================================
// POST /api/neighborhood/broadcast/verify — "is this really
// the commissioner?" (milestone 10)
// ------------------------------------------------------------
// The one endpoint in the screen-share chain that ANY player
// may call: a viewer hands over the grant that arrived with an
// rtc-offer, plus the nonce it invented for this page load,
// and finds out whether to trust the offer.
//
// It reveals nothing — the grant is already in the caller's
// hands, and a forged one just gets `ok: false`. Minting is
// the privileged half and stays behind the admin cookie in
// ../route.js.
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
    const grant = String((body && body.grant) || "");
    const nonce = String((body && body.nonce) || "");
    const from = String((body && body.from) || "");
    if (!grant || !NONCE_RE.test(nonce)) {
      return NextResponse.json({ ok: false, code: "bad_request" });
    }
    const result = verifyGrant(grant, { nonce, broadcasterId: from || undefined });
    if (!result.ok) {
      return NextResponse.json({ ok: false, code: result.code });
    }
    return NextResponse.json({
      ok: true,
      broadcasterId: result.playerId,
      room: result.roomId,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
