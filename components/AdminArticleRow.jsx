"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminArticleRow({ article }) {
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (!confirm(`Delete "${article.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    const res = await fetch(`/api/admin/articles/${article.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      router.refresh();
    } else {
      alert("Delete failed. Try again.");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ink-700 bg-ink-900 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-medium text-white">{article.title}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {new Date(article.created_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          {article.featured && (
            <span className="ml-2 rounded bg-turf-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-turf-400">
              Featured
            </span>
          )}
          {!article.published && (
            <span className="ml-2 rounded bg-blaze-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blaze-400">
              Draft
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Link
          href={`/articles/${article.slug}`}
          className="rounded border border-ink-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300 hover:border-slate-400"
        >
          View
        </Link>
        <Link
          href={`/admin/edit/${article.id}`}
          className="rounded border border-turf-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-turf-400 hover:bg-turf-500/10"
        >
          Edit
        </Link>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="rounded border border-red-900 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-red-400 hover:bg-red-500/10 disabled:opacity-50"
        >
          {deleting ? "..." : "Delete"}
        </button>
      </div>
    </div>
  );
}
