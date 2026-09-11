// Yahoo Fantasy XML -> the shapes this site already speaks.
//
// Everything here is pure: give it a parsed XML node, get back the same
// objects lib/fantasy.js has always handed the pages. That is the whole
// point of the swap seam — the pages never learn that Yahoo exists.
//
// Target shapes (unchanged from the placeholder era):
//   standings row  { team, manager, wins, losses, pf, pa, streak }
//   weekly score   { home, homeScore, away, awayScore }
//   matchup side   { manager, teamName, points, projected, yetToPlay }
//   roster         { manager, teamName, starters[], bench[] }
//   player         { slot, position, name, nflTeam, points, playing, stats }
//
// Tested against the sample responses published at
// sports.yahoo.com/developer/docs — see scripts/test-yahoo.mjs.

import { find, findAll, kid, kids, ownText, text, num } from "./xml.js";

// --- managers ------------------------------------------------------------

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// Yahoo knows a team by its Yahoo nickname ("cazlong22"); the site knows
// twelve first names. Match on the nickname, then on the team name, then
// give up gracefully and use whatever Yahoo said — a wrong-but-present name
// renders fine, an exception does not.
export function makeManagerResolver(siteManagers) {
  const managers = (siteManagers || []).map((m) => String(m));
  const exact = new Map(managers.map((m) => [normalize(m), m]));

  const scan = (value) => {
    const n = normalize(value);
    if (!n) return null;
    if (exact.has(n)) return exact.get(n);
    // "Casey L" / "casey_long" / "Casey's Team"
    for (const m of managers) {
      const nm = normalize(m);
      if (nm.length < 3) continue;
      if (n.startsWith(nm) || n.endsWith(nm)) return m;
    }
    for (const m of managers) {
      const nm = normalize(m);
      if (nm.length < 4) continue;
      if (n.includes(nm)) return m;
    }
    return null;
  };

  return function resolve({ nickname, teamName } = {}) {
    return (
      scan(nickname) ||
      scan(teamName) ||
      (nickname && String(nickname).trim()) ||
      (teamName && String(teamName).trim()) ||
      "Unknown"
    );
  };
}

// --- teams ---------------------------------------------------------------

function managerNickname(teamNode) {
  const managers = find(teamNode, "managers");
  if (!managers) return "";
  for (const m of kids(managers, "manager")) {
    const nick = ownText(m, "nickname");
    // Yahoo uses "--hidden--" for managers who hide their profile.
    if (nick && nick !== "--hidden--") return nick;
  }
  return "";
}

export function readTeam(teamNode, resolve) {
  const teamName = ownText(teamNode, "name");
  const nickname = managerNickname(teamNode);
  return {
    teamKey: ownText(teamNode, "team_key"),
    teamId: ownText(teamNode, "team_id"),
    teamName,
    nickname,
    manager: resolve ? resolve({ nickname, teamName }) : nickname || teamName,
  };
}

export function mapTeams(doc, resolve) {
  return findAll(doc, "team").map((t) => readTeam(t, resolve));
}

// --- standings -----------------------------------------------------------

function streakLabel(teamNode) {
  const streak = find(teamNode, "streak");
  if (!streak) return "—";
  const type = ownText(streak, "type");
  const value = num(ownText(streak, "value"), 0);
  if (!type || !value) return "—";
  const letter =
    type === "win" ? "W" : type === "loss" ? "L" : type === "tie" ? "T" : "";
  return letter ? `${letter}${value}` : "—";
}

export function mapStandings(doc, resolve) {
  const standings = find(doc, "standings") || doc;
  const rows = findAll(standings, "team").map((t) => {
    const base = readTeam(t, resolve);
    const ts = find(t, "team_standings");
    const outcome = ts ? find(ts, "outcome_totals") : null;
    return {
      ...base,
      // The site's standings table keys off `team` and `manager`; for this
      // league both are the manager's name, exactly as TEAMS has it.
      team: base.manager,
      wins: outcome ? num(ownText(outcome, "wins")) : 0,
      losses: outcome ? num(ownText(outcome, "losses")) : 0,
      ties: outcome ? num(ownText(outcome, "ties")) : 0,
      pf: ts ? num(ownText(ts, "points_for")) : 0,
      pa: ts ? num(ownText(ts, "points_against")) : 0,
      streak: streakLabel(t),
      rank: ts ? num(ownText(ts, "rank"), 0) : 0,
      yahooTeamName: base.teamName,
    };
  });

  // Yahoo returns them ranked; keep that, but fall back to the site's own
  // wins-then-points-for ordering if rank is missing.
  const ranked = rows.every((r) => r.rank > 0);
  return ranked
    ? [...rows].sort((a, b) => a.rank - b.rank)
    : [...rows].sort((a, b) => b.wins - a.wins || b.pf - a.pf);
}

// --- scoreboard ----------------------------------------------------------

function teamPoints(teamNode, tag) {
  const holder = find(teamNode, tag);
  if (!holder) return null;
  const total = ownText(holder, "total");
  if (total === "") return null;
  const n = Number(total);
  return Number.isFinite(n) ? n : null;
}

