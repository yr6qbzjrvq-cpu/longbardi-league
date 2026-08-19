// ============================================================
// LEAGUE CONFIG + DATA — edit this file to update the site
// ============================================================

export const LEAGUE = {
  name: "Longbardi",
  tagline: "The Official Home of the Longbardi League",
  season: 2026,
  currentWeek: 1,
};

// Site branding
export const BRAND = {
  abbr: "HSPN",
  full: "Hillis Sports Production Network",
};

// Pick 'Em launch switch. While this is false the game is invisible to the
// league: no nav link, and the pages and API only answer if you're logged in
// as commissioner. Flip it to true when you're ready to open it up.
export const PICKEM_PUBLIC = true;

// Rosters and matchups go live once real Yahoo data is flowing. Until then
// the pages exist but only the commissioner can reach them.
export const FANTASY_LIVE = false;

// Hail Mary, the football slingshot game. Built but not announced.
export const HAILMARY_PUBLIC = false;

// Deep Threat is live, but unlisted: anyone with the link can play, and the
// only link on the site is on the admin page.
export const DEEPTHREAT_PUBLIC = true;

// People who play Pick 'Em but don't have a team in the league. They show up
// in the name dropdown and the Pick 'Em standings, and nowhere else.
export const PICKEM_EXTRA_PLAYERS = ["Claire", "Thomas"];

// Articles that should send readers somewhere else on the site instead of to
// the article page. Keyed by slug.
export const ARTICLE_LINKS = {
  "hspn-pick-em-is-live": "/pickem",
};

export function articleHref(article) {
  return ARTICLE_LINKS[article?.slug] || `/articles/${article?.slug}`;
}

// Standings — the site sorts by wins, then points for.
export const TEAMS = [
  { team: "Casey",    manager: "Casey",    wins: 0, losses: 0, pf: 0, pa: 0, streak: "—" },
  { team: "Scott",    manager: "Scott",    wins: 0, losses: 0, pf: 0, pa: 0, streak: "—" },
  { team: "Dominic", manager: "Dominic", wins: 0, losses: 0, pf: 0, pa: 0, streak: "—" },
  { team: "Austin",   manager: "Austin",   wins: 0, losses: 0, pf: 0, pa: 0, streak: "—" },
  { team: "Nathan",   manager: "Nathan",   wins: 0, losses: 0, pf: 0, pa: 0, streak: "—" },
  { team: "Jakki",    manager: "Jakki",    wins: 0, losses: 0, pf: 0, pa: 0, streak: "—" },
  { team: "Rocco",    manager: "Rocco",    wins: 0, losses: 0, pf: 0, pa: 0, streak: "—" },
  { team: "Tyler",    manager: "Tyler",    wins: 0, losses: 0, pf: 0, pa: 0, streak: "—" },
  { team: "Steven",   manager: "Steven",   wins: 0, losses: 0, pf: 0, pa: 0, streak: "—" },
  { team: "Joey",     manager: "Joey",     wins: 0, losses: 0, pf: 0, pa: 0, streak: "—" },
  { team: "Hunter",   manager: "Hunter",   wins: 0, losses: 0, pf: 0, pa: 0, streak: "—" },
  { team: "Anthony",  manager: "Anthony",  wins: 0, losses: 0, pf: 0, pa: 0, streak: "—" },
];

// Latest week's scores — update after each week.
export const WEEKLY_SCORES = {
  week: 1,
  matchups: [
    { home: "Casey",  homeScore: 0, away: "Scott",   awayScore: 0 },
    { home: "Dominic", homeScore: 0, away: "Austin",  awayScore: 0 },
    { home: "Nathan", homeScore: 0, away: "Jakki",   awayScore: 0 },
    { home: "Rocco",  homeScore: 0, away: "Tyler",   awayScore: 0 },
    { home: "Steven", homeScore: 0, away: "Joey",    awayScore: 0 },
    { home: "Hunter", homeScore: 0, away: "Anthony", awayScore: 0 },
  ],
};

// Trophy Room — past champions. Newest first. Add a "note" field to any
// entry to show a line of text on its card.
export const CHAMPIONS = [
  { year: 2026, team: "Austin Hillis", pending: true },
  { year: 2025, team: "Anthony Minetti" },
  { year: 2024, team: "Steven Kolzow" },
  { year: 2023, team: "Scott Watters" },
  { year: 2022, team: "Tyler Ramage" },
  { year: 2021, team: "Casey Long" },
];

export function sortedStandings() {
  return [...TEAMS].sort((a, b) => b.wins - a.wins || b.pf - a.pf);
}

// True until any game has been played.
export function isPreseason() {
  return TEAMS.every((t) => t.wins === 0 && t.losses === 0);
}
