import { isAuthed } from "./auth";
import { FANTASY_LIVE } from "./leagueData";

// Rosters and matchups stay private until real Yahoo data is flowing.
export async function canSeeFantasy() {
  if (FANTASY_LIVE) return true;
  return isAuthed();
}
