import { isAuthed } from "./auth";
import { PICKEM_PUBLIC } from "./leagueData";

// Pick 'Em is either open to the league or private to the commissioner.
// Every page and API route that touches it asks this first.
export async function canSeePickem() {
  if (PICKEM_PUBLIC) return true;
  return isAuthed();
}
