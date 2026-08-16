"use client";

import { useCallback, useEffect, useState } from "react";

const REFRESH_MS = 45000;

function Side({ side, opponent, align }) {
  const winning = side.points > opponent.points;
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <p className="font-display text-sm uppercase tracking-wide text-gray-900">
        {side.teamName}
      </p>
      <p className="text-xs text-gray-500">{side.manager}</p>
      <p
        className={`mt-1 font-display text-2xl ${
          winning ? "font-semibold text-gray-900" : "text-gray-500"
        }`}
      >
        {side.points.toFixed(1)}
      </p>
      <p className="text-xs text-gray-400">
        Proj {side.projected.toFixed(1)}
        {side.yetToPlay > 0 && ` · ${side.yetToPlay} yet to play`}
      </p>
    </div>
  );
}

export default function MatchupBoard({ initialWeek, totalWeeks }) {
  const [week, setWeek] = useState(initialWeek);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (w) => {
    try {
      const res = await fetch(`/api/fantasy/matchups?week=${w}`);
      if (res.ok) setData(await res.json());
    } catch {
      // leave the last good numbers on screen
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    setLoading(true);
    load(week);
  }, [week, load]);

  // Keep scores current for anyone leaving the page open during games.
  useEffect(() => {
    const id = setInterval(() => load(week), REFRESH_MS);
    return () => clearInterval(id);
  }, [week, load]);

  const matchups = data?.matchups || [];

  return (
    <div>
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
        {data?.updatedAt && (
          <span className="text-xs text-gray-400">
            Updated{" "}
            {new Date(data.updatedAt).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      {loading && !data ? (
        <p className="py-10 text-center text-gray-500">Loading...</p>
      ) : (
        <div className="space-y-3">
          {matchups.map((m, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-md border border-gray-200 px-4 py-4"
            >
              <Side side={m.away} opponent={m.home} />
              <span className="font-display text-xs uppercase tracking-widest text-gray-300">
                vs
              </span>
              <Side side={m.home} opponent={m.away} align="right" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
