import { isAuthed } from "./auth";
import { NEIGHBORHOOD_PUBLIC } from "./leagueData";

// HSPNeighborhood is open to the league (milestone 10). The
// flag still exists so it can be closed again in one edit, and
// the commissioner keeps access either way.
//
// This is the GAMEPLAY gate. Two things deliberately do NOT
// use it: the moderation API/screen and the broadcast-start
// route both check isAuthed() directly, so they stay
// commissioner-only now that everything else is public.
export async function canSeeNeighborhood() {
  if (NEIGHBORHOOD_PUBLIC) return true;
  return isAuthed();
}

// Cheap cross-site guard for the gameplay routes. A browser
// sends Origin on same-origin POSTs, so a mismatch means some
// other page is driving a visitor's session; a missing Origin
// (curl, a beacon) is allowed through, because requiring it
// would only inconvenience honest clients — a script can set
// any header it likes. The real authority is still the
// server-side validation each route does on playerId, room,
// path and rate limit.
export function sameOrigin(request) {
  try {
    const origin = request.headers.get("origin");
    if (!origin) return true;
    const host = request.headers.get("host");
    if (!host) return true;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
