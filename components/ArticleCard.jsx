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
      className="group flex flex-col overflow-hidden rounded-md border border-gray-200 bg-white transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-video overflow-hidden bg-gray-100">
        {article.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={article.image_url}
            alt={article.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-4xl text-gray-300">
            🏈
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-display text-lg font-semibold leading-snug text-gray-900 group-hover:underline">
          {article.title}
        </h3>
        {article.excerpt && (
          <p className="mt-2 line-clamp-3 text-sm text-gray-600">
            {article.excerpt}
          </p>
        )}
        <p className="mt-auto pt-3 text-xs text-gray-500">{date}</p>
      </div>
    </Link>
  );
}
