import Link from "next/link";
import OpinionForm from "@/components/OpinionForm";
import { getOpinions } from "@/lib/opinions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Opinions" };

export default async function OpinionsPage() {
  const opinions = await getOpinions();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="mb-2 border-b-2 border-espn pb-3 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
        Opinions
      </h1>
      <p className="mb-6 text-sm text-gray-500">
        Anyone can post. Say what you want, put your name on it.
      </p>

      <OpinionForm />

      <div className="mt-8 divide-y divide-gray-200 border-t border-gray-200">
        {opinions.length === 0 && (
          <p className="py-10 text-center text-gray-500">
            Nobody has an opinion yet. Suspicious.
          </p>
        )}

        {opinions.map((o) => (
          <article key={o.id} className="py-4">
            <h2 className="font-display text-xl font-semibold leading-snug text-gray-900">
              <Link href={`/opinions/${o.id}`} className="hover:underline">
                {o.title}
              </Link>
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              By {o.author} &middot;{" "}
              {new Date(o.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
