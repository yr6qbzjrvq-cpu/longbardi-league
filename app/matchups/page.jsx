import { notFound } from "next/navigation";
import Link from "next/link";
import MatchupBoard from "@/components/MatchupBoard";
import { canSeeFantasy } from "@/lib/fantasyAccess";
import { isPlaceholder } from "@/lib/fantasy";
import { totalWeeks } from "@/lib/nfl";

export const dynamic = "force-dynamic";

export const metadata = { title: "Matchups" };

export default async function MatchupsPage() {
  if (!(await canSeeFantasy())) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {isPlaceholder() && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Preview.</strong> These names and scores are made up so the
          page can be built before the draft. Only you can see this.
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b-2 border-espn pb-3">
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-gray-900 sm:text-4xl">
          Matchups
        </h1>
        <Link
          href="/teams"
          className="font-display text-xs uppercase tracking-widest text-link hover:underline"
        >
          Rosters &rarr;
        </Link>
      </div>
      <p className="mb-8 text-sm text-gray-500">
        Scores refresh on their own while games are on.
      </p>

      <MatchupBoard initialWeek={1} totalWeeks={totalWeeks()} />
    </div>
  );
}
