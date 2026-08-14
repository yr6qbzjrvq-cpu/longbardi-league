import { NextResponse } from "next/server";
import { getWeek, currentSeason, totalWeeks, scorePicks } from "@/lib/nfl";
import { getAllPicks, getPlayers } from "@/lib/pickem";

export const dynamic = "force-dynamic";

// Season standings. Only scores games that have actually finished, so an
// unplayed week never counts against anyone.
export async function GET() {
  const season = currentSeason();
  const [players, picks] = await Promise.all([getPlayers(), getAllPicks(season)]);

  const weeksPlayed = [];
  for (let w = 1; w <= totalWeeks(); w++) {
    const data = await getWeek(w);
    if (!data || data.games.length === 0) continue;
    if (data.games.some((g) => g.completed)) weeksPlayed.push(data);
  }

  const byPlayer = new Map();
  for (const row of picks) {
    if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, {});
    const weeks = byPlayer.get(row.player_id);
    if (!weeks[row.week]) weeks[row.week] = {};
    weeks[row.week][row.game_id] = row.pick;
  }

  const standings = players.map((p) => {
    const weeks = byPlayer.get(p.id) || {};
    let correct = 0;
    let decided = 0;
    const weekly = [];

    for (const wd of weeksPlayed) {
      const wp = weeks[wd.week] || {};
      const s = scorePicks(wd.games, wp);
      correct += s.correct;
      decided += s.decided;
      weekly.push({ week: wd.week, correct: s.correct, decided: s.decided });
    }

    return {
      name: p.name,
      correct,
      decided,
      pct: decided ? correct / decided : 0,
      weekly,
    };
  });

  standings.sort(
    (a, b) => b.correct - a.correct || b.pct - a.pct || a.name.localeCompare(b.name)
  );

  return NextResponse.json({
    season,
    weeksScored: weeksPlayed.map((w) => w.week),
    standings,
  });
}
