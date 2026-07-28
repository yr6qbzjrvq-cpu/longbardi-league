import Link from "next/link";
import AdminLoginForm from "@/components/AdminLoginForm";
import SubscriberList from "@/components/SubscriberList";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const metadata = { title: "Subscribers" };

export default async function SubscribersPage() {
  if (!(await isAuthed())) {
    return <AdminLoginForm />;
  }

  let subscribers = [];
  let loadError = null;
  const supabase = getAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("subscribers")
      .select("*")
      .order("created_at", { ascending: false });
    subscribers = data || [];
    loadError = error?.message || null;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <Link
          href="/admin"
          className="text-sm text-link hover:underline"
        >
          &larr; Back to dashboard
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
          Subscribers
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {subscribers.length} total. This page is only visible to you.
        </p>
      </div>

      {loadError && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          Couldn&apos;t load subscribers: {loadError}
        </div>
      )}

      <SubscriberList subscribers={subscribers} />
    </div>
  );
}
