// ============================================================
// HSPNeighborhood — the dance button (milestone 26)
// ------------------------------------------------------------
// Austin's ask: *"Add a dance button too that will make your
// avatar do a little dance for a few seconds. Put it up at the
// top by the tomato button."*
//
// This is the ONE definition of how long a dance lasts, how
// often you may start one, and which of the three routines a
// given dance is. Imported by the client engine
// (components/NeighborhoodRoom), by the avatar renderer's
// caller, and by /api/neighborhood/dance — exactly like
// party.js is shared by the disco and the party route.
//
// Same determinism trick as tomatoes and the big red button:
// the server broadcasts ONE tiny record — (id, playerId, room,
// at, durationMs) — and every client in the room builds the
// identical three and a half seconds of footwork from it. The
// choreography itself lives in lib/neighborhoodAvatar.js and is
// a pure function of "seconds since `at`", so nothing has to
// stay in sync frame by frame: the wall clock does it.
//
// Everything here is TRANSIENT. A dance is never written to a
// table, never appears in the chat log, and leaves no
// moderation trail — it is a gesture, like a tomato. A tab that
// was hidden for the whole show comes back to a dance that has
// simply expired, because "is this dance running" is only ever
// (now - at < durationMs).
//
// Nothing here touches window/document at import time, so the
// module is safe to import in a serverless route.
// ============================================================

// ---- timing ------------------------------------------------

// A few seconds, as asked: two bounces, two side-steps, a spin
// and a hands-in-the-air finish. Long enough to be a bit, short
// enough that nobody has to wait for you to stop.
export const DANCE_DURATION_MS = 3600;

// One dance per player per this window, enforced in Postgres
// (neighborhood_record_dance). The client paces itself to the
// same number so the 429 is rare — you get the toast only if
// you are genuinely mashing the button.
export const DANCE_COOLDOWN_MS = 4000;

// ---- which routine -----------------------------------------

// Three variants, so back-to-back dances are not identical
// twins. Derived from the dance id rather than sent on the
// wire: every client hashes the same id and picks the same
// routine, which is one less field to forge and one less field
// to keep in sync.
export const DANCE_STYLE_COUNT = 3;

// FNV-1a, the same little hash tomatoes.js and party.js use for
// their seeds. Kept local so this module has no imports at all.
export function danceStyleFromId(id) {
  let h = 0x811c9dc5;
  const s = String(id || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % DANCE_STYLE_COUNT;
}
