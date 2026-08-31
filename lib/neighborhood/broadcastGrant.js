// ============================================================
// HSPNeighborhood — broadcaster grants (milestone 10)
// ------------------------------------------------------------
// Server-only. Proves to a VIEWER that the WebRTC offer it is
// about to accept really came from the commissioner.
//
// The problem this closes: signaling rides a room channel that
// every player in the room can publish on, and until now a
// viewer accepted an rtc-offer from any playerId that happened
// to be present. A leaguemate could have put their own screen
// on the big board. Now every offer must carry a grant that
// only the admin-cookie-gated broadcast route can mint, and
// the viewer checks it server-side before touching the SDP.
//
// Replay is closed by binding each grant to a NONCE the viewer
// itself invented: the grant that reaches you is only valid
// for your nonce, so a captured grant can't be replayed at
// anyone else, and a stale one can't be replayed at you (your
// nonce is per page load, and grants expire in minutes
// anyway).
//
// The HMAC key is derived from SUPABASE_SERVICE_ROLE_KEY,
// which is server-only and always present wherever a broadcast
// can be authorized. Nothing derived from it leaves the
// server except the signature itself.
// ============================================================

import crypto from "node:crypto";
import { BROADCAST_ROOM_ID } from "@/lib/neighborhood/rooms";

// The room a broadcast is started FROM. It is defined with the
// rest of the screen wiring in the room registry (one
// definition, both sides — the house rule) and re-exported
// here so the server modules that only care about grants keep
// importing it from one place. Since milestone 12 a broadcast
// STARTED here also lights up the Sports Bar screen; the grant
// still names this room, because "who may put a picture on the
// board" is one permission, not one per room.
export { BROADCAST_ROOM_ID };
export const NONCE_RE = /^[A-Za-z0-9_-]{8,64}$/;

const GRANT_TTL_MS = 5 * 60 * 1000; // minted per viewer, per handshake

function key() {
  const base =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ADMIN_PASSWORD || "";
  if (!base) return null;
  return crypto
    .createHmac("sha256", base)
    .update("hspn-neighborhood-broadcast-v1")
    .digest();
}

function sign(payloadB64, k) {
  return crypto.createHmac("sha256", k).update(payloadB64).digest("base64url");
}

// grant = base64url(JSON claims) + "." + HMAC. Opaque to the
// client, which only ever passes it along.
export function signGrant({ playerId, roomId, nonce }) {
  const k = key();
  if (!k) return null;
  const claims = {
    b: String(playerId || ""),
    r: String(roomId || BROADCAST_ROOM_ID),
    n: String(nonce || ""),
    e: Date.now() + GRANT_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${sign(body, k)}`;
}

// Returns { ok: true, playerId, roomId } only for a grant that
// is well formed, correctly signed, unexpired, and minted for
// exactly this nonce (and, when given, this broadcaster id).
export function verifyGrant(grant, { nonce, broadcasterId } = {}) {
  const k = key();
  if (!k) return { ok: false, code: "not_configured" };
  const parts = String(grant || "").split(".");
  if (parts.length !== 2) return { ok: false, code: "malformed" };
  const [body, sig] = parts;
  let expected;
  try {
    expected = sign(body, k);
  } catch {
    return { ok: false, code: "malformed" };
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: "bad_signature" };
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, code: "malformed" };
  }
  if (!claims || typeof claims !== "object") {
    return { ok: false, code: "malformed" };
  }
  if (!Number.isFinite(claims.e) || claims.e <= Date.now()) {
    return { ok: false, code: "expired" };
  }
  if (claims.r !== BROADCAST_ROOM_ID) return { ok: false, code: "bad_room" };
  if (nonce !== undefined && claims.n !== String(nonce)) {
    return { ok: false, code: "bad_nonce" };
  }
  if (broadcasterId !== undefined && claims.b !== String(broadcasterId)) {
    return { ok: false, code: "bad_broadcaster" };
  }
  return { ok: true, playerId: claims.b, roomId: claims.r };
}
