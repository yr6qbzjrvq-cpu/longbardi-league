import Link from "next/link";
import AdminLoginForm from "@/components/AdminLoginForm";
import AnnouncementForm from "@/components/AnnouncementForm";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";
import { formatAnnouncementDate } from "@/lib/announcements";

export const dynamic = "force-dynamic";

export const metadata = { title: "Announcements" };

export default async function AdminAnnouncementsPage() {
  if (!(await isAuthed())) {
    return <AdminLoginForm />;
  }

  let announcements = [];
  let loadError = null;
  const supabase = getAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("announcements")
      .select("*")
      .order("published_on", { ascending: false })
      .order("created_at", { ascending: false });
    announcements = data || [];
    loadError = error?.message || null;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-link hover:underline">
          &larr; Back to dashboard
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
          Announcements
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Whatever you type here goes on the site exactly as written.
        </p>
      </div>

      <h2 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-gray-900">
        Write a new one
      </h2>
      <AnnouncementForm />

      {loadError && (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          Couldn&apos;t load announcements: {loadError}
        </div>
      )}

      <h2 className="mb-3 mt-10 border-b-2 border-espn pb-2 font-display text-lg font-semibold uppercase tracking-wide text-gray-900">
        Posted ({announcements.length})
      </h2>

      {announcements.length === 0 ? (
        <p className="rounded-md border border-gray-200 px-4 py-8 text-center text-gray-500">
          Nothing posted yet.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {announcements.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-display text-base font-semibold text-gray-900">
                  {a.title}
                </p>
                <p className="text-xs text-gray-500">
                  {formatAnnouncementDate(a.published_on)}
                </p>
              </div>
              <Link
                href={`/admin/announcements/${a.id}`}
                className="shrink-0 font-display text-xs uppercase tracking-widest text-link hover:underline"
              >
                Edit
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
