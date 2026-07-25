import Link from "next/link";

export default function HeroArticle({ article }) {
  if (!article) return null;
  const date = new Date(article.created_at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Link href={`/articles/${article.slug}`} className="group block">
      <div className="relative aspect-[16/9] overflow-hidden rounded-md bg-gray-100 sm:aspect-[21/10]">
        {article.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={article.image_url}
            alt={article.title}
            className="h-full w-full object-cover"
          />
        )}
        <span className="absolute left-3 top-3 bg-espn px-2 py-0.5 font-display text-xs font-semibold uppercase tracking-widest text-white">
          Featured
        </span>
      </div>
      <h1 className="mt-4 font-display text-3xl font-semibold leading-tight text-gray-900 group-hover:underline sm:text-4xl">
        {article.title}
      </h1>
      {article.excerpt && (
        <p className="mt-2 max-w-3xl text-base text-gray-600 sm:text-lg">
          {article.excerpt}
        </p>
      )}
      <p className="mt-2 text-sm text-gray-500">{date}</p>
    </Link>
  );
}
