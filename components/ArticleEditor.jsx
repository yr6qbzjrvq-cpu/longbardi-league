"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function ArticleEditor({ article = null }) {
  const isEdit = Boolean(article);
  const router = useRouter();

  const [title, setTitle] = useState(article?.title || "");
  const [imageUrl, setImageUrl] = useState(article?.image_url || "");
  const [excerpt, setExcerpt] = useState(article?.excerpt || "");
  const [content, setContent] = useState(article?.content || "");
  const [featured, setFeatured] = useState(article?.featured || false);
  const [published, setPublished] = useState(article?.published ?? true);
  const [tab, setTab] = useState("write");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const payload = {
      title,
      image_url: imageUrl,
      excerpt,
      content,
      featured,
      published,
    };
    const res = await fetch(
      isEdit ? `/api/admin/articles/${article.id}` : "/api/admin/articles",
      {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      router.push("/admin");
      router.refresh();
    } else {
      setError(data.error || "Save failed.");
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-gray-300 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-espn";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="mb-1.5 block font-display text-xs font-semibold uppercase tracking-widest text-gray-500">
          Title *
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Week 10 Matchup Preview..."
          required
          className={inputClass}
        />
      </div>

      <div>
        <label className="mb-1.5 block font-display text-xs font-semibold uppercase tracking-widest text-gray-500">
          Thumbnail Image URL
        </label>
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://images.unsplash.com/..."
          className={inputClass}
        />
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="Thumbnail preview"
            className="mt-3 aspect-video w-full max-w-sm rounded-md object-cover"
          />
        )}
      </div>

      <div>
        <label className="mb-1.5 block font-display text-xs font-semibold uppercase tracking-widest text-gray-500">
          Excerpt <span className="normal-case text-gray-400">(shown on cards and the hero)</span>
        </label>
        <textarea
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          rows={2}
          placeholder="One or two sentences..."
          className={inputClass}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="font-display text-xs font-semibold uppercase tracking-widest text-gray-500">
            Body (Markdown)
          </label>
          <div className="flex overflow-hidden rounded-md border border-gray-300 text-xs font-semibold uppercase tracking-wider">
            <button
              type="button"
              onClick={() => setTab("write")}
              className={`px-4 py-1.5 ${
                tab === "write"
                  ? "bg-espn text-white"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Write
            </button>
            <button
              type="button"
              onClick={() => setTab("preview")}
              className={`px-4 py-1.5 ${
                tab === "preview"
                  ? "bg-espn text-white"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Preview
            </button>
          </div>
        </div>

        {tab === "write" ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={18}
            placeholder={"# Big Headline\n\nWrite your article in **Markdown**...\n\n## Section\n\n- Bullet one\n- Bullet two"}
            className={`${inputClass} font-mono text-sm leading-relaxed`}
          />
        ) : (
          <div className="article-body min-h-[24rem] rounded-md border border-gray-300 bg-white px-5 py-4">
            {content ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            ) : (
              <p className="text-gray-400">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={featured}
            onChange={(e) => setFeatured(e.target.checked)}
            className="h-4 w-4 accent-blue-700"
          />
          Feature on homepage hero
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="h-4 w-4 accent-blue-700"
          />
          Published (uncheck to save as draft)
        </label>
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="rounded-md bg-espn px-8 py-2.5 font-display uppercase tracking-widest text-white transition-colors hover:bg-espn-dark disabled:opacity-50"
        >
          {saving ? "Saving..." : isEdit ? "Save Changes" : "Publish"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin")}
          className="rounded-md border border-gray-300 px-6 py-2.5 font-display uppercase tracking-widest text-gray-500 hover:text-gray-900"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
