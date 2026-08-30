import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ============================================================
// /api/neighborhood/broadcast — the screen-share admin gate
// (milestone 9).
// ------------------------------------------------------------
// The video itself is peer to peer and never comes near this
// server. What lives here is permission: only the commissioner
// may START a broadcast into Mission Control.
//
// Gated on isAuthed() directly — the same STRICT check the
// moderation route uses, not canSeeNeighborhood() — so the
// share button stays commissioner-only even after
// NEIGHBORHOOD_PUBLIC flips and the room fills with league
// friends. Logged out gets the same 404 as every other
// neighborhood route, so the endpoint doesn't advertise
// itself.
//
// GET  → "may this browser broadcast?" The client asks before
//        rendering the Share My Screen button at all.
// POST → authorizes one broadcast session, immediately before
//        getDisplayMedia opens the picker. The client refuses
//        to capture without an ok here.
//
// NOTE (M3): this gates the CAPTURE side. Viewers currently
// trust any rtc-offer from a playerId present in the room, so
// the honest end-to-end story today is "everyone who can reach
// Mission Control is already behind the admin login". If the
// neighborhood ever goes public, the broadcaster id needs to
// be signed here and verified by viewers before this endpoint
// is the whole answer.
// ============================================================

const ROOM_ID = "mission-control";

function notFound() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

export async function GET() {
  if (!(await isAuthed())) return notFound();
  return NextResponse.json({ ok: true, canBroadcast: true, room: ROOM_ID });
}

export async function POST(request) {
  if (!(await isAuthed())) return notFound();
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      // an empty body is fine — the cookie is what authorizes
    }
    const playerId = String((body && body.playerId) || "");
    const roomId = String((body && body.roomId) || ROOM_ID);
    if (roomId !== ROOM_ID) {
      return NextResponse.json(
        { error: "The big board only lives in Mission Control.", code: "bad_room" },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      broadcaster: playerId || null,
      room: ROOM_ID,
      startedAt: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
