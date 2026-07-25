"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const supabase = getClient();

export default function Comments({ threadKey }) {
  const [comments, setComments] = useState([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("hspn_chat_name");
      if (saved) setName(saved);
    } catch {}
  }, []);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from("comments")
      .select("*")
      .eq("thread_key", threadKey)
      .order("created_at", { ascending: true })
      .limit(200);
    if (data) setComments(data);
  }, [threadKey]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError("");
    const { error: err } = await supabase.from("comments").insert({
      thread_key: threadKey,
      name: name.trim().slice(0, 40),
      body: body.trim().slice(0, 2000),
    });
    if (err) {
      setError("Could not post that. Try again.");
      setSaving(false);
      return;
    }
    try {
      window.localStorage.setItem("hspn_chat_name", name.trim());
    } catch {}
    setBody("");
    setSaving(false);
    load();
  }

  if (!supabase) return null;

  const input =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-espn";

  return (
    <section className="mt-12">
      <h2 className="mb-4 border-b-2 border-espn pb-2 font-display text-xl font-semibold uppercase tracking-wide text-gray-900">
        Comments {comments.length > 0 && `(${comments.length})`}
      </h2>

      <div className="mb-6 divide-y divide-gray-200">
        {comments.length === 0 && (
          <p className="py-6 text-sm text-gray-500">
            No comments yet. Be the first.
          </p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="py-3">
            <p className="text-sm">
              <span className="font-semibold text-espn">{c.name}</span>
              <span className="ml-2 text-xs text-gray-400">
                {new Date(c.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}{" "}
                {new Date(c.created_at).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800">
              {c.body}
            </p>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={40}
          required
          className={`${input} sm:max-w-xs`}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment..."
          rows={3}
          maxLength={2000}
          required
          className={input}
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || !name.trim() || !body.trim()}
            className="rounded-md bg-espn px-5 py-2 font-display text-sm uppercase tracking-widest text-white hover:bg-espn-dark disabled:opacity-50"
          >
            {saving ? "Posting..." : "Post Comment"}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>
    </section>
  );
}
