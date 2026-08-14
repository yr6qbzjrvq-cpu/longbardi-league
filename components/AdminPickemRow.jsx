"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AdminPickemRow({ player, picks }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reset() {
    if (
      !window.confirm(
        `Reset ${player.name}? This clears their PIN and their picks so they can start over.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/pickem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: player.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Couldn't reset.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reset.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 px-4 py-3">
      <div>
        <p className="font-medium text-gray-900">{player.name}</p>
        <p className="text-sm text-gray-500">
          {picks} pick{picks === 1 ? "" : "s"} saved
        </p>
      </div>
      <div className="flex items-center gap-3">
        {error && <span className="text-sm text-red-600">{error}</span>}
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="rounded-md border border-red-300 px-4 py-1.5 font-display text-xs uppercase tracking-widest text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
        >
          {busy ? "Resetting..." : "Reset PIN"}
        </button>
      </div>
    </div>
  );
}
