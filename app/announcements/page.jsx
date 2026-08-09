import ArticleBody from "@/components/ArticleBody";
import Comments from "@/components/Comments";
import { getAnnouncements, formatAnnouncementDate } from "@/lib/announcements";

export const dynamic = "force-dynamic";

export const metadata = { title: "Announcements" };

export default async function AnnouncementsPage() {
  const announcements = await getAnnouncements();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 border-b-2 border-espn pb-3 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
        Announcements
      </h1>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/commissioner.svg"
        alt="The Commissioner at the podium"
        className="w-full rounded-md border border-gray-200"
      />
      <p className="mt-2 text-sm text-gray-500">
        Austin Hillis, Commissioner of the Longbardi League.
      </p>

      <div className="mt-10 space-y-14">
        {announcements.length === 0 && (
          <p className="rounded-md border border-gray-200 px-5 py-8 text-center text-gray-500">
            No announcements yet.
          </p>
        )}

        {announcements.map((a) => {
          // Keyed by date so comment threads written before announcements
          // moved into the database stay attached.
          const threadKey = `announcement:${String(a.published_on).slice(0, 10)}`;
          return (
            <article key={a.id}>
              <p className="mb-2 font-display text-xs font-semibold uppercase tracking-widest text-espn">
                {formatAnnouncementDate(a.published_on)}
              </p>
              <h2 className="mb-4 font-display text-2xl font-semibold leading-tight text-gray-900 sm:text-3xl">
                {a.title}
              </h2>
              <div className="article-body">
                <ArticleBody content={a.body} />
              </div>
              <Comments threadKey={threadKey} />
            </article>
          );
        })}
      </div>
    </div>
  );
}
