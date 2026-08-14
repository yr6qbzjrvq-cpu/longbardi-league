import Link from "next/link";
import AdminLoginForm from "@/components/AdminLoginForm";
import AdminPickemRow from "@/components/AdminPickemRow";
import { isAuthed } from "@/lib/auth";
import { getPlayers, getAllPicks } from "@/lib/pickem";
import { currentSeason } from "@/lib/nfl";

export const dynamic = "force-dynamic";

export const metadata = { title: "Pick 'Em Players" };

export default async function AdminPickemPage() {
  if (!(await isAuthed())) {
    return <AdminLoginForm />;
  }

  const [players, picks] = await Promise.all([
    getPlayers(),
    getAllPicks(currentSeason()),
  ]);

  const counts = {};
  for (const row of picks) {
    counts[row.player_id] = (counts[row.player_id] || 0) + 1;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <Link href="/admin" className="text-sm text-link hover:underline">
          &larr; Back to dashboard
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
          Pick &apos;Em Players
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {players.length} player{players.length === 1 ? "" : "s"}. PINs are
          hashed, so nobody can look one up &mdash; if someone forgets theirs,
          reset them here and they&apos;ll set a new one next time they sign in.
        </p>
      </div>

      <div className="space-y-3">
        {players.map((p) => (
          <AdminPickemRow key={p.id} player={p} picks={counts[p.id] || 0} />
        ))}
        {players.length === 0 && (
          <p className="rounded-md border border-gray-200 px-4 py-8 text-center text-gray-500">
            Nobody has signed in to Pick &apos;Em yet.
          </p>
        )}
      </div>
    </div>
  );
}
