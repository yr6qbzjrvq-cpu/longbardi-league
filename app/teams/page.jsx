import { notFound } from "next/navigation";
import Link from "next/link";
import { canSeeFantasy } from "@/lib/fantasyAccess";
import { getRosters, isPlaceholder } from "@/lib/fantasy";

export const dynamic = "force-dynamic";

export const metadata = { title: "Rosters" };

function Row({ player }) {
  return (
    <tr>
      <td className="w-12 border-b border-gray-100 px-3 py-2 font-display text-xs uppercase tracking-widest text-gray-400">
        {player.slot}
      </td>
      <td className="border-b border-gray-100 px-3 py-2 text-sm text-gray-900">
        {player.name}
        <span className="ml-2 text-xs text-gray-400">{player.nflTeam}</span>
      </td>
      <td className="border-b border-gray-100 px-3 py-2 text-right text-sm text-gray-600">
        {player.points.toFixed(1)}
      </td>
    </tr>
  );
}

export default async function TeamsPage() {
  if (!(await canSeeFantasy())) notFound();

  const rosters = await getRosters(1);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {isPlaceholder() && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Preview.</strong> These rosters are made up so the page can be
          built before the draft. Only you can see this.
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b-2 border-espn pb-3">
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-gray-900 sm:text-4xl">
          Rosters
        </h1>
        <Link
          href="/matchups"
          className="font-display text-xs uppercase tracking-widest text-link hover:underline"
        >
          Matchups &rarr;
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {rosters.map((roster) => (
          <section
            key={roster.manager}
            className="rounded-md border border-gray-200"
          >
            <header className="border-b border-gray-200 bg-gray-50 px-4 py-3">
              <h2 className="font-display text-lg uppercase tracking-wide text-gray-900">
                {roster.teamName}
              </h2>
              <p className="text-xs text-gray-500">{roster.manager}</p>
            </header>
            <table className="w-full border-collapse">
              <tbody>
                {roster.starters.map((p, i) => (
                  <Row key={`s${i}`} player={p} />
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
                  <Row key={`b${i}`} player={p} />
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}
