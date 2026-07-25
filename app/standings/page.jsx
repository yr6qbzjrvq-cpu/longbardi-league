import StandingsTable from "@/components/StandingsTable";
import { CHAMPIONS, LEAGUE, isPreseason } from "@/lib/leagueData";

export const metadata = { title: "Standings & History" };

export default function StandingsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="mb-1 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900 sm:text-4xl">
        {LEAGUE.season} Standings
      </h1>
      <p className="mb-6 text-sm text-gray-500">
        {isPreseason()
          ? "Preseason"
          : `Through Week ${LEAGUE.currentWeek - 1}`}{" "}
        · Top 6 make the playoffs · Top 2 earn byes
      </p>

      <div className="rounded-md border border-gray-200 p-5">
        <StandingsTable />
      </div>

      {/* Trophy Room */}
      <section className="mt-14">
        <div className="mb-6 flex items-center gap-3 border-b-2 border-espn pb-3">
          <span className="text-3xl">🏆</span>
          <h2 className="font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
            Trophy Room
          </h2>
        </div>
        {CHAMPIONS.length === 0 && (
          <p className="rounded-md border border-gray-200 px-5 py-8 text-center text-gray-500">
            No champions recorded yet.
          </p>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          {CHAMPIONS.map((c) => (
            <div
              key={c.year}
              className={`relative overflow-hidden rounded-md border bg-white p-6 ${
                c.pending
                  ? "border-dashed border-gray-400"
                  : "border-gray-200"
              }`}
            >
              <span className="absolute -right-4 -top-6 font-display text-8xl font-bold text-gray-100">
                {c.year}
              </span>
              <p className="relative font-display text-xs font-semibold uppercase tracking-widest text-espn">
                {c.pending ? `${c.year} Placeholder` : `${c.year} Champion`}
              </p>
              <h3 className="relative mt-1 font-display text-2xl font-semibold uppercase tracking-wide text-gray-900">
                {c.team}
              </h3>
              {c.note && (
                <p className="relative mt-3 text-sm text-gray-600">{c.note}</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
