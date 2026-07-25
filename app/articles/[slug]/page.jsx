import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getArticleBySlug } from "@/lib/articles";

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
      <p className="mb-3 font-display text-xs uppercase tracking-widest text-turf-400">
        {date}
      </p>
      <h1 className="font-display text-3xl uppercase leading-tight tracking-wide text-white sm:text-5xl">
        {article.title}
      </h1>
      {article.excerpt && (
        <p className="mt-4 text-lg text-slate-400">{article.excerpt}</p>
      )}
      {article.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={article.image_url}
          alt={article.title}
          className="mt-6 aspect-video w-full rounded-xl object-cover"
        />
      )}
      <div className="article-body mt-8">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {article.content}
        </ReactMarkdown>
      </div>
    </article>
  );
}
