import {
  LEAGUE,
  TEAMS,
  WEEKLY_SCORES,
  sortedStandings,
  isPreseason,
} from "./leagueData.js";
import { matchupHref, matchupSlug } from "./fantasyShapes.js";
import { isYahooLive, yahooStatus } from "./yahoo/live.js";
import {
  attachYetToPlay,
  getRosters as getCachedRosters,
  getScoreboard,
  getStandings as getCachedStandings,
  peekRosters,
} from "./yahoo/sync.js";
import { getWeek as getNflWeek } from "./nfl.js";

// ---------------------------------------------------------------------------
// One place that answers "what are the rosters", "what are this week's
// matchups", "what do the standings look like". Two sources sit behind it:
//
//   * Yahoo, once the commissioner has connected it on /admin/yahoo;
//   * the hand-built numbers in lib/leagueData.js, otherwise.
//
// The pages never learn which one they got. Every function below tries live
// first and falls back the moment Yahoo is unconfigured, unconnected, broken,
// rate limited, or overridden — so the site cannot go dark because Yahoo did.
//
//   roster   { manager, teamName, starters[], bench[] }
//   player   { slot, position, name, nflTeam, points, playing, stats }
//   matchup  { home, away, week }   where each side is { manager, teamName,
//                                    points, projected, yetToPlay }
// ---------------------------------------------------------------------------

// "placeholder" while the site is on hand-built data, "yahoo" when it is
// mirroring the real league.
export async function fantasySource() {
  return (await isYahooLive()) ? "yahoo" : "placeholder";
}

export async function isPlaceholder() {
  return !(await isYahooLive());
}

export { matchupSlug, matchupHref };

const STARTER_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"];

