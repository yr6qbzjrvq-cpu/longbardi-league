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
      <div className="rounded-md border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 font-display text-2xl font-semibold uppercase tracking-wide text-gray-900">
          Commissioner Access
        </h1>
        <p className="mb-6 text-sm text-gray-500">
          Enter the admin password to manage articles.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full rounded-md border border-gray-300 px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-espn"
          />
          {error && <p className="text-sm text-espn">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full rounded-md bg-espn py-2.5 font-display uppercase tracking-widest text-white transition-colors hover:bg-espn-dark disabled:opacity-50"
          >
            {loading ? "Checking..." : "Enter"}
          </button>
        </form>
      </div>
    </div>
  );
}