function side(teamNode, resolve) {
  const base = readTeam(teamNode, resolve);
  const points = teamPoints(teamNode, "team_points");
  const projected = teamPoints(teamNode, "team_projected_points");
  return {
    manager: base.manager,
    teamName: base.teamName || base.manager,
    teamKey: base.teamKey,
    points: points === null ? 0 : points,
    // No projection (a finished week, usually) means the projection is the
    // score, which is what the page should show.
    projected: projected === null ? (points === null ? 0 : points) : projected,
    yetToPlay: 0,
  };
}

export function mapScoreboard(doc, resolve, { slug, href } = {}) {
  const scoreboard = find(doc, "scoreboard");
  const scope = scoreboard || doc;
  const week = num(
    (scoreboard && ownText(scoreboard, "week")) || text(doc, "week"),
    0
  );

  const matchups = findAll(scope, "matchup").map((m) => {
    const teamNodes = findAll(m, "team");
    const away = side(teamNodes[0], resolve);
    const home = side(teamNodes[1] || teamNodes[0], resolve);
    const mWeek = num(ownText(m, "week"), week);
    const status = ownText(m, "status") || "";
    return {
      week: mWeek,
      status,
      // preevent / midevent / postevent are Yahoo's words for
      // hasn't started / in progress / final.
      final: status === "postevent",
      started: status === "midevent" || status === "postevent",
      away,
      home,
      slug: slug ? slug(away.manager, home.manager) : undefined,
      href: href ? href(mWeek, away.manager, home.manager) : undefined,
    };
  });

  return { week: week || matchups[0]?.week || 0, matchups };
}

// The home page's score strip and score box read this shape. `status` is
// per matchup, because on a Sunday afternoon some are final, some are in
// progress and some haven't kicked off — the hand-built data only ever had
// one answer for the whole week.
export function weeklyScoresFromScoreboard(board) {
  return {
    week: board.week,
    preseason: board.matchups.length > 0 && board.matchups.every((m) => !m.started),
    matchups: board.matchups.map((m) => ({
      home: m.home.manager,
      homeScore: m.home.points,
      away: m.away.manager,
      awayScore: m.away.points,
      status: m.final ? "Final" : m.started ? "Live" : "Upcoming",
    })),
  };
}

// --- rosters -------------------------------------------------------------

// Yahoo's roster slots vs the site's. Anything unrecognised is passed
// through, so a league with an odd slot still renders something sane.
const SLOTS = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DEF: "DEF",
  "W/R": "FLEX",
  "W/T": "FLEX",
  "W/R/T": "FLEX",
  "Q/W/R/T": "SFLEX",
  "R/W/T": "FLEX",
  BN: "BN",
  IR: "IR",
};

const BENCH_SLOTS = new Set(["BN", "IR", "IR+", "NA"]);

// Stat ids, straight from the NFL stat_categories block in Yahoo's own
// league-settings sample. Only ids Yahoo actually documents are mapped —
// nothing here is guessed, and statLine() tolerates every one of them
// being absent.
const STAT = {
  PASS_YDS: "4",
  PASS_TD: "5",
  PASS_INT: "6",
  RUSH_ATT: "8",
  RUSH_YDS: "9",
  RUSH_TD: "10",
  REC: "11",
  REC_YDS: "12",
  REC_TD: "13",
  RET_TD: "15",
  TWO_PT: "16",
  FUM_LOST: "18",
  FG_0_19: "19",
  FG_20_29: "20",
  FG_30_39: "21",
  FG_40_49: "22",
  FG_50: "23",
  PAT_MADE: "29",
  PTS_ALLOWED: "31",
  SACK: "32",
  DEF_INT: "33",
  FUM_REC: "34",
  DEF_TD: "35",
  SAFETY: "36",
  BLOCK: "37",
  TARGETS: "78",
};

export function readStatMap(playerNode) {
  const out = {};
  const holder = find(playerNode, "player_stats");
  if (!holder) return out;
  for (const stat of findAll(holder, "stat")) {
    const id = ownText(stat, "stat_id");
    if (!id) continue;
    const raw = ownText(stat, "value");
    // Yahoo sends "-" for a stat that does not apply to the player.
    out[id] = raw === "-" || raw === "" ? 0 : num(raw, 0);
  }
  return out;
}

