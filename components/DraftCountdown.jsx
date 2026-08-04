"use client";

import { useEffect, useState } from "react";

// September 6, 2026 at 2:00 PM Pacific. Pacific is on daylight time (UTC-7)
// in September, so this is 21:00 UTC. Fixing the offset here means the clock
// counts to the same instant no matter what timezone the viewer is in.
const DRAFT_TIME = new Date("2026-09-06T14:00:00-07:00").getTime();

function breakdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

function Unit({ value, label }) {
  const display =
    value === null ? "--" : String(value).padStart(2, "0");
  return (
    <div className="min-w-[56px] rounded bg-espn px-2 py-2 text-center sm:min-w-[70px] sm:px-3">
      <div className="font-display text-2xl font-semibold tabular-nums leading-none text-white sm:text-3xl">
        {display}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-widest text-white/70">
        {label}
      </div>
    </div>
  );
}

export default function DraftCountdown() {
  // Starts null so the server and the first client render match, then the
  // effect fills it in. Avoids a hydration mismatch on the ticking numbers.
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    const tick = () => setRemaining(DRAFT_TIME - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const onTheClock = remaining !== null && remaining <= 0;
  const t = breakdown(remaining ?? 0);
  const pending = remaining === null;

  return (
    <section className="mb-8 rounded-md bg-nav">
      <div className="flex flex-col items-center gap-4 px-4 py-5 sm:flex-row sm:justify-between sm:px-6">
        <div className="text-center sm:text-left">
          <p className="font-display text-[11px] font-semibold uppercase tracking-widest text-gray-400">
            {onTheClock ? "Longbardi League" : "Countdown to Draft Day"}
          </p>
          <p className="mt-1 font-display text-lg font-semibold uppercase tracking-wide text-white sm:text-xl">
            {onTheClock
              ? "We are on the clock"
              : "Sunday, September 6 · 2:00 PM Pacific"}
          </p>
        </div>

        {!onTheClock && (
          <div className="flex gap-2 sm:gap-3">
            <Unit value={pending ? null : t.days} label="Days" />
            <Unit value={pending ? null : t.hours} label="Hrs" />
            <Unit value={pending ? null : t.minutes} label="Min" />
            <Unit value={pending ? null : t.seconds} label="Sec" />
          </div>
        )}
      </div>
    </section>
  );
}
