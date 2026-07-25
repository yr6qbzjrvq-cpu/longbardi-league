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
    <div className="flex flex-col gap-3 rounded-md border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-medium text-gray-900">{article.title}</p>
        <p className="mt-0.5 text-xs text-gray-500">
          {new Date(article.created_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          {article.featured && (
            <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-espn">
              Featured
            </span>
          )}
          {!article.published && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
              Draft
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Link
          href={`/articles/${article.slug}`}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-600 hover:border-gray-500"
        >
          View
        </Link>
        <Link
          href={`/admin/edit/${article.id}`}
          className="rounded-md border border-link px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-link hover:bg-blue-50"
        >
          Edit
        </Link>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-espn hover:bg-red-50 disabled:opacity-50"
        >
          {deleting ? "..." : "Delete"}
        </button>
      </div>
    </div>
  );
}
