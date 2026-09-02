// ============================================================
// HSPNeighborhood — voice grants (milestone 19)
// ------------------------------------------------------------
// Server-only. Proves to a voice PEER that the player asking
// to join its ear really is an active, unbanned, UNMUTED
// player standing in this room — before any audio flows.
//
// Same shape as lib/neighborhood/broadcastGrant.js, and for
// the same reason: voice signaling rides a client-writable
// Realtime topic (neighborhood-rtc:<roomId>), so "this offer
// says it's from Steve" proves nothing on its own. Every voice
// offer AND every voice answer carries a grant that only the
// gated /api/neighborhood/voice route can mint, bound to a
// nonce the RECEIVING peer invented for its own session — so a
// captured grant is useless at anyone else and dies with the
// page (and in minutes regardless).
//
// The difference from a broadcast grant: ANY eligible player
// can get one (voice is for everyone, the big board is for the
// commissioner), so what the route checks is not a cookie but
// the player row — joined, heartbeating, unbanned, and NOT
// MUTED. That last check is what makes the commissioner's mute
// button silence a player's microphone as well as their chat:
// no grant, no offer accepted, no answer accepted, no mesh.
//
// A separate HMAC label keeps these grants and broadcast
// grants from ever validating as each other.
// ============================================================

import crypto from "node:crypto";

export const VOICE_NONCE_RE = /^[A-Za-z0-9_-]{8,64}$/;

const GRANT_TTL_MS = 5 * 60 * 1000; // minted per peer, per handshake

function key() {
  const base =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ADMIN_PASSWORD || "";
  if (!base) return null;
  return crypto
    .createHmac("sha256", base)
    .update("hspn-neighborhood-voice-v1")
    .digest();
}

function sign(payloadB64, k) {
  return crypto.createHmac("sha256", k).update(payloadB64).digest("base64url");
}

// grant = base64url(JSON claims) + "." + HMAC. Opaque to the
// client, which only ever passes it along.
export function signVoiceGrant({ playerId, roomId, nonce }) {
  const k = key();
  if (!k) return null;
  const claims = {
    p: String(playerId || ""),
    r: String(roomId || ""),
    n: String(nonce || ""),
    e: Date.now() + GRANT_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${sign(body, k)}`;
}

// Returns { ok: true, playerId, roomId } only for a grant that
// is well formed, correctly signed, unexpired, minted for
// exactly this nonce, and (when given) for this player and
// this room.
export function verifyVoiceGrant(grant, { nonce, playerId, roomId } = {}) {
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
  if (nonce !== undefined && claims.n !== String(nonce)) {
    return { ok: false, code: "bad_nonce" };
  }
  if (playerId !== undefined && claims.p !== String(playerId)) {
    return { ok: false, code: "bad_player" };
  }
  if (roomId !== undefined && claims.r !== String(roomId)) {
    return { ok: false, code: "bad_room" };
  }
  return { ok: true, playerId: claims.p, roomId: claims.r };
}
