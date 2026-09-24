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

// Minesweeper, the classic mine-clearing game. While false it is admin-only:
// no nav link, and the page 404s unless you are logged in as commissioner.
export const MINESWEEPER_PUBLIC = false;

// HSPNeighborhood, the hangout world. TRUE since the go-public flip: the nav
// shows a Neighborhood link, /neighborhood loads for anyone with the link, and
// the gameplay APIs answer without the admin cookie (they validate the player
// and rate-limit instead). Flip back to false to close it again — that hides
// the nav link and 404s the world for everyone but the commissioner.
// Moderation and the screen-share start route are NOT affected either way:
// they check the admin cookie directly and stay commissioner-only.
export const NEIGHBORHOOD_PUBLIC = true;

// Proximity voice chat inside the Neighborhood (milestone 19). OFF for now:
// the mic button is hidden, no microphone/AudioContext/mesh is ever started,
// and /api/neighborhood/voice answers 404. All of the voice code is still in
// place — flip this back to true to turn voice chat on again.
export const NEIGHBORHOOD_VOICE = false;

// People who play Pick 'Em but don't have a team in the league. They show up
// in the name dropdown and the Pick 'Em standings, and nowhere else.
export const PICKEM_EXTRA_PLAYERS = ["Claire", "Thomas"];

// Articles that should send readers somewhere else on the site instead of to
// the article page. Keyed by slug.
export const ARTICLE_LINKS = {
  "hspn-pick-em-is-live": "/pickem",
  "check-out-hspneighborhood-today": "/neighborhood",
};

export function articleHref(article) {
  return ARTICLE_LINKS[article?.slug] || `/articles/${article?.slug}`;
}

// Standings — the site sorts by wins, then points for.
export const TEAMS = [
  { team: "NFL Youngboy",              manager: "Rikki",    wins: 2, losses: 0, pf: 284.16, pa: 0, streak: "—" },
  { team: "Soon To Be Double Champ",   manager: "Scott",    wins: 1, losses: 1, pf: 242.78, pa: 0, streak: "—" },
  { team: "The West Mesa Waterboiz",   manager: "Dominic",  wins: 1, losses: 1, pf: 235.80, pa: 0, streak: "—" },
  { team: "(Zay) Flowers of Scotland", manager: "Austin",   wins: 1, losses: 1, pf: 225.28, pa: 0, streak: "—" },
  { team: "The Poop Loop",             manager: "Nathan",   wins: 1, losses: 1, pf: 219.82, pa: 0, streak: "—" },
  { team: "AzMERRITT",                 manager: "Jakki",    wins: 1, losses: 1, pf: 215.50, pa: 0, streak: "—" },
  { team: "The K. Walker III Reichard", manager: "Rocco",   wins: 1, losses: 1, pf: 207.56, pa: 0, streak: "—" },
  { team: "You May Kiss MCBRIDE",      manager: "Tyler",    wins: 1, losses: 1, pf: 199.84, pa: 0, streak: "—" },
  { team: "Kelce Chase Swift Love",    manager: "Steven",   wins: 1, losses: 1, pf: 194.10, pa: 0, streak: "—" },
  { team: "Bass to Mouth",             manager: "Joey",     wins: 1, losses: 1, pf: 178.78, pa: 0, streak: "—" },
  { team: "Immaculate Concepcion",     manager: "Hunter",   wins: 1, losses: 1, pf: 170.86, pa: 0, streak: "—" },
  { team: "Hurts So Good",             manager: "Anthony",  wins: 0, losses: 2, pf: 194.28, pa: 0, streak: "—" },
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
