import { notFound } from "next/navigation";
import HailMaryGame from "@/components/HailMaryGame";
import { canSeeHailMary } from "@/lib/hailMaryAccess";
import { HAILMARY_PUBLIC } from "@/lib/leagueData";

export const dynamic = "force-dynamic";

export const metadata = { title: "Hail Mary" };

export default async function HailMaryPage() {
  if (!(await canSeeHailMary())) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {!HAILMARY_PUBLIC && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Preview.</strong> Only you can see this. There&apos;s no link
          to it anywhere on the site yet.
        </div>
      )}

      <div className="mb-6 border-b-2 border-espn pb-3">
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-gray-900 sm:text-4xl">
          Hail Mary
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Sling footballs at the towers and take down every star.
        </p>
      </div>

      <HailMaryGame />
    </div>
  );
}
