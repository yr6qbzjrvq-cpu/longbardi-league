import { TEAMS } from "./leagueData";

// ---------------------------------------------------------------------------
// One place that answers "what are the rosters" and "what are this week's
// matchups". Right now the answers are invented so the pages can be built and
// looked at before the draft. When Yahoo access comes through, only the three
// functions at the bottom change — the pages read this shape either way.
//
//   roster   { manager, teamName, starters[], bench[] }
//   player   { name, position, nflTeam, points, playing }
//   matchup  { home, away, week }   where each side is { manager, teamName,
//                                    points, projected, yetToPlay }
// ---------------------------------------------------------------------------

export const FANTASY_SOURCE = "placeholder";

export function isPlaceholder() {
  return FANTASY_SOURCE === "placeholder";
}

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

// --- the three functions Yahoo will take over -----------------------------

export async function getRosters(week = 1) {
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
  const rosters = await getRosters(week);

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
    out.push({ week, away: side(rosters[i]), home: side(rosters[i + 1]) });
  }
  return out;
}
