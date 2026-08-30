import Link from "next/link";
import AdminLoginForm from "@/components/AdminLoginForm";
import NeighborhoodModeration from "@/components/NeighborhoodModeration";
import { isAuthed } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Neighborhood Moderation" };

// Commissioner-only moderation for HSPNeighborhood (milestone
// 7): live roster with mute/kick, plus the chat trail with
// per-message delete. The heavy lifting (polling + actions)
// lives in the client component; this page is just the gate.
export default async function NeighborhoodModerationPage() {
  if (!(await isAuthed())) {
    return <AdminLoginForm />;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <Link href="/admin" className="text-sm text-link hover:underline">
          &larr; Back to dashboard
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100">
          Neighborhood Moderation
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Who&apos;s in HSPNeighborhood right now, and the recent chat trail.
          Only visible to you.
        </p>
      </div>
      <NeighborhoodModeration />
    </div>
  );
}
