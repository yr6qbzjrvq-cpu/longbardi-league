import { notFound } from "next/navigation";
import ArticleBody from "@/components/ArticleBody";
import { getArticleBySlug } from "@/lib/articles";
import Comments from "@/components/Comments";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) return { title: "Article Not Found" };
  return { title: article.title, description: article.excerpt || undefined };
}

export default async function ArticlePage({ params }) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) notFound();

  const date = new Date(article.created_at).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <article className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl font-semibold leading-tight text-gray-900 sm:text-5xl">
        {article.title}
      </h1>
      {article.excerpt && (
        <p className="mt-4 text-lg text-gray-600">{article.excerpt}</p>
      )}
      <p className="mt-3 text-sm text-gray-500">{date}</p>
      {article.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={article.image_url}
          alt={article.title}
          className="mt-6 aspect-video w-full rounded-md object-cover"
        />
      )}
      <div className="article-body mt-8">
        <ArticleBody content={article.content} />
      </div>
      <Comments threadKey={`article:${article.slug}`} />
    </article>
  );
}
