import Link from "next/link";

export default function ArticleCard({ article }) {
  const date = new Date(article.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Link
      href={`/articles/${article.slug}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-800 transition-colors hover:border-turf-500"
    >
      <div className="relative aspect-video overflow-hidden bg-ink-700">
        {article.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={article.image_url}
            alt={article.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-display text-4xl text-ink-600">
            🏈
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="mb-1.5 font-display text-xs uppercase tracking-widest text-turf-400">
          {date}
        </p>
        <h3 className="font-display text-lg uppercase leading-snug tracking-wide text-white group-hover:text-turf-400">
          {article.title}
        </h3>
        {article.excerpt && (
          <p className="mt-2 line-clamp-3 text-sm text-slate-400">
            {article.excerpt}
          </p>
        )}
      </div>
    </Link>
  );
}
