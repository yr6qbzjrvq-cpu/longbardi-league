import { notFound } from "next/navigation";
import MinesweeperGame from "@/components/MinesweeperGame";
import { canSeeMinesweeper } from "@/lib/minesweeperAccess";
import { MINESWEEPER_PUBLIC } from "@/lib/leagueData";

export const dynamic = "force-dynamic";

export const metadata = { title: "Minesweeper" };

export default async function MinesweeperPage() {
  if (!(await canSeeMinesweeper())) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {!MINESWEEPER_PUBLIC && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <strong>Preview.</strong> Only you can see this. There&apos;s no link
          to it anywhere on the site yet.
        </div>
      )}

      <div className="mb-6 border-b-2 border-espn pb-3">
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100 sm:text-4xl">
          Minesweeper
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Clear the field without hitting a mine. The commissioner&apos;s minefield
          takes no prisoners.
        </p>
      </div>

      <MinesweeperGame />
    </div>
  );
}
