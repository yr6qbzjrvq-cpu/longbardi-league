import { NextResponse } from "next/server";
import { getWeek, isLocked, currentSeason, scorePicks } from "@/lib/nfl";
import { getPicksForWeek, getPlayers } from "@/lib/pickem";

export const dynamic = "force-dynamic";

// Public view of a week. Before the lock this returns the schedule and who has
// submitted, but NEVER what anyone picked. After the lock it returns everything.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const week = Number(searchParams.get("week"));

  const weekData = await getWeek(week);
  if (!weekData) {
    return NextResponse.json({ error: "Bad week." }, { status: 400 });
  }

  const locked = isLocked(weekData);
  const [players, rows] = await Promise.all([
    getPlayers(),
    getPicksForWeek(currentSeason(), week),
  ]);

  const byPlayer = new Map();
  for (const row of rows) {
    if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, {});
    byPlayer.get(row.player_id)[row.game_id] = row.pick;
  }

  const entries = players
    .filter((p) => byPlayer.has(p.id))
    .map((p) => {
      const picks = byPlayer.get(p.id) || {};
      const { correct, decided } = scorePicks(weekData.games, picks);
      return {
        name: p.name,
        submitted: Object.keys(picks).length,
        correct,
        decided,
        // The whole point of the feature: withhold picks until kickoff.
        picks: locked ? picks : null,
      };
    })
    .sort((a, b) => b.correct - a.correct || a.name.localeCompare(b.name));

  return NextResponse.json({
    week: weekData.week,
    games: weekData.games,
    lockAt: weekData.lockAt,
    locked,
    entries,
  });
}
