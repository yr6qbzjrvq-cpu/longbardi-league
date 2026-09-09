// ============================================================
// HSPNeighborhood — the dance button (milestones 26, 27)
// ------------------------------------------------------------
// Milestone 26, Austin: *"Add a dance button too that will make
// your avatar do a little dance for a few seconds. Put it up at
// the top by the tomato button."*
//
// Milestone 27, Austin the next morning: *"Remove the cooldown,
// I want them to keep dancing until they click on something
// else."*
//
// So a dance is no longer a clip with an end time. It is a
// STATE you enter: you start dancing, you keep dancing, and you
// stop the moment you do anything else on purpose — take a
// step, tap a door, press another button in the toolbar, open
// an overlay, leave the room, or press DANCE again.
//
// This module is the ONE definition of how long a single time
// through the routine takes, how much spam is too much, and
// which of the three routines a given dance is. Imported by the
// client engine (components/NeighborhoodRoom), by the avatar
// renderer's caller, and by /api/neighborhood/dance — exactly
// like party.js is shared by the disco and the party route.
//
// Same determinism trick as tomatoes and the big red button:
// the server broadcasts ONE tiny record — (id, playerId, room,
// at) — and every client in the room builds the same footwork
// from it. The choreography lives in lib/neighborhoodAvatar.js
// and is a pure function of "seconds since `at`" wrapped into
// the cycle, so nothing has to stay in step frame by frame: the
// wall clock does it. A dance four minutes old is
// (now - at) / DANCE_CYCLE_MS cycles in, in every browser, on
// every phone, with no keepalive traffic at all.
//
// A dance still writes nothing to neighborhood_messages and
// leaves no moderation trail. It does now park on the dancer's
// own player row (dance_id/dance_at) while it runs, because a
// state with no end time needs somewhere authoritative to live
// — that is what makes a late joiner, a reconnect and a dropped
// stop event all come out right. See
// supabase/neighborhood_dance.sql.
//
// Nothing here touches window/document at import time, so the
// module is safe to import in a serverless route.
// ============================================================

// ---- timing ------------------------------------------------

// One time through the routine: two bounces, two side-steps, a
// spin, a hands-in-the-air finish and a beat to breathe. The
// dance does not END here any more — it starts over. Kept at
// the milestone 26 duration so the footwork is beat for beat
// the dance Austin already liked.
export const DANCE_CYCLE_MS = 3600;

// ---- how much spam is too much -----------------------------

// There is NO cooldown. Tap DANCE, tap it again to stop, tap it
// again on the very next frame — that has to work, and it does.
// The only start the server turns away is a redundant one from
// somebody who is already dancing, and even that is answered as
// a plain "you are already dancing", not an error.
//
// What is left is a flood guard, and it is there for scripts,
// not for people: DANCE_FLOOD_MAX starts per window, enforced
// in Postgres on the same dance_times column milestone 26 used
// for its cooldown. No hand can toggle a dance ten times in a
// minute and mean it.
export const DANCE_FLOOD_WINDOW_MS = 60_000;
export const DANCE_FLOOD_MAX = 10;

// ---- which routine -----------------------------------------

// Three variants, so two dances in a row are not identical
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
