"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function Button({ children, onClick, busy, tone = "primary", disabled }) {
  const base =
    "rounded-md px-5 py-2 font-display text-sm uppercase tracking-widest transition-colors disabled:opacity-50";
  const tones = {
    primary: "bg-espn text-white hover:bg-espn-dark",
    outline: "border border-espn text-espn hover:bg-espn hover:text-white",
    danger: "border border-red-400 text-red-600 hover:bg-red-600 hover:text-white",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`${base} ${tones[tone]}`}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

// The buttons on /admin/yahoo. Every one of them posts to a route that
// re-checks the admin cookie server-side; nothing here is trusted.
export default function YahooConnectionPanel({
  connected,
  configured,
  override,
  leagues,
  leagueKey,
  week,
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState(null);
  const [picked, setPicked] = useState(leagueKey || "");

  const post = async (what, url, body) => {
    setBusy(what);
    setMessage(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: "bad", text: json.error || `Failed (${res.status}).` });
      } else if (what === "sync") {
        const failed = Object.entries(json.results || {})
          .filter(([, r]) => !r.ok)
          .map(([name, r]) => `${name}: ${r.error}`);
        setMessage(
          failed.length
            ? { tone: "bad", text: failed.join(" · ") }
            : {
                tone: "good",
                text: `Synced week ${json.week} — ${json.matchups} matchups.`,
              }
        );
      } else {
        setMessage({ tone: "good", text: "Done." });
      }
      router.refresh();
    } catch (err) {
      setMessage({ tone: "bad", text: err.message });
    }
    setBusy("");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        {!connected && (
          <a
            href="/api/yahoo/auth"
            className={`rounded-md px-5 py-2 font-display text-sm uppercase tracking-widest transition-colors ${
              configured
                ? "bg-espn text-white hover:bg-espn-dark"
                : "pointer-events-none bg-gray-200 text-gray-400"
            }`}
          >
            Connect Yahoo
          </a>
        )}

        {connected && (
          <>
            <Button
              busy={busy === "sync"}
              onClick={() => post("sync", "/api/yahoo/refresh", { week })}
              tone="outline"
            >
              Sync now
            </Button>
            <Button
              busy={busy === "override"}
              tone="outline"
              onClick={() =>
                post("override", "/api/yahoo/override", { force: !override })
              }
            >
              {override ? "Use Yahoo data" : "Force hand-built data"}
            </Button>
            <Button
              busy={busy === "disconnect"}
              tone="danger"
              onClick={() => {
                if (
                  window.confirm(
                    "Disconnect Yahoo? The site goes back to the hand-built numbers and you'll have to click through consent again."
                  )
                ) {
                  post("disconnect", "/api/yahoo/disconnect");
                }
              }}
            >
              Disconnect
            </Button>
          </>
        )}
      </div>

      {connected && leagues?.length > 0 && (
        <div className="rounded-md border border-gray-200 p-4">
          <p className="mb-2 font-display text-xs uppercase tracking-widest text-gray-500">
            Which league?
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-espn"
            >
              <option value="">Choose a league…</option>
              {leagues.map((l) => (
                <option key={l.leagueKey} value={l.leagueKey}>
                  {l.name} ({l.season}, {l.numTeams} teams)
                </option>
              ))}
            </select>
            <Button
              busy={busy === "league"}
              disabled={!picked || picked === leagueKey}
              tone="outline"
              onClick={() => post("league", "/api/yahoo/league", { leagueKey: picked })}
            >
              Use this league
            </Button>
          </div>
        </div>
      )}

      {message && (
        <p
          className={`rounded-md px-4 py-3 text-sm ${
            message.tone === "good"
              ? "border border-green-300 bg-green-50 text-green-800"
              : "border border-red-300 bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
