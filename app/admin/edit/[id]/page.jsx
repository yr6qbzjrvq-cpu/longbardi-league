import { redirect, notFound } from "next/navigation";
import ArticleEditor from "@/components/ArticleEditor";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const metadata = { title: "Edit Article" };

export default async function EditArticlePage({ params }) {
  if (!(await isAuthed())) redirect("/admin");

  const { id } = await params;
  const supabase = getAdminClient();
  if (!supabase) redirect("/admin");

  const { data: article } = await supabase
    .from("articles")
    .select("*")
    .eq("id", id)
    .single();

  if (!article) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
        Edit Article
      </h1>
      <ArticleEditor article={article} />
    </div>
  );
}
