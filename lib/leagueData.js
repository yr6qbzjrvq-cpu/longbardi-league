// ============================================================
// LEAGUE CONFIG + DATA — edit this file to update the site
// ============================================================

export const LEAGUE = {
  name: "Longbardi",
  tagline: "The Official Home of the Longbardi League",
  season: 2026,
  currentWeek: 1,
};

// Standings — the site sorts by wins, then points for.
export const TEAMS = [
  { team: "Rikki",    manager: "Rikki",    wins: 0, losses: 0, pf: 0, pa: 0, streak: "—" },
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
    { home: "Rikki",  homeScore: 0, away: "Scott",   awayScore: 0 },
    { home: "Dominic", homeScore: 0, away: "Austin",  awayScore: 0 },
    { home: "Nathan", homeScore: 0, away: "Jakki",   awayScore: 0 },
    { home: "Rocco",  homeScore: 0, away: "Tyler",   awayScore: 0 },
    { home: "Steven", homeScore: 0, away: "Joey",    awayScore: 0 },
    { home: "Hunter", homeScore: 0, away: "Anthony", awayScore: 0 },
  ],
};

// Trophy Room — past champions. Newest first.
export const CHAMPIONS = [
  {
    year: 2026,
    team: "Austin Hillis",
    pending: true,
    note: "Trophy pre-engraved for efficiency. The commissioner saw no reason to wait for the season to confirm the obvious. Complaints may be filed directly into the trash.",
  },
  {
    year: 2025,
    team: "Anthony Minetti",
    note: "The reigning, defending champion of the Longbardi League. Enjoy the throne while it lasts, Anthony — it's a rental.",
  },
  {
    year: 2024,
    team: "Steven Kolzow",
    note: "Took home the hardware and has generously reminded the league of it at every gathering since.",
  },
  {
    year: 2023,
    team: "Scott Watters",
    note: "2023 belonged to Scott. The championship group-chat message remains pinned. We know, Scott. We were there.",
  },
  {
    year: 2022,
    team: "Tyler Ramage",
    note: "Climbed the mountain in year two and planted the flag. Witnesses report he was unbearable for months.",
  },
  {
    year: 2021,
    team: "Casey Long",
    note: "The inaugural champion. First name etched on the trophy, permanent place in league lore.",
  },
];

export function sortedStandings() {
  return [...TEAMS].sort((a, b) => b.wins - a.wins || b.pf - a.pf);
}

// True until any game has been played.
export function isPreseason() {
  return TEAMS.every((t) => t.wins === 0 && t.losses === 0);
}
