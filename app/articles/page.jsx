import ArticleCard from "@/components/ArticleCard";
import { getPublishedArticles } from "@/lib/articles";

export const dynamic = "force-dynamic";

export const metadata = { title: "News" };

export default async function ArticlesPage() {
  const articles = await getPublishedArticles();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 border-b-2 border-espn pb-3 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
        News
      </h1>
      {articles.length === 0 ? (
        <p className="text-gray-500">No articles yet. Check back soon.</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}
