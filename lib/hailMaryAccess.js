import { isAuthed } from "./auth";
import { HAILMARY_PUBLIC } from "./leagueData";

// Hail Mary stays private until it's ready for the league.
export async function canSeeHailMary() {
  if (HAILMARY_PUBLIC) return true;
  return isAuthed();
}
