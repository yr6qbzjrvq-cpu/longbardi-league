import { LEAGUE, CHAMPIONS } from "@/lib/leagueData";

const CHAMPS_SINCE = Math.min(...CHAMPIONS.map((c) => c.year));

export default function Footer() {
  return (
    <footer className="border-t border-ink-700 bg-ink-900">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:px-6">
        <p className="font-display uppercase tracking-widest">
          {LEAGUE.name} League &middot; Est. {CHAMPS_SINCE}
        </p>
        <p>Bragging rights guaranteed. Refunds unavailable.</p>
      </div>
    </footer>
  );
}
