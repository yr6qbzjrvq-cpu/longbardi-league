"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function AnnouncementForm({ announcement }) {
  const router = useRouter();
  const editing = Boolean(announcement);

  const [title, setTitle] = useState(announcement?.title || "");
  const [body, setBody] = useState(announcement?.body || "");
  const [date, setDate] = useState(
    announcement?.published_on
      ? String(announcement.published_on).slice(0, 10)
      : today()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);

    const url = editing
      ? `/api/admin/announcements/${announcement.id}`
      : "/api/admin/announcements";

    let res, json;
    try {
      res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, published_on: date }),
      });
      json = await res.json();
    } catch {
      setSaving(false);
      setError("Couldn't save. Try again.");
      return;
    }

    setSaving(false);
    if (!res.ok) {
      setError(json?.error || "Couldn't save. Try again.");
      return;
    }

    if (editing) {
      setSaved(true);
      router.refresh();
    } else {
      setTitle("");
      setBody("");
      setDate(today());
      router.refresh();
    }
  }

  const input =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-espn";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-gray-200 bg-gray-50 p-4 sm:p-5"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          maxLength={120}
          required
          className={input}
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          className={input}
        />
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={
          "Write the announcement exactly how you want it to appear.\n\nBlank line between paragraphs.\n\nPaste a YouTube link on its own line to embed the video."
        }
        rows={14}
        required
        className={`${input} mt-3 font-body leading-relaxed`}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving || !title.trim() || !body.trim()}
          className="rounded-md bg-espn px-6 py-2 font-display text-sm uppercase tracking-widest text-white transition-colors hover:bg-espn-dark disabled:opacity-50"
        >
          {saving
            ? "Saving..."
            : editing
              ? "Save Changes"
              : "Post Announcement"}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
        {saved && <span className="text-sm text-green-700">Saved.</span>}
      </div>
    </form>
  );
}
