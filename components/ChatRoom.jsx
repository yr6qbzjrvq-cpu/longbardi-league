"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const supabase = getClient();

export default function ChatRoom() {
  const [name, setName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);
  const countRef = useRef(0);

  // Restore saved name
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("hspn_chat_name");
      if (saved) setName(saved);
    } catch {}
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data) setMessages(data.reverse());
  }, []);

  // Poll every 4 seconds
  useEffect(() => {
    fetchMessages();
    const id = setInterval(fetchMessages, 4000);
    return () => clearInterval(id);
  }, [fetchMessages]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length !== countRef.current) {
      countRef.current = messages.length;
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  function joinChat(e) {
    e.preventDefault();
    const trimmed = nameInput.trim().slice(0, 30);
    if (!trimmed) return;
    setName(trimmed);
    try {
      window.localStorage.setItem("hspn_chat_name", trimmed);
    } catch {}
  }

  async function sendMessage(e) {
    e.preventDefault();
    const content = text.trim().slice(0, 500);
    if (!content || !supabase) return;
    setSending(true);
    setError("");
    const { error: err } = await supabase
      .from("messages")
      .insert({ name, content });
    if (err) {
      setError("Message failed to send. Try again.");
    } else {
      setText("");
      await fetchMessages();
    }
    setSending(false);
  }

  if (!supabase) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Chat is unavailable — the database connection isn&apos;t configured.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-gray-200">
      <div className="flex items-baseline justify-between border-b border-gray-200 bg-gray-50 px-4 py-2.5">
        <h2 className="font-display text-base font-semibold uppercase tracking-wide text-gray-900">
          League Chat
        </h2>
        {name && (
          <button
            onClick={() => {
              setName("");
              setNameInput("");
              try {
                window.localStorage.removeItem("hspn_chat_name");
              } catch {}
            }}
            className="text-xs text-gray-500 hover:underline"
          >
            Chatting as <b>{name}</b> — change
          </button>
        )}
      </div>

      <div className="h-[55vh] overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-400">
            No messages yet. Start the trash talk.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="py-1.5">
            <span className="font-semibold text-espn">{m.name}</span>
            <span className="ml-2 text-xs text-gray-400">
              {new Date(m.created_at).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            <p className="whitespace-pre-wrap break-words text-sm text-gray-800">
              {m.content}
            </p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-gray-200 bg-gray-50 p-3">
        {!name ? (
          <form onSubmit={joinChat} className="flex gap-2">
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Your name"
              maxLength={30}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-espn"
            />
            <button
              type="submit"
              disabled={!nameInput.trim()}
              className="rounded-md bg-espn px-6 py-2 font-display text-sm uppercase tracking-widest text-white hover:bg-espn-dark disabled:opacity-50"
            >
              Join
            </button>
          </form>
        ) : (
          <form onSubmit={sendMessage} className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Say something..."
              maxLength={500}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-espn"
            />
            <button
              type="submit"
              disabled={sending || !text.trim()}
              className="rounded-md bg-espn px-6 py-2 font-display text-sm uppercase tracking-widest text-white hover:bg-espn-dark disabled:opacity-50"
            >
              Send
            </button>
          </form>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
