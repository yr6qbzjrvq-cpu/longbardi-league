import { notFound } from "next/navigation";
import DeepThreatGame from "@/components/DeepThreatGame";
import { canSeeDeepThreat } from "@/lib/deepThreatAccess";
import { DEEPTHREAT_PUBLIC, TEAMS } from "@/lib/leagueData";

export const dynamic = "force-dynamic";

export const metadata = { title: "Deep Threat" };

export default async function DeepThreatPage() {
  if (!(await canSeeDeepThreat())) notFound();

  const names = TEAMS.map((t) => t.manager);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {!DEEPTHREAT_PUBLIC && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Preview.</strong> Only you can see this. There&apos;s no link
          to it anywhere on the site yet.
        </div>
      )}

      <div className="mb-6 border-b-2 border-espn pb-3">
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-gray-900 sm:text-4xl">
          Deep Threat
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Hit the receiver in stride before he reaches the end zone. Miss and
          the streak starts over.
        </p>
      </div>

      <DeepThreatGame names={names} />
    </div>
  );
}
