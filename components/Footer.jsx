import { LEAGUE, CHAMPIONS, BRAND } from "@/lib/leagueData";

const est = CHAMPIONS.length
  ? Math.min(...CHAMPIONS.map((c) => c.year))
  : LEAGUE.season;

export default function Footer() {
  return (
    <footer className="mt-12 bg-nav">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-gray-400 sm:flex-row sm:px-6">
        <p className="font-display uppercase tracking-widest">
          {BRAND.abbr} &middot; {BRAND.full}
        </p>
        <p>
          &copy; {LEAGUE.season} {LEAGUE.name} League &middot; Est. {est}
        </p>
      </div>
    </footer>
  );
}
