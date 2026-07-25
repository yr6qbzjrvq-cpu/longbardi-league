import Link from "next/link";

export default function HeroArticle({ article }) {
  if (!article) return null;
  const date = new Date(article.created_at).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <Link
      href={`/articles/${article.slug}`}
      className="group relative block overflow-hidden rounded-xl border border-ink-700"
    >
      <div className="relative aspect-[16/9] bg-ink-800 sm:aspect-[21/9]">
        {article.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={article.image_url}
            alt={article.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/50 to-transparent" />
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-8">
        <span className="mb-3 inline-block rounded bg-turf-500 px-2.5 py-1 font-display text-xs font-semibold uppercase tracking-widest text-ink-950">
          Featured
        </span>
        <h1 className="max-w-3xl font-display text-2xl uppercase leading-tight tracking-wide text-white sm:text-4xl lg:text-5xl">
          {article.title}
        </h1>
        {article.excerpt && (
          <p className="mt-3 hidden max-w-2xl text-slate-300 sm:block">
            {article.excerpt}
          </p>
        )}
        <p className="mt-3 font-display text-xs uppercase tracking-widest text-slate-400">
          {date}
        </p>
      </div>
    </Link>
  );
}
