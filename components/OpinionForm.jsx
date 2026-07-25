"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const supabase = getClient();

export default function OpinionForm() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError("");
    const { error: err } = await supabase.from("opinions").insert({
      title: title.trim().slice(0, 120),
      author: author.trim().slice(0, 40),
      body: body.trim().slice(0, 5000),
    });
    if (err) {
      setError("Could not post that. Try again.");
      setSaving(false);
      return;
    }
    setTitle("");
    setAuthor("");
    setBody("");
    setOpen(false);
    setSaving(false);
    router.refresh();
  }

  if (!supabase) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Submissions are unavailable — the database connection isn&apos;t
        configured.
      </p>
    );
  }

  const input =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 outline-none focus:border-espn";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-espn px-6 py-2.5 font-display text-sm uppercase tracking-widest text-white hover:bg-espn-dark"
      >
        + Write an Opinion
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-4"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        maxLength={120}
        required
        className={input}
      />
      <input
        value={author}
        onChange={(e) => setAuthor(e.target.value)}
        placeholder="Your name"
        maxLength={40}
        required
        className={input}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Say your piece..."
        rows={8}
        maxLength={5000}
        required
        className={input}
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || !title.trim() || !author.trim() || !body.trim()}
          className="rounded-md bg-espn px-6 py-2 font-display text-sm uppercase tracking-widest text-white hover:bg-espn-dark disabled:opacity-50"
        >
          {saving ? "Posting..." : "Publish"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-gray-500 hover:underline"
        >
          Cancel
        </button>
        <span className="ml-auto text-xs text-gray-400">
          {body.length}/5000
        </span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