// Only the fields statLine() knows how to print, and only when Yahoo sent
// them. Missing is missing — never zero-filled, so the stat line can tell
// "no receptions" from "we do not have receptions".
export function statsForPosition(position, raw) {
  const has = (id) => Object.prototype.hasOwnProperty.call(raw, id);
  const get = (id) => (has(id) ? raw[id] : undefined);
  const out = {};
  const set = (key, id) => {
    const v = get(id);
    if (v !== undefined) out[key] = v;
  };

  switch (position) {
    case "QB":
      set("passYds", STAT.PASS_YDS);
      set("passTD", STAT.PASS_TD);
      set("int", STAT.PASS_INT);
      set("rushYds", STAT.RUSH_YDS);
      set("rushTD", STAT.RUSH_TD);
      break;
    case "RB":
      set("carries", STAT.RUSH_ATT);
      set("rushYds", STAT.RUSH_YDS);
      set("rushTD", STAT.RUSH_TD);
      set("rec", STAT.REC);
      set("recYds", STAT.REC_YDS);
      set("recTD", STAT.REC_TD);
      break;
    case "WR":
    case "TE":
      set("targets", STAT.TARGETS);
      set("rec", STAT.REC);
      set("recYds", STAT.REC_YDS);
      set("recTD", STAT.REC_TD);
      break;
    case "K": {
      const made = [
        STAT.FG_0_19,
        STAT.FG_20_29,
        STAT.FG_30_39,
        STAT.FG_40_49,
        STAT.FG_50,
      ].filter(has);
      if (made.length) {
        out.fgm = made.reduce((sum, id) => sum + raw[id], 0);
      }
      set("xpm", STAT.PAT_MADE);
      break;
    }
    default:
      set("sacks", STAT.SACK);
      set("int", STAT.DEF_INT);
      set("fumRec", STAT.FUM_REC);
      set("pointsAllowed", STAT.PTS_ALLOWED);
      set("defTD", STAT.DEF_TD);
  }
  return out;
}

export function readPlayer(playerNode) {
  const selected = find(playerNode, "selected_position");
  const rawSlot = selected ? ownText(selected, "position") : "";
  const slot = SLOTS[rawSlot] || rawSlot || "BN";
  const position =
    ownText(playerNode, "display_position") ||
    ownText(playerNode, "primary_position") ||
    slot;
  const nameNode = kid(playerNode, "name");
  const pointsNode = find(playerNode, "player_points");
  const stats = readStatMap(playerNode);

  return {
    playerKey: ownText(playerNode, "player_key"),
    slot,
    rawSlot,
    position,
    name: nameNode ? ownText(nameNode, "full") : "",
    nflTeam: normalizeNflAbbr(ownText(playerNode, "editorial_team_abbr")),
    points: pointsNode ? num(ownText(pointsNode, "total"), 0) : 0,
    playing: false,
    stats: statsForPosition(position, stats),
  };
}

export function mapRosterTeam(teamNode, resolve) {
  const base = readTeam(teamNode, resolve);
  const roster = find(teamNode, "roster");
  const players = roster ? findAll(roster, "player").map(readPlayer) : [];

  return {
    teamKey: base.teamKey,
    manager: base.manager,
    teamName: base.teamName || base.manager,
    starters: players.filter((p) => !BENCH_SLOTS.has(p.rawSlot)),
    bench: players.filter((p) => BENCH_SLOTS.has(p.rawSlot)),
  };
}

// Accepts either a whole-league response (league/teams/roster/players) or a
// single team response (team/roster/players).
export function mapRosters(doc, resolve) {
  return findAll(doc, "team")
    .filter((t) => find(t, "roster"))
    .map((t) => mapRosterTeam(t, resolve));
}

// --- league discovery ----------------------------------------------------

export function mapLeagues(doc) {
  return findAll(doc, "league").map((l) => ({
    leagueKey: ownText(l, "league_key"),
    name: ownText(l, "name"),
    season: ownText(l, "season"),
    numTeams: num(ownText(l, "num_teams"), 0),
    currentWeek: num(ownText(l, "current_week"), 0),
    startWeek: num(ownText(l, "start_week"), 1),
    endWeek: num(ownText(l, "end_week"), 0),
    gameCode: ownText(l, "game_code"),
    url: ownText(l, "url"),
    isFinished: ownText(l, "is_finished") === "1",
  }));
}

export function mapLeagueMeta(doc) {
  return mapLeagues(doc)[0] || null;
}

// --- yet to play ---------------------------------------------------------

// Yahoo does not say "three starters left to play" anywhere in the
// scoreboard. The site already pulls the real NFL scoreboard for Pick 'Em,
// so the answer is there: a starter counts as yet-to-play while their NFL
// team's game is unfinished. Pure, so it can be tested with a fake slate.
export function countYetToPlay(roster, games) {
  if (!roster || !Array.isArray(games) || games.length === 0) return 0;
  const unfinished = new Set();
  for (const g of games) {
    if (g?.completed) continue;
    if (g?.home?.abbr) unfinished.add(normalizeNflAbbr(g.home.abbr));
    if (g?.away?.abbr) unfinished.add(normalizeNflAbbr(g.away.abbr));
  }
  let n = 0;
  for (const p of roster.starters || []) {
    if (p.nflTeam && unfinished.has(p.nflTeam)) n += 1;
  }
  return n;
}

// ESPN and Yahoo disagree about a handful of abbreviations.
const ABBR_FIXUPS = {
  WAS: "WSH",
  JAC: "JAX",
  LA: "LAR",
  NOR: "NO",
  KAN: "KC",
  SFO: "SF",
  TAM: "TB",
  GNB: "GB",
  NWE: "NE",
};

export function normalizeNflAbbr(abbr) {
  const up = String(abbr || "").toUpperCase();
  return ABBR_FIXUPS[up] || up;
}
