import Link from "next/link";
import { currentSeason, totalWeeks, getWeek, scorePicks } from "@/lib/nfl";
import { getAllPicks, getPlayers } from "@/lib/pickem";

export const dynamic = "force-dynamic";

export const metadata = { title: "Pick 'Em Standings" };

export default async function PickemStandingsPage() {
  const season = currentSeason();
  const [players, picks] = await Promise.all([getPlayers(), getAllPicks(season)]);

  // Only weeks with at least one finished game count.
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

  const standings = players
    .map((p) => {
      const weeks = byPlayer.get(p.id) || {};
      let correct = 0;
      let decided = 0;
      const weekly = [];
      for (const wd of weeksPlayed) {
        const s = scorePicks(wd.games, weeks[wd.week] || {});
        correct += s.correct;
        decided += s.decided;
        weekly.push({ week: wd.week, correct: s.correct });
      }
      return {
        name: p.name,
        correct,
        decided,
        pct: decided ? correct / decided : 0,
        weekly,
        best: weekly.length ? Math.max(...weekly.map((w) => w.correct)) : 0,
      };
    })
    .sort(
      (a, b) =>
        b.correct - a.correct || b.pct - a.pct || a.name.localeCompare(b.name)
    );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b-2 border-espn pb-3">
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
          Pick &apos;Em Standings
        </h1>
        <Link
          href="/pickem"
          className="font-display text-xs uppercase tracking-widest text-link hover:underline"
        >
          &larr; Make Picks
        </Link>
      </div>

      {weeksPlayed.length === 0 ? (
        <p className="rounded-md border border-gray-200 px-5 py-12 text-center text-gray-500">
          Nothing to score yet. Standings appear once games start finishing.
        </p>
      ) : standings.length === 0 ? (
        <p className="rounded-md border border-gray-200 px-5 py-12 text-center text-gray-500">
          No players yet.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-gray-500">
            Season {season} &middot; through Week{" "}
            {weeksPlayed[weeksPlayed.length - 1].week}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="border-b border-gray-200 px-3 py-2 font-display text-xs uppercase tracking-widest text-gray-600">
                    #
                  </th>
                  <th className="border-b border-gray-200 px-3 py-2 font-display text-xs uppercase tracking-widest text-gray-600">
                    Player
                  </th>
                  <th className="border-b border-gray-200 px-3 py-2 text-right font-display text-xs uppercase tracking-widest text-gray-600">
                    Correct
                  </th>
                  <th className="border-b border-gray-200 px-3 py-2 text-right font-display text-xs uppercase tracking-widest text-gray-600">
                    Games
                  </th>
                  <th className="border-b border-gray-200 px-3 py-2 text-right font-display text-xs uppercase tracking-widest text-gray-600">
                    Pct
                  </th>
                  <th className="border-b border-gray-200 px-3 py-2 text-right font-display text-xs uppercase tracking-widest text-gray-600">
                    Best Wk
                  </th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s, i) => (
                  <tr key={s.name}>
                    <td className="border-b border-gray-100 px-3 py-2 text-gray-500">
                      {i + 1}
                    </td>
                    <td className="border-b border-gray-100 px-3 py-2 font-medium text-gray-900">
                      {s.name}
                    </td>
                    <td className="border-b border-gray-100 px-3 py-2 text-right font-display font-semibold text-gray-900">
                      {s.correct}
                    </td>
                    <td className="border-b border-gray-100 px-3 py-2 text-right text-gray-600">
                      {s.decided}
                    </td>
                    <td className="border-b border-gray-100 px-3 py-2 text-right text-gray-600">
                      {s.decided ? (s.pct * 100).toFixed(1) + "%" : "—"}
                    </td>
                    <td className="border-b border-gray-100 px-3 py-2 text-right text-gray-600">
                      {s.best}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mb-3 mt-10 border-b-2 border-espn pb-2 font-display text-xl font-semibold uppercase tracking-wide text-gray-900">
            Week by Week
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="border-b border-gray-200 px-3 py-2 font-display text-xs uppercase tracking-widest text-gray-600">
                    Player
                  </th>
                  {weeksPlayed.map((w) => (
                    <th
                      key={w.week}
                      className="border-b border-gray-200 px-2 py-2 text-center font-display text-xs uppercase tracking-widest text-gray-600"
                    >
                      {w.week}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {standings.map((s) => (
                  <tr key={s.name}>
                    <td className="border-b border-gray-100 px-3 py-2 font-medium text-gray-900">
                      {s.name}
                    </td>
                    {s.weekly.map((w) => (
                      <td
                        key={w.week}
                        className="border-b border-gray-100 px-2 py-2 text-center text-gray-700"
                      >
                        {w.correct}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
