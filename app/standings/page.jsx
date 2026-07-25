import StandingsTable from "@/components/StandingsTable";
import { CHAMPIONS, LEAGUE } from "@/lib/leagueData";

export const metadata = { title: "Standings & History" };

export default function StandingsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="mb-1 font-display text-3xl uppercase tracking-wide text-white sm:text-4xl">
        {LEAGUE.season} Standings
      </h1>
      <p className="mb-6 text-sm text-slate-400">
        Through Week {LEAGUE.currentWeek - 1} · Top 6 make the playoffs · Top 2
        earn byes
      </p>

      <div className="rounded-xl border border-ink-700 bg-ink-800 p-5">
        <StandingsTable />
      </div>

      {/* Trophy Room */}
      <section className="mt-14">
        <div className="mb-6 flex items-center gap-3 border-b-2 border-blaze-500 pb-3">
          <span className="text-3xl">🏆</span>
          <h2 className="font-display text-3xl uppercase tracking-wide text-white">
            Trophy Room
          </h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {CHAMPIONS.map((c) => (
            <div
              key={c.year}
              className="relative overflow-hidden rounded-xl border border-ink-700 bg-ink-800 p-6"
            >
              <span className="absolute -right-4 -top-6 font-display text-8xl font-bold text-ink-700/60">
                {c.year}
              </span>
              <p className="font-display text-xs uppercase tracking-widest text-blaze-400">
                {c.year} Champion
              </p>
              <h3 className="mt-1 font-display text-2xl uppercase tracking-wide text-white">
                {c.team}
              </h3>
              <p className="mt-1 text-sm text-slate-400">
                Manager: <span className="text-slate-200">{c.manager}</span> ·{" "}
                {c.record}
              </p>
              <p className="relative mt-3 text-sm text-slate-400">{c.note}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
