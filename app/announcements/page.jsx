import { ANNOUNCEMENTS, formatAnnouncementDate } from "@/lib/announcements";
import Comments from "@/components/Comments";

export const metadata = { title: "Announcements" };

export default function AnnouncementsPage() {
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
        {ANNOUNCEMENTS.length === 0 && (
          <p className="rounded-md border border-gray-200 px-5 py-8 text-center text-gray-500">
            No announcements yet.
          </p>
        )}

        {ANNOUNCEMENTS.map((a) => (
          <article key={a.date + a.title}>
            <p className="mb-2 font-display text-xs font-semibold uppercase tracking-widest text-espn">
              {formatAnnouncementDate(a.date)}
            </p>
            <h2 className="mb-4 font-display text-2xl font-semibold leading-tight text-gray-900 sm:text-3xl">
              {a.title}
            </h2>
            {a.text
              .trim()
              .split(/\n\s*\n/)
              .map((para, i) => (
                <p
                  key={i}
                  className="mb-3 whitespace-pre-wrap text-base leading-relaxed text-gray-800 sm:text-lg"
                >
                  {para.trim()}
                </p>
              ))}
            <Comments threadKey={`announcement:${a.date}`} />
          </article>
        ))}
      </div>
    </div>
  );
}
