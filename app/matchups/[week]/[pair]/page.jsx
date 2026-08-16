import { notFound } from "next/navigation";
import Link from "next/link";
import { canSeeFantasy } from "@/lib/fantasyAccess";
import { getMatchup, isPlaceholder, statLine } from "@/lib/fantasy";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { week, pair } = await params;
  const matchup = await getMatchup(Number(week), pair);
  if (!matchup) return { title: "Matchup" };
  return {
    title: `${matchup.away.manager} vs ${matchup.home.manager} — Week ${week}`,
  };
}

function PlayerRow({ player }) {
  return (
    <tr>
      <td className="w-12 border-b border-gray-100 px-3 py-2 align-top font-display text-xs uppercase tracking-widest text-gray-400">
        {player.slot}
      </td>
      <td className="border-b border-gray-100 px-3 py-2">
        <p className="text-sm text-gray-900">
          {player.name}
          <span className="ml-2 text-xs text-gray-400">
            {player.position} · {player.nflTeam}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-gray-500">{statLine(player)}</p>
      </td>
      <td className="w-16 border-b border-gray-100 px-3 py-2 text-right align-top font-display text-sm text-gray-900">
        {player.points.toFixed(1)}
      </td>
    </tr>
  );
}

function TeamColumn({ side }) {
  const roster = side.roster;
  if (!roster) return null;

  return (
    <section className="rounded-md border border-gray-200">
      <header className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="font-display text-lg uppercase tracking-wide text-gray-900">
              {side.teamName}
            </h2>
            <p className="text-xs text-gray-500">{side.manager}</p>
          </div>
          <p className="font-display text-2xl text-gray-900">
            {side.points.toFixed(1)}
          </p>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Proj {side.projected.toFixed(1)}
          {side.yetToPlay > 0 && ` · ${side.yetToPlay} yet to play`}
        </p>
      </header>

      <table className="w-full border-collapse">
        <tbody>
          {roster.starters.map((p, i) => (
            <PlayerRow key={`s${i}`} player={p} />
          ))}
          <tr>
            <td
              colSpan={3}
              className="border-b border-gray-100 bg-gray-50 px-3 py-1 font-display text-[10px] uppercase tracking-widest text-gray-400"
            >
              Bench
            </td>
          </tr>
          {roster.bench.map((p, i) => (
            <PlayerRow key={`b${i}`} player={p} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default async function MatchupDetailPage({ params }) {
  if (!(await canSeeFantasy())) notFound();

  const { week, pair } = await params;
  const weekNumber = Number(week);
  if (!weekNumber || weekNumber < 1 || weekNumber > 18) notFound();

  const matchup = await getMatchup(weekNumber, pair);
  if (!matchup) notFound();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {isPlaceholder() && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Preview.</strong> These players, points and stats are made up.
          Only you can see this.
        </div>
      )}

      <div className="mb-2">
        <Link
          href="/matchups"
          className="font-display text-xs uppercase tracking-widest text-link hover:underline"
        >
          &larr; All matchups
        </Link>
      </div>

      <div className="mb-6 border-b-2 border-espn pb-3">
        <p className="font-display text-xs uppercase tracking-widest text-gray-500">
          Week {matchup.week}
        </p>
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide text-gray-900 sm:text-3xl">
          {matchup.away.manager}{" "}
          <span className="text-gray-300">vs</span> {matchup.home.manager}
        </h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TeamColumn side={matchup.away} />
        <TeamColumn side={matchup.home} />
      </div>
    </div>
  );
}