const POOL = {
  QB: [
    ["Josh Allen", "BUF"], ["Patrick Mahomes", "KC"], ["Lamar Jackson", "BAL"],
    ["Jalen Hurts", "PHI"], ["Joe Burrow", "CIN"], ["C.J. Stroud", "HOU"],
    ["Jayden Daniels", "WSH"], ["Justin Herbert", "LAC"], ["Jared Goff", "DET"],
    ["Brock Purdy", "SF"], ["Kyler Murray", "ARI"], ["Caleb Williams", "CHI"],
  ],
  RB: [
    ["Christian McCaffrey", "SF"], ["Bijan Robinson", "ATL"], ["Saquon Barkley", "PHI"],
    ["Jahmyr Gibbs", "DET"], ["Breece Hall", "NYJ"], ["De'Von Achane", "MIA"],
    ["Jonathan Taylor", "IND"], ["Derrick Henry", "BAL"], ["Kyren Williams", "LAR"],
    ["Josh Jacobs", "GB"], ["Kenneth Walker III", "SEA"], ["James Cook", "BUF"],
    ["Rachaad White", "TB"], ["Alvin Kamara", "NO"], ["David Montgomery", "DET"],
    ["Chase Brown", "CIN"], ["Tony Pollard", "TEN"], ["Rhamondre Stevenson", "NE"],
    ["Travis Etienne Jr.", "JAX"], ["Isiah Pacheco", "KC"], ["Najee Harris", "PIT"],
    ["Zamir White", "LV"], ["Brian Robinson Jr.", "WSH"], ["Javonte Williams", "DEN"],
  ],
  WR: [
    ["CeeDee Lamb", "DAL"], ["Tyreek Hill", "MIA"], ["Ja'Marr Chase", "CIN"],
    ["Justin Jefferson", "MIN"], ["Amon-Ra St. Brown", "DET"], ["A.J. Brown", "PHI"],
    ["Puka Nacua", "LAR"], ["Garrett Wilson", "NYJ"], ["Nico Collins", "HOU"],
    ["Drake London", "ATL"], ["Malik Nabers", "NYG"], ["Brandon Aiyuk", "SF"],
    ["DK Metcalf", "SEA"], ["Mike Evans", "TB"], ["Chris Olave", "NO"],
    ["DJ Moore", "CHI"], ["Zay Flowers", "BAL"], ["Jaylen Waddle", "MIA"],
    ["Terry McLaurin", "WSH"], ["Tee Higgins", "CIN"], ["Deebo Samuel", "SF"],
    ["Courtland Sutton", "DEN"], ["Jordan Addison", "MIN"], ["Rashee Rice", "KC"],
    ["Keenan Allen", "CHI"], ["Calvin Ridley", "TEN"], ["Diontae Johnson", "CAR"],
    ["Christian Kirk", "JAX"], ["Jayden Reed", "GB"], ["Rome Odunze", "CHI"],
    ["Ladd McConkey", "LAC"], ["Marvin Harrison Jr.", "ARI"], ["Brian Thomas Jr.", "JAX"],
    ["Khalil Shakir", "BUF"], ["Josh Downs", "IND"], ["Tank Dell", "HOU"],
  ],
  TE: [
    ["Travis Kelce", "KC"], ["Sam LaPorta", "DET"], ["Mark Andrews", "BAL"],
    ["Trey McBride", "ARI"], ["George Kittle", "SF"], ["Dalton Kincaid", "BUF"],
    ["Evan Engram", "JAX"], ["Kyle Pitts", "ATL"], ["David Njoku", "CLE"],
    ["Jake Ferguson", "DAL"], ["T.J. Hockenson", "MIN"], ["Dallas Goedert", "PHI"],
  ],
  K: [
    ["Justin Tucker", "BAL"], ["Harrison Butker", "KC"], ["Brandon Aubrey", "DAL"],
    ["Jake Elliott", "PHI"], ["Tyler Bass", "BUF"], ["Jake Moody", "SF"],
    ["Younghoe Koo", "ATL"], ["Chris Boswell", "PIT"], ["Cameron Dicker", "LAC"],
    ["Jason Sanders", "MIA"], ["Ka'imi Fairbairn", "HOU"], ["Cairo Santos", "CHI"],
  ],
  DEF: [
    ["Ravens D/ST", "BAL"], ["Jets D/ST", "NYJ"], ["Browns D/ST", "CLE"],
    ["Cowboys D/ST", "DAL"], ["Bills D/ST", "BUF"], ["49ers D/ST", "SF"],
    ["Steelers D/ST", "PIT"], ["Eagles D/ST", "PHI"], ["Chiefs D/ST", "KC"],
    ["Lions D/ST", "DET"], ["Texans D/ST", "HOU"], ["Packers D/ST", "GB"],
  ],
};

// Small deterministic hash so the fake data is the same on the server and the
// client, and doesn't reshuffle on every render.
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function pick(pool, index, offset) {
  const [name, nflTeam] = pool[(index * 7 + offset) % pool.length];
  return { name, nflTeam };
}

// Per-position box score. Yahoo returns stat ids and values; the mapping lands
// here so the pages only ever deal with these named fields.
function makeStats(position, rand) {
  const n = (max) => Math.round(rand() * max);
  switch (position) {
    case "QB":
      return {
        completions: 14 + n(14),
        attempts: 26 + n(16),
        passYds: 150 + n(200),
        passTD: n(4),
        int: rand() > 0.65 ? 1 : 0,
        rushYds: n(38),
        rushTD: rand() > 0.85 ? 1 : 0,
      };
    case "RB":
      return {
        carries: 8 + n(15),
        rushYds: 25 + n(95),
        rushTD: rand() > 0.7 ? 1 : 0,
        rec: n(5),
        recYds: n(45),
      };
    case "WR":
    case "TE":
      return {
        targets: 3 + n(9),
        rec: 2 + n(7),
        recYds: 20 + n(90),
        recTD: rand() > 0.72 ? 1 : 0,
      };
    case "K":
      return { fgm: n(4), fga: 1 + n(4), xpm: n(5) };
    default:
      return {
        sacks: n(5),
        int: n(2),
        fumRec: rand() > 0.75 ? 1 : 0,
        pointsAllowed: n(31),
      };
  }
}

