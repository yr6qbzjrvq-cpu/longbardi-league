import { notFound } from "next/navigation";
import NeighborhoodAvatarCreator from "@/components/NeighborhoodAvatarCreator";
import { canSeeNeighborhood } from "@/lib/neighborhoodAccess";
import { NEIGHBORHOOD_PUBLIC } from "@/lib/leagueData";

export const dynamic = "force-dynamic";

export const metadata = { title: "HSPNeighborhood" };

export default async function NeighborhoodPage() {
  if (!(await canSeeNeighborhood())) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {!NEIGHBORHOOD_PUBLIC && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <strong>Preview.</strong> Only the admin login can see this. Your
          character saves to this browser, so it&apos;s ready the moment the
          Town Square opens.
        </div>
      )}

      <div className="mb-6 border-b-2 border-espn pb-3">
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100 sm:text-4xl">
          HSPNeighborhood
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Make your character. The Town Square opens soon.
        </p>
      </div>

      <NeighborhoodAvatarCreator />
    </div>
  );
}
