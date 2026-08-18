import { isAuthed } from "./auth";
import { DEEPTHREAT_PUBLIC } from "./leagueData";

// Deep Threat stays private until it's ready for the league.
export async function canSeeDeepThreat() {
  if (DEEPTHREAT_PUBLIC) return true;
  return isAuthed();
}
