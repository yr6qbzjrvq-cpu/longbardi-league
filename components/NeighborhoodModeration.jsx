"use client";

// ============================================================
// HSPNeighborhood — moderation dashboard (milestone 7)
// ------------------------------------------------------------
// The commissioner's live view of the world, on /admin/
// neighborhood. Polls GET /api/neighborhood/admin every few
// seconds and posts actions back to it:
//   • roster of everyone active (room, joined, last seen)
//     with Mute/Unmute and a 10-minute Kick
//   • timed bans in progress, with an early Lift
//   • the recent message trail across all rooms, each line
//     removable (deletion broadcasts so open logs update live)
// The API enforces everything server-side; this screen is just
// the steering wheel.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { ROOMS } from "@/lib/neighborhood/rooms";

const POLL_MS = 5000;
// Mirrors KICK_DEFAULT_MINUTES in lib/neighborhood/
// multiplayerServer (a server module this client bundle
// shouldn't pull in just for one number).
const KICK_DEFAULT_MINUTES = 10;

function roomName(id) {
  return (ROOMS[id] && ROOMS[id].name) || id || "—";
}

function ago(iso) {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return "—";
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function banLeft(iso) {
  const until = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(until)) return "—";
  const mins = Math.ceil((until - Date.now()) / 60_000);
  if (mins <= 0) return "lapsing…";
  return `${mins} min left`;
}

const actionBtn =
  "min-h-[36px] rounded-md border px-3 font-display text-[11px] uppercase tracking-widest transition-colors disabled:opacity-50";

export default function NeighborhoodModeration() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // "<action>:<id>" while a POST runs
  const timerRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/neighborhood/admin", { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const body = await res.json();
      setData(body);
      setError(null);
    } catch (err) {
      setError(err.message || "Couldn't load the neighborhood.");
    }
  }, []);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [refresh]);

  async function act(action, payload, key) {
    setBusy(key);
    try {
      const res = await fetch("/api/neighborhood/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((body && body.error) || `Request failed (${res.status})`);
      }
      await refresh();
    } catch (err) {
      setError(err.message || "That action failed.");
    } finally {
      setBusy(null);
    }
  }

  const players = (data && data.players) || [];
  const banned = (data && data.banned) || [];
  const messages = (data && data.messages) || [];

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {/* ---- live roster ---- */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100">
            In the neighborhood now
          </h2>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {data ? `${players.length} active · refreshes every ${POLL_MS / 1000}s` : "loading…"}
          </span>
        </div>
        {players.length === 0 ? (
          <p className="rounded-md border border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            Nobody&apos;s walking around right now.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-700">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2">Player</th>
                  <th className="px-3 py-2">Room</th>
                  <th className="px-3 py-2">Joined</th>
                  <th className="px-3 py-2">Last seen</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {players.map((p) => (
                  <tr key={p.id} className="text-gray-800 dark:text-gray-200">
                    <td className="px-3 py-2 font-semibold">
                      {p.username}
                      {p.muted && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                          muted
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{roomName(p.room)}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                      {ago(p.created_at)}
                    </td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                      {ago(p.last_seen)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={busy === `mute:${p.id}`}
                          onClick={() =>
                            act("mute", { playerId: p.id, muted: !p.muted }, `mute:${p.id}`)
                          }
                          className={`${actionBtn} border-amber-500 text-amber-700 hover:bg-amber-500 hover:text-white dark:text-amber-300`}
                        >
                          {p.muted ? "Unmute" : "Mute"}
                        </button>
                        <button
                          type="button"
                          disabled={busy === `kick:${p.id}`}
                          onClick={() => act("kick", { playerId: p.id }, `kick:${p.id}`)}
                          className={`${actionBtn} border-red-600 text-red-700 hover:bg-red-600 hover:text-white dark:text-red-300`}
                        >
                          Kick {KICK_DEFAULT_MINUTES}m
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- timed bans ---- */}
      <section>
        <h2 className="mb-3 font-display text-xl font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100">
          Timed bans
        </h2>
        {banned.length === 0 ? (
          <p className="rounded-md border border-gray-200 px-4 py-4 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            No bans running.
          </p>
        ) : (
          <ul className="space-y-2">
            {banned.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
              >
                <span className="font-semibold text-gray-800 dark:text-gray-200">
                  {p.username}
                  <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                    {banLeft(p.kicked_until)}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy === `unkick:${p.id}`}
                  onClick={() => act("unkick", { playerId: p.id }, `unkick:${p.id}`)}
                  className={`${actionBtn} border-espn text-espn hover:bg-espn hover:text-white`}
                >
                  Lift ban
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- recent messages ---- */}
      <section>
        <h2 className="mb-3 font-display text-xl font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100">
          Recent messages
        </h2>
        {messages.length === 0 ? (
          <p className="rounded-md border border-gray-200 px-4 py-4 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            The trail is empty.
          </p>
        ) : (
          <ul className="space-y-2">
            {messages.map((m) => (
              <li
                key={m.id}
                className="flex items-start justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {m.username}
                  </span>{" "}
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">
                    {roomName(m.room)} · {ago(m.created_at)}
                  </span>
                  <p className="break-words text-gray-700 dark:text-gray-200">{m.text}</p>
                </div>
                <button
                  type="button"
                  disabled={busy === `del:${m.id}`}
                  onClick={() => act("delete_message", { id: m.id }, `del:${m.id}`)}
                  className={`${actionBtn} shrink-0 border-red-600 text-red-700 hover:bg-red-600 hover:text-white dark:text-red-300`}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