// A short human line for the roster tables.
//
// Two callers with very different data: the placeholder generator, which
// fills in every field, and Yahoo, which only sends the stat categories the
// league actually scores (no pass attempts, no field-goal attempts, nothing
// at all for a player who has not kicked off yet). So every piece is
// optional — a missing stat is left out rather than printed as "undefined".
export function statLine(player) {
  const s = player.stats || {};
  const has = (k) => s[k] !== undefined && s[k] !== null;
  const bits = [];

  switch (player.position) {
    case "QB":
      if (has("completions") && has("attempts")) {
        bits.push(`${s.completions}/${s.attempts}`);
      }
      if (has("passYds")) bits.push(`${s.passYds} pass yds`);
      if (s.passTD) bits.push(`${s.passTD} TD`);
      if (s.int) bits.push(`${s.int} INT`);
      if (s.rushYds) bits.push(`${s.rushYds} rush yds`);
      if (s.rushTD) bits.push(`${s.rushTD} rush TD`);
      break;
    case "RB":
      if (has("carries")) bits.push(`${s.carries} car`);
      if (has("rushYds")) bits.push(`${s.rushYds} yds`);
      if (s.rushTD) bits.push(`${s.rushTD} TD`);
      if (s.rec) bits.push(`${s.rec} rec`, `${s.recYds ?? 0} yds`);
      if (s.recTD) bits.push(`${s.recTD} rec TD`);
      break;
    case "WR":
    case "TE":
      if (has("rec") && has("targets")) bits.push(`${s.rec}/${s.targets}`);
      else if (has("rec")) bits.push(`${s.rec} rec`);
      if (has("recYds")) bits.push(`${s.recYds} yds`);
      if (s.recTD) bits.push(`${s.recTD} TD`);
      break;
    case "K":
      if (has("fgm") && has("fga")) bits.push(`${s.fgm}/${s.fga} FG`);
      else if (has("fgm")) bits.push(`${s.fgm} FG`);
      if (has("xpm")) bits.push(`${s.xpm} XP`);
      break;
    default:
      if (has("sacks")) bits.push(`${s.sacks} sack`);
      if (has("int")) bits.push(`${s.int} INT`);
      if (s.fumRec) bits.push(`${s.fumRec} FR`);
      if (s.defTD) bits.push(`${s.defTD} TD`);
      if (has("pointsAllowed")) bits.push(`${s.pointsAllowed} pts allowed`);
  }

  return bits.join(", ");
}

function buildRoster(team, teamIndex, week) {
  const rand = seeded(`${team.manager}:${week}`);
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };

  const make = (slot) => {
    const position = slot === "FLEX" ? (rand() > 0.5 ? "RB" : "WR") : slot;
    const chosen = pick(POOL[position], teamIndex, counts[position]++);
    const playing = rand() > 0.45;
    return {
      slot,
      position,
      name: chosen.name,
      nflTeam: chosen.nflTeam,
      points: Number((rand() * (position === "QB" ? 26 : 18)).toFixed(1)),
      playing,
      stats: makeStats(position, rand),
    };
  };

  const starters = STARTER_SLOTS.map(make);
  const bench = ["RB", "WR", "WR", "TE", "QB"].map((p) => ({
    ...make(p),
    slot: "BN",
  }));

  return {
    manager: team.manager,
    teamName: team.team,
    starters,
    bench,
  };
}

// --- the seam: Yahoo first, hand-built data second -------------------------
//
// Each getter has the same shape: ask Yahoo (which is really "ask the
// Supabase cache, and refresh it if it has gone stale"), and if anything at
// all comes back short, return the hand-built answer instead. `null` from a
// live* helper always means "fall back", never "show an error".

async function liveScoreboard(week) {
  if (!(await isYahooLive())) return null;
  try {
    const hit = await getScoreboard(week);
    if (!hit?.payload?.matchups?.length) return null;
    return hit.payload;
  } catch {
    return null;
  }
}

