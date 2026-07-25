import Link from "next/link";
import AdminLoginForm from "@/components/AdminLoginForm";
import AdminArticleRow from "@/components/AdminArticleRow";
import LogoutButton from "@/components/LogoutButton";
import { isAuthed } from "@/lib/auth";
import { getAdminClient, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  if (!(await isAuthed())) {
    return <AdminLoginForm />;
  }

  let articles = [];
  let loadError = null;
  const supabase = getAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("articles")
      .select("*")
      .order("created_at", { ascending: false });
    articles = data || [];
    loadError = error?.message || null;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl uppercase tracking-wide text-white">
            Commissioner Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Create, edit, and publish league articles.
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/admin/new"
            className="rounded-lg bg-turf-500 px-6 py-2 font-display uppercase tracking-widest text-ink-950 transition-colors hover:bg-turf-400"
          >
            + Create New Article
          </Link>
          <LogoutButton />
        </div>
      </div>

      {!isSupabaseConfigured() && (
        <div className="mb-6 rounded-lg border border-blaze-500/40 bg-blaze-500/10 px-4 py-3 text-sm text-blaze-400">
          <strong>Supabase not connected yet.</strong> The public site is
          showing sample articles. Add your Supabase keys to{" "}
          <code className="rounded bg-ink-800 px-1">.env.local</code> (and
          Vercel) to enable publishing — see the README.
        </div>
      )}

      {loadError && (
        <div className="mb-6 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          Couldn&apos;t load articles: {loadError}
        </div>
      )}

      <div className="space-y-3">
        {articles.map((article) => (
          <AdminArticleRow key={article.id} article={article} />
        ))}
        {articles.length === 0 && isSupabaseConfigured() && !loadError && (
          <p className="rounded-lg border border-ink-700 bg-ink-800 px-4 py-8 text-center text-slate-400">
            No articles yet. Hit &ldquo;Create New Article&rdquo; to publish
            your first story.
          </p>
        )}
      </div>
    </div>
  );
}
