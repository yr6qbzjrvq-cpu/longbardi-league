import { isAuthed } from "./auth";
import { FANTASY_LIVE } from "./leagueData";
import { isYahooLive } from "./yahoo/live";

// Rosters and matchups stay private until real data is flowing. Three ways
// in, cheapest first:
//   * FANTASY_LIVE, the manual override in lib/leagueData.js;
//   * a live Yahoo connection, which is the real trigger now — the moment
//     Austin connects Yahoo, the league can see matchups and rosters;
//   * being logged in as commissioner, so the pages can be checked early.
export async function canSeeFantasy() {
  if (FANTASY_LIVE) return true;
  if (await isYahooLive()) return true;
  return isAuthed();
}
