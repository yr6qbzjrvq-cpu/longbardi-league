"use client";

import { useState } from "react";

export default function SubscribeForm() {
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState("all");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("saving");
    setMessage("");

    let res, json;
    try {
      res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tier }),
      });
      json = await res.json();
    } catch {
      setStatus("error");
      setMessage("Couldn't reach the server. Try again.");
      return;
    }

    if (!res.ok) {
      setStatus("error");
      setMessage(json?.error || "Something went wrong. Try again.");
      return;
    }

    setStatus("done");
    setMessage(
      json.changed
        ? "Preferences updated."
        : json.updated
          ? "You're already on the list."
          : "You're on the list."
    );
    setEmail("");
  }

  if (status === "done") {
    return (
      <div className="text-sm">
        <p className="font-display uppercase tracking-widest text-white">
          {message}
        </p>
        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setMessage("");
          }}
          className="mt-1 text-xs text-gray-400 underline hover:text-white"
        >
          Add another address
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full sm:max-w-md">
      <p className="mb-2 font-display text-xs font-semibold uppercase tracking-widest text-white">
        Get HSPN updates by email
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          required
          maxLength={254}
          className="min-w-0 flex-1 rounded-md border border-gray-600 bg-white/95 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-espn"
        />
        <button
          type="submit"
          disabled={status === "saving"}
          className="shrink-0 rounded-md bg-espn px-5 py-2 font-display text-sm uppercase tracking-widest text-white transition-colors hover:bg-espn-dark disabled:opacity-50"
        >
          {status === "saving" ? "..." : "Subscribe"}
        </button>
      </div>

      <div className="mt-3 space-y-1.5">
        <label className="flex cursor-pointer items-start gap-2 text-xs text-gray-300">
          <input
            type="radio"
            name="tier"
            value="all"
            checked={tier === "all"}
            onChange={() => setTier("all")}
            className="mt-0.5"
          />
          <span>Announcements and news articles</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-xs text-gray-300">
          <input
            type="radio"
            name="tier"
            value="announcements"
            checked={tier === "announcements"}
            onChange={() => setTier("announcements")}
            className="mt-0.5"
          />
          <span>Commissioner announcements only</span>
        </label>
      </div>

      {status === "error" && (
        <p className="mt-2 text-xs text-red-400">{message}</p>
      )}
    </form>
  );
}
