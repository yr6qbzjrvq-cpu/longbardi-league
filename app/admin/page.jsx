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
          <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
            Commissioner Dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Create, edit, and publish league articles.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/new"
            className="rounded-md bg-espn px-6 py-2 font-display uppercase tracking-widest text-white transition-colors hover:bg-espn-dark"
          >
            + Create New Article
          </Link>
          <Link
            href="/admin/announcements"
            className="rounded-md border border-espn px-6 py-2 font-display uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white"
          >
            Announcements
          </Link>
          <Link
            href="/admin/subscribers"
            className="rounded-md border border-espn px-6 py-2 font-display uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white"
          >
            Subscribers
          </Link>
          <Link
            href="/admin/cats"
            className="rounded-md border border-espn px-6 py-2 font-display uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white"
          >
            Cat Photos
          </Link>
          <Link
            href="/admin/upload"
            className="rounded-md border border-espn px-6 py-2 font-display uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white"
          >
            Upload Image
          </Link>
          <Link
            href="/admin/pickem"
            className="rounded-md border border-espn px-6 py-2 font-display uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white"
          >
            Pick &apos;Em
          </Link>
          <LogoutButton />
        </div>
      </div>

      {!isSupabaseConfigured() && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Supabase not connected yet.</strong> The public site is
          showing sample articles. Add your Supabase keys to{" "}
          <code className="rounded bg-amber-100 px-1">.env.local</code> (and
          Vercel) to enable publishing — see the README.
        </div>
      )}

      {loadError && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          Couldn&apos;t load articles: {loadError}
        </div>
      )}

      <div className="space-y-3">
        {articles.map((article) => (
          <AdminArticleRow key={article.id} article={article} />
        ))}
        {articles.length === 0 && isSupabaseConfigured() && !loadError && (
          <p className="rounded-md border border-gray-200 px-4 py-8 text-center text-gray-500">
            No articles yet. Hit &ldquo;Create New Article&rdquo; to publish
            your first story.
          </p>
        )}
      </div>
    </div>
  );
}
