import { isAuthed } from "./auth";
import { NEIGHBORHOOD_PUBLIC } from "./leagueData";

// HSPNeighborhood stays private until it is ready for the league.
export async function canSeeNeighborhood() {
  if (NEIGHBORHOOD_PUBLIC) return true;
  return isAuthed();
}
