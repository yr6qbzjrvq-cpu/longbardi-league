import { notFound } from "next/navigation";
import Link from "next/link";
import PickemBoard from "@/components/PickemBoard";
import { getDefaultWeek, totalWeeks } from "@/lib/nfl";
import { canSeePickem } from "@/lib/pickemAccess";
import { PICKEM_PUBLIC } from "@/lib/leagueData";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pick 'Em",
  description: "Weekly NFL pick 'em for the Longbardi League.",
};

export default async function PickemPage() {
  // While the game is private this page doesn't exist for anyone but you.
  if (!(await canSeePickem())) notFound();

  const initialWeek = await getDefaultWeek();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {!PICKEM_PUBLIC && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Preview.</strong> Only you can see this. Everyone else gets a
          404 and there&apos;s no link in the menu.
        </div>
      )}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b-2 border-espn pb-3">
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-gray-900 sm:text-4xl">
          Pick &apos;Em
        </h1>
        <Link
          href="/pickem/standings"
          className="font-display text-xs uppercase tracking-widest text-link hover:underline"
        >
          Season Standings &rarr;
        </Link>
      </div>
      <p className="mb-8 text-sm text-gray-500">
        Pick every game. Nobody sees anyone else&apos;s picks until the first
        kickoff of the week.
      </p>

      <PickemBoard initialWeek={initialWeek} totalWeeks={totalWeeks()} />
    </div>
  );
}
