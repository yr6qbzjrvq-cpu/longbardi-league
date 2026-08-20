import { isAuthed } from "./auth";
import { MINESWEEPER_PUBLIC } from "./leagueData";

// Minesweeper stays private until it is ready for the league.
export async function canSeeMinesweeper() {
  if (MINESWEEPER_PUBLIC) return true;
  return isAuthed();
}
