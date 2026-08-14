// NFL schedule + results, pulled from ESPN's public scoreboard feed.
// Everything the pick'em needs comes from here: matchups, kickoff times,
// the weekly lock, and who actually won.

const SEASON = 2026;
const REGULAR_SEASON = 2;
const TOTAL_WEEKS = 18;

function endpoint(week) {
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${SEASON}&seasontype=${REGULAR_SEASON}&week=${week}`;
}

export function currentSeason() {
  return SEASON;
}

export function totalWeeks() {
  return TOTAL_WEEKS;
}

// Shape one ESPN event into just what we need.
function toGame(event) {
  const comp = event?.competitions?.[0];
  if (!comp) return null;

  const home = comp.competitors?.find((c) => c.homeAway === "home");
  const away = comp.competitors?.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const state = comp.status?.type?.state || "pre";
  const completed = Boolean(comp.status?.type?.completed);

  let winner = null;
  if (completed) {
    if (home.winner) winner = home.team.abbreviation;
    else if (away.winner) winner = away.team.abbreviation;
    else winner = "TIE";
  }

  return {
    id: String(event.id),
    kickoff: event.date,
    state,
    completed,
    winner,
    shortName: event.shortName,
    home: {
      abbr: home.team.abbreviation,
      name: home.team.shortDisplayName || home.team.displayName,
      logo: home.team.logo || null,
      score: home.score ?? null,
    },
    away: {
      abbr: away.team.abbreviation,
      name: away.team.shortDisplayName || away.team.displayName,
      logo: away.team.logo || null,
      score: away.score ?? null,
    },
  };
}

export async function getWeek(week) {
  const w = Number(week);
  if (!Number.isInteger(w) || w < 1 || w > TOTAL_WEEKS) return null;

  let json;
  try {
    // Short cache: schedules rarely move, but scores need to land quickly.
    const res = await fetch(endpoint(w), { next: { revalidate: 60 } });
    if (!res.ok) return null;
    json = await res.json();
  } catch {
    return null;
  }

  const games = (json.events || [])
    .map(toGame)
    .filter(Boolean)
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));

  if (games.length === 0) return { week: w, games: [], lockAt: null };

  // The whole week locks when the first game of that week kicks off.
  const lockAt = games[0].kickoff;

  return { week: w, games, lockAt };
}

export function isLocked(weekData, now = new Date()) {
  if (!weekData?.lockAt) return false;
  return now >= new Date(weekData.lockAt);
}

// Which week to show by default: the earliest week that hasn't locked yet,
// otherwise the last week of the season.
export async function getDefaultWeek() {
  const now = new Date();
  for (let w = 1; w <= TOTAL_WEEKS; w++) {
    const data = await getWeek(w);
    if (!data || data.games.length === 0) continue;
    if (!isLocked(data, now)) return w;
  }
  return TOTAL_WEEKS;
}

// Score one player's picks for a week. Only completed games count.
export function scorePicks(games, picksByGame) {
  let correct = 0;
  let decided = 0;
  for (const g of games) {
    if (!g.completed || !g.winner) continue;
    decided += 1;
    const pick = picksByGame[g.id];
    if (pick && pick === g.winner) correct += 1;
  }
  return { correct, decided };
}
