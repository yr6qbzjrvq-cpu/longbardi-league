// ============================================================
// LEAGUE CONFIG + MOCK DATA — edit this file to update the site
// ============================================================

export const LEAGUE = {
  name: "Longbardi",
  tagline: "The Official Home of the Longbardi League",
  season: 2026,
  currentWeek: 10,
};

// Standings — keep sorted however you like; the site sorts by wins, then PF.
export const TEAMS = [
  { team: "Turf Burn United",     manager: "Austin",  wins: 8, losses: 1, pf: 1187.4, pa: 962.1,  streak: "W4" },
  { team: "The Waiver Wolves",    manager: "Dom",     wins: 7, losses: 2, pf: 1122.8, pa: 1001.5, streak: "W2" },
  { team: "Gridiron Gravy",       manager: "Marcus",  wins: 6, losses: 3, pf: 1098.2, pa: 1010.9, streak: "L1" },
  { team: "Bench Warmers Anon",   manager: "Tony",    wins: 6, losses: 3, pf: 1076.5, pa: 1044.3, streak: "W1" },
  { team: "Hail Mary Hooligans",  manager: "Steve",   wins: 5, losses: 4, pf: 1051.0, pa: 1032.7, streak: "W3" },
  { team: "The Blitz Krieg",      manager: "Rachel",  wins: 5, losses: 4, pf: 1044.9, pa: 1051.2, streak: "L2" },
  { team: "Fourth & Long Shots",  manager: "Kevin",   wins: 4, losses: 5, pf: 1012.6, pa: 1048.8, streak: "W1" },
  { team: "Red Zone Renegades",   manager: "Nina",    wins: 4, losses: 5, pf: 998.3,  pa: 1039.6, streak: "L1" },
  { team: "The Audible Alibis",   manager: "Frankie", wins: 3, losses: 6, pf: 974.1,  pa: 1077.4, streak: "L3" },
  { team: "Pigskin Pirates",      manager: "Joe",     wins: 3, losses: 6, pf: 961.7,  pa: 1090.2, streak: "W1" },
  { team: "Two Point Converts",   manager: "Lena",    wins: 2, losses: 7, pf: 933.5,  pa: 1102.8, streak: "L2" },
  { team: "The Taco Corners",     manager: "Sal",     wins: 1, losses: 8, pf: 890.2,  pa: 1130.7, streak: "L5" },
];

// Latest week's scores — update after each week.
export const WEEKLY_SCORES = {
  week: 9,
  matchups: [
    { home: "Turf Burn United",    homeScore: 132.4, away: "The Taco Corners",    awayScore: 88.1 },
    { home: "The Waiver Wolves",   homeScore: 118.9, away: "Red Zone Renegades",  awayScore: 104.2 },
    { home: "Bench Warmers Anon",  homeScore: 111.7, away: "Gridiron Gravy",      awayScore: 109.5 },
    { home: "Hail Mary Hooligans", homeScore: 124.3, away: "The Blitz Krieg",     awayScore: 97.8 },
    { home: "Fourth & Long Shots", homeScore: 102.6, away: "The Audible Alibis",  awayScore: 95.4 },
    { home: "Pigskin Pirates",     homeScore: 106.1, away: "Two Point Converts",  awayScore: 99.9 },
  ],
};

// Trophy Room — past champions.
export const CHAMPIONS = [
  { year: 2025, team: "The Waiver Wolves",   manager: "Dom",    record: "11-3", note: "Won the title on a Monday-night miracle: 27 points from a backup TE." },
  { year: 2024, team: "Turf Burn United",    manager: "Austin", record: "10-4", note: "Rode a league-record 1,540 points scored to a wire-to-wire season." },
  { year: 2023, team: "Gridiron Gravy",      manager: "Marcus", record: "9-5",  note: "Snuck in as the 5 seed, then outscored everyone in the playoffs." },
  { year: 2022, team: "Hail Mary Hooligans", manager: "Steve",  record: "12-2", note: "Dominant season, and he has never once let anyone forget it." },
];

export function sortedStandings() {
  return [...TEAMS].sort((a, b) => b.wins - a.wins || b.pf - a.pf);
}
