"use client";

import { useCallback, useEffect, useState } from "react";
import { TEAMS } from "@/lib/leagueData";

const MANAGERS = TEAMS.map((t) => t.manager).sort();

function kickoffLabel(iso) {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function TeamButton({ team, selected, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
        selected
          ? "border-espn bg-espn text-white"
          : "border-gray-200 bg-white text-gray-800 hover:border-espn disabled:hover:border-gray-200"
      } disabled:opacity-60`}
    >
      {team.logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.logo} alt="" className="h-6 w-6 shrink-0" />
      )}
      <span className="font-display text-sm uppercase tracking-wide">
        {team.abbr}
      </span>
    </button>
  );
}

export default function PickemBoard({ initialWeek, totalWeeks }) {
  const [week, setWeek] = useState(initialWeek);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [myPicks, setMyPicks] = useState({});
  const [authError, setAuthError] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [saveError, setSaveError] = useState("");

  const load = useCallback(async (w) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pickem/week?week=${w}`);
      setData(await res.json());
    } catch {
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load(week);
  }, [week, load]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("hspn_pickem_name");
      if (saved) setName(saved);
    } catch {}
  }, []);

  async function signIn(e) {
    e?.preventDefault();
    setAuthError("");
    let res, json;
    try {
      res = await fetch(
        `/api/pickem/picks?week=${week}&name=${encodeURIComponent(name)}&pin=${encodeURIComponent(pin)}`
      );
      json = await res.json();
    } catch {
      setAuthError("Couldn't reach the server.");
      return;
    }
    if (!res.ok) {
      setAuthError(json?.error || "Couldn't sign in.");
      return;
    }
    setMyPicks(json.picks || {});
    setSignedIn(true);
    try {
      window.localStorage.setItem("hspn_pickem_name", name);
    } catch {}
  }

  // Re-pull this player's picks whenever the week changes while signed in.
  useEffect(() => {
    if (!signedIn) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/pickem/picks?week=${week}&name=${encodeURIComponent(name)}&pin=${encodeURIComponent(pin)}`
        );
        const json = await res.json();
        if (res.ok) setMyPicks(json.picks || {});
      } catch {}
    })();
  }, [week, signedIn, name, pin]);

  async function save() {
    setSaveState("saving");
    setSaveError("");
    let res, json;
    try {
      res = await fetch("/api/pickem/picks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week, name, pin, picks: myPicks }),
      });
      json = await res.json();
    } catch {
      setSaveState("idle");
      setSaveError("Couldn't save. Try again.");
      return;
    }
    if (!res.ok) {
      setSaveState("idle");
      setSaveError(json?.error || "Couldn't save.");
      return;
    }
    setSaveState("saved");
    load(week);
    setTimeout(() => setSaveState("idle"), 2500);
  }

  const locked = data?.locked;
  const games = data?.games || [];
  const picked = Object.keys(myPicks).length;

  return (
    <div>
      {/* Week switcher */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="font-display text-xs uppercase tracking-widest text-gray-500">
          Week
        </span>
        <select
          value={week}
          onChange={(e) => setWeek(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-espn"
        >
          {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>
              Week {w}
            </option>
          ))}
        </select>
        {data?.lockAt && (
          <span
            className={`rounded px-2 py-1 font-display text-[11px] uppercase tracking-widest ${
              locked ? "bg-gray-800 text-white" : "bg-amber-100 text-amber-800"
            }`}
          >
            {locked ? "Locked" : `Locks ${kickoffLabel(data.lockAt)}`}
          </span>
        )}
      </div>

      {loading && <p className="py-10 text-center text-gray-500">Loading...</p>}

      {!loading && games.length === 0 && (
        <p className="rounded-md border border-gray-200 px-5 py-10 text-center text-gray-500">
          No games scheduled for this week yet.
        </p>
      )}

      {!loading && games.length > 0 && (
        <>
          {/* Sign in */}
          {!signedIn ? (
            <form
              onSubmit={signIn}
              className="mb-6 rounded-md border border-gray-200 bg-gray-50 p-4 sm:p-5"
            >
              <h2 className="mb-1 font-display text-lg font-semibold uppercase tracking-wide text-gray-900">
                Make your picks
              </h2>
              <p className="mb-4 text-sm text-gray-500">
                Pick your name and a 4-digit PIN. First time sets your PIN, after
                that it keeps everyone else out of your sheet.
              </p>
              <div className="flex flex-wrap gap-3">
                <select
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-espn"
                >
                  <option value="">Your name</option>
                  {MANAGERS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  inputMode="numeric"
                  placeholder="PIN"
                  required
                  className="w-24 rounded-md border border-gray-300 px-3 py-2 text-sm tracking-widest outline-none focus:border-espn"
                />
                <button
                  type="submit"
                  disabled={!name || pin.length !== 4}
                  className="rounded-md bg-espn px-6 py-2 font-display text-sm uppercase tracking-widest text-white hover:bg-espn-dark disabled:opacity-50"
                >
                  Enter
                </button>
              </div>
              {authError && (
                <p className="mt-3 text-sm text-red-600">{authError}</p>
              )}
            </form>
          ) : (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-sm text-gray-700">
                Signed in as <strong>{name}</strong> &middot; {picked} of{" "}
                {games.length} picked
              </p>
              {!locked && (
                <div className="flex items-center gap-3">
                  {saveError && (
                    <span className="text-sm text-red-600">{saveError}</span>
                  )}
                  <button
                    type="button"
                    onClick={save}
                    disabled={saveState === "saving" || picked === 0}
                    className="rounded-md bg-espn px-5 py-2 font-display text-sm uppercase tracking-widest text-white hover:bg-espn-dark disabled:opacity-50"
                  >
                    {saveState === "saving"
                      ? "Saving..."
                      : saveState === "saved"
                        ? "Saved"
                        : "Save Picks"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Games */}
          <div className="space-y-2">
            {games.map((g) => {
              const mine = myPicks[g.id];
              const canPick = signedIn && !locked;
              return (
                <div
                  key={g.id}
                  className="rounded-md border border-gray-200 px-3 py-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                      {kickoffLabel(g.kickoff)}
                    </span>
                    {g.completed && (
                      <span className="font-display text-[11px] uppercase tracking-widest text-espn">
                        Final {g.away.abbr} {g.away.score} &ndash; {g.home.abbr}{" "}
                        {g.home.score}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {[g.away, g.home].map((team) => (
                      <TeamButton
                        key={team.abbr}
                        team={team}
                        selected={mine === team.abbr}
                        disabled={!canPick}
                        onClick={() =>
                          setMyPicks((p) => ({ ...p, [g.id]: team.abbr }))
                        }
                      />
                    ))}
                  </div>
                  {g.completed && g.winner && mine && (
                    <p
                      className={`mt-2 text-xs ${
                        mine === g.winner ? "text-green-700" : "text-red-600"
                      }`}
                    >
                      You picked {mine} &middot;{" "}
                      {mine === g.winner ? "Correct" : `Winner ${g.winner}`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Everyone's picks */}
          <h2 className="mb-3 mt-10 border-b-2 border-espn pb-2 font-display text-xl font-semibold uppercase tracking-wide text-gray-900">
            The League
          </h2>

          {!locked ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-5">
              <p className="mb-3 text-sm text-gray-600">
                Picks stay hidden until the first game kicks off. For now you can
                only see who has submitted.
              </p>
              {data.entries.length === 0 ? (
                <p className="text-sm text-gray-500">Nobody has picked yet.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {data.entries.map((e) => (
                    <li
                      key={e.name}
                      className="rounded bg-white px-3 py-1.5 text-sm text-gray-800 shadow-sm"
                    >
                      {e.name}{" "}
                      <span className="text-xs text-gray-500">
                        ({e.submitted})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : data.entries.length === 0 ? (
            <p className="rounded-md border border-gray-200 px-4 py-8 text-center text-gray-500">
              Nobody picked this week.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="border-b border-gray-200 px-3 py-2 font-display text-xs uppercase tracking-widest text-gray-600">
                      Player
                    </th>
                    {games.map((g) => (
                      <th
                        key={g.id}
                        className="border-b border-gray-200 px-2 py-2 text-center font-display text-[10px] uppercase tracking-wider text-gray-500"
                      >
                        {g.away.abbr}
                        <span className="text-gray-300">@</span>
                        {g.home.abbr}
                      </th>
                    ))}
                    <th className="border-b border-gray-200 px-3 py-2 text-center font-display text-xs uppercase tracking-widest text-gray-600">
                      W
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.name}>
                      <td className="border-b border-gray-100 px-3 py-2 font-medium text-gray-900">
                        {e.name}
                      </td>
                      {games.map((g) => {
                        const p = e.picks?.[g.id];
                        const right = g.completed && g.winner && p === g.winner;
                        const wrong = g.completed && g.winner && p && !right;
                        return (
                          <td
                            key={g.id}
                            className={`border-b border-gray-100 px-2 py-2 text-center text-xs ${
                              right
                                ? "bg-green-50 font-semibold text-green-700"
                                : wrong
                                  ? "bg-red-50 text-red-600"
                                  : "text-gray-700"
                            }`}
                          >
                            {p || "—"}
                          </td>
                        );
                      })}
                      <td className="border-b border-gray-100 px-3 py-2 text-center font-display font-semibold text-gray-900">
                        {e.correct}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
