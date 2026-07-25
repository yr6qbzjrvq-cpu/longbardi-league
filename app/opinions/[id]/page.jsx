import Link from "next/link";
import { notFound } from "next/navigation";
import { getOpinionById } from "@/lib/opinions";
import { isAuthed } from "@/lib/auth";
import DeleteOpinionButton from "@/components/DeleteOpinionButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const o = await getOpinionById(id);
  if (!o) return { title: "Opinion Not Found" };
  return { title: o.title };
}

export default async function OpinionPage({ params }) {
  const { id } = await params;
  const o = await getOpinionById(id);
  if (!o) notFound();

  const admin = await isAuthed();
  const date = new Date(o.created_at).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <article className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <p className="mb-3 font-display text-xs font-semibold uppercase tracking-widest text-espn">
        Opinion
      </p>
      <h1 className="font-display text-3xl font-semibold leading-tight text-gray-900 sm:text-4xl">
        {o.title}
      </h1>
      <p className="mt-3 text-sm text-gray-500">
        By {o.author} &middot; {date}
      </p>

      <div className="mt-8">
        {o.body
          .trim()
          .split(/\n\s*\n/)
          .map((para, i) => (
            <p
              key={i}
              className="mb-4 whitespace-pre-wrap text-base leading-relaxed text-gray-800 sm:text-lg"
            >
              {para.trim()}
            </p>
          ))}
      </div>

      <hr className="my-8 border-gray-200" />
      <div className="flex items-center justify-between">
        <Link
          href="/opinions"
          className="font-display text-sm uppercase tracking-widest text-link hover:underline"
        >
          &laquo; All Opinions
        </Link>
        {admin && <DeleteOpinionButton id={o.id} />}
      </div>

      <p className="mt-8 text-xs text-gray-400">
        Opinions are submitted by readers and do not represent HSPN or the
        Longbardi League.
      </p>
    </article>
  );
}
