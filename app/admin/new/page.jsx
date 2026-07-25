import { redirect } from "next/navigation";
import ArticleEditor from "@/components/ArticleEditor";
import { isAuthed } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "New Article" };

export default async function NewArticlePage() {
  if (!(await isAuthed())) redirect("/admin");

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
        New Article
      </h1>
      <ArticleEditor />
    </div>
  );
}