// "3 yet to play" is not something Yahoo reports. The site already pulls the
// real NFL slate for Pick 'Em, so a starter counts as yet-to-play while
// their NFL team's game is unfinished. Reads the roster cache only — it will
// never start a Yahoo call of its own just to decorate the matchup list.
async function withYetToPlay(board, week) {
  try {
    const [rosters, nfl] = await Promise.all([
      peekRosters(week),
      getNflWeek(week).catch(() => null),
    ]);
    if (!rosters || !nfl?.games?.length) return board;
    return attachYetToPlay(board, rosters, nfl.games);
  } catch {
    return board;
  }
}

export async function getRosters(week = 1) {
  if (await isYahooLive()) {
    try {
      const hit = await getCachedRosters(week);
      if (hit?.payload?.rosters?.length) return hit.payload.rosters;
    } catch {
      // fall through to the hand-built rosters
    }
  }
  return TEAMS.map((team, i) => buildRoster(team, i, week));
}

export async function getRoster(manager, week = 1) {
  const rosters = await getRosters(week);
  return (
    rosters.find(
      (r) => r.manager.toLowerCase() === String(manager).toLowerCase()
    ) || null
  );
}

export async function getMatchups(week = 1) {
  const live = await liveScoreboard(week);
  if (live) {
    const board = await withYetToPlay(live, week);
    return board.matchups;
  }
  return placeholderMatchups(week);
}

async function placeholderMatchups(week) {
  const rosters = TEAMS.map((team, i) => buildRoster(team, i, week));

  const side = (roster) => {
    const points = roster.starters.reduce((sum, p) => sum + p.points, 0);
    const yetToPlay = roster.starters.filter((p) => p.playing).length;
    return {
      manager: roster.manager,
      teamName: roster.teamName,
      points: Number(points.toFixed(1)),
      projected: Number((points + yetToPlay * 9.4).toFixed(1)),
      yetToPlay,
    };
  };

  const out = [];
  for (let i = 0; i < rosters.length; i += 2) {
    if (!rosters[i + 1]) break;
    const away = side(rosters[i]);
    const home = side(rosters[i + 1]);
    out.push({
      week,
      away,
      home,
      slug: matchupSlug(away.manager, home.manager),
      href: matchupHref(week, away.manager, home.manager),
    });
  }
  return out;
}

// One matchup with both full rosters attached, for the detail page. Works
// the same either way: the matchup list and the rosters both come from
// whichever source is live.
export async function getMatchup(week, slug) {
  const [matchups, rosters] = await Promise.all([
    getMatchups(week),
    getRosters(week),
  ]);

  const matchup = matchups.find((m) => m.slug === slug);
  if (!matchup) return null;

  const attach = (side) => ({
    ...side,
    roster: rosters.find((r) => r.manager === side.manager) || null,
  });

  return {
    ...matchup,
    away: attach(matchup.away),
    home: attach(matchup.home),
  };
}

// --- standings and the week's scores --------------------------------------
//
// These two used to be read straight out of lib/leagueData.js by the home
// page and the standings table. They come through the seam now so they can
// be live too, with the same fallback.

export async function getStandings() {
  if (await isYahooLive()) {
    try {
      const hit = await getCachedStandings();
      const rows = hit?.payload?.rows;
      if (rows?.length) {
        const { currentWeek } = await yahooStatus();
        return {
          rows,
          live: true,
          preseason: rows.every((r) => !r.wins && !r.losses),
          // Yahoo knows which week the league is on; LEAGUE.currentWeek is
          // the hand-maintained answer.
          week: currentWeek || LEAGUE.currentWeek,
        };
      }
    } catch {
      // fall through
    }
  }
  return {
    rows: sortedStandings(),
    live: false,
    preseason: isPreseason(),
    week: LEAGUE.currentWeek,
  };
}

export async function getWeeklyScores() {
  const live = await liveScoreboard(WEEKLY_SCORES.week);
  if (live?.weeklyScores?.matchups?.length) {
    return { ...live.weeklyScores, live: true };
  }
  return { ...WEEKLY_SCORES, preseason: isPreseason(), live: false };
}
