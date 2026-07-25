"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Login failed.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-20">
      <div className="rounded-xl border border-ink-700 bg-ink-800 p-8">
        <h1 className="mb-1 font-display text-2xl uppercase tracking-wide text-white">
          Commissioner Access
        </h1>
        <p className="mb-6 text-sm text-slate-400">
          Enter the admin password to manage articles.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full rounded-lg border border-ink-600 bg-ink-900 px-4 py-2.5 text-white placeholder-slate-500 outline-none focus:border-turf-500"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full rounded-lg bg-turf-500 py-2.5 font-display uppercase tracking-widest text-ink-950 transition-colors hover:bg-turf-400 disabled:opacity-50"
          >
            {loading ? "Checking..." : "Enter"}
          </button>
        </form>
      </div>
    </div>
  );
}
