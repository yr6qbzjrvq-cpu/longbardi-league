import { LEAGUE, CHAMPIONS, BRAND } from "@/lib/leagueData";
import SubscribeForm from "@/components/SubscribeForm";

const est = CHAMPIONS.length
  ? Math.min(...CHAMPIONS.map((c) => c.year))
  : LEAGUE.season;

export default function Footer() {
  return (
    <footer className="mt-12 bg-nav">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <SubscribeForm />
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-gray-400 sm:flex-row sm:px-6">
          <p className="font-display uppercase tracking-widest">
            {BRAND.abbr} &middot; {BRAND.full}
          </p>
          <p>
            &copy; {LEAGUE.season} {LEAGUE.name} League &middot; Est. {est}
          </p>
        </div>
      </div>
    </footer>
  );
}
