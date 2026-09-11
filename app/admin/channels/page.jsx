import Link from "next/link";
import AdminLoginForm from "@/components/AdminLoginForm";
import AdminChannels from "@/components/AdminChannels";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";
import { CHANNELS_TABLE, toWireChannel } from "@/lib/neighborhood/channels";

export const dynamic = "force-dynamic";

export const metadata = { title: "TV Channels" };

// Commissioner-only channel lineup for the two big screens
// (milestone 28). Two lists: the YouTube TV links the popup
// broadcast can be pointed at, and the public YouTube channels
// the screens play when nobody is broadcasting. The heavy
// lifting (forms + actions) lives in the client component;
// this page is the gate and the first load.
export default async function AdminChannelsPage() {
  if (!(await isAuthed())) {
    return <AdminLoginForm />;
  }

  let channels = [];
  let loadError = null;
  const supabase = getAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from(CHANNELS_TABLE)
      .select("id, kind, name, url, sort, enabled, created_at")
      .order("kind", { ascending: true })
      .order("sort", { ascending: true })
      .order("created_at", { ascending: true });
    channels = (data || []).map(toWireChannel);
    loadError = error?.message || null;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <Link href="/admin" className="text-sm text-link hover:underline">
          &larr; Back to dashboard
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100">
          TV Channels
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          What the big screens in Mission Control and the Sports Bar can show.
          Everyone in those rooms sees this lineup in the TV guide and can flip
          between them &mdash; one change every 12 seconds, room-wide.
        </p>
      </div>

      {loadError && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          Couldn&apos;t load channels: {loadError}
        </div>
      )}

      <AdminChannels initial={channels} />
    </div>
  );
}
