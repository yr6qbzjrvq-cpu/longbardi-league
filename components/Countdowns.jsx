"use client";

import { useEffect, useState } from "react";

// Both targets are pinned to a fixed UTC offset so the clocks count to the
// same instant regardless of the viewer's timezone.
// Sept 6 2026 and May 21 2027 both fall in daylight time, so Pacific is UTC-7.
const DRAFT_TIME = new Date("2026-09-06T14:00:00-07:00").getTime();
const BIRTHDAY_TIME = new Date("2027-05-21T00:00:00-07:00").getTime();

function breakdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

// Starts null so server and first client render agree, then the effect fills
// it in. Avoids a hydration mismatch on the ticking numbers.
function useCountdown(target) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    const tick = () => setRemaining(target - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  return remaining;
}

function Tile({ value, label, dark }) {
  const display = value === null ? "--" : String(value).padStart(2, "0");
  return (
    <div
      className={`min-w-[52px] rounded px-2 py-2 text-center sm:min-w-[66px] sm:px-3 ${
        dark ? "bg-espn" : "bg-espn"
      }`}
    >
      <div className="font-display text-xl font-semibold tabular-nums leading-none text-white sm:text-3xl">
        {display}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-widest text-white/70">
        {label}
      </div>
    </div>
  );
}

function Tiles({ t, pending }) {
  return (
    <div className="flex gap-2 sm:gap-3">
      <Tile value={pending ? null : t.days} label="Days" />
      <Tile value={pending ? null : t.hours} label="Hrs" />
      <Tile value={pending ? null : t.minutes} label="Min" />
      <Tile value={pending ? null : t.seconds} label="Sec" />
    </div>
  );
}

function DraftBar() {
  const remaining = useCountdown(DRAFT_TIME);
  const onTheClock = remaining !== null && remaining <= 0;
  const t = breakdown(remaining ?? 0);

  return (
    <section className="rounded-md bg-nav">
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
          <Tiles t={t} pending={remaining === null} />
        )}
      </div>
    </section>
  );
}

function BirthdayBar() {
  const remaining = useCountdown(BIRTHDAY_TIME);
  const isToday = remaining !== null && remaining <= 0;
  const t = breakdown(remaining ?? 0);

  return (
    <section className="rounded-md border border-gray-200 bg-white">
      <div className="flex flex-col items-center gap-4 px-4 py-4 sm:flex-row sm:justify-between sm:px-6">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/commissioner.svg"
            alt="The Commissioner"
            className="h-14 w-14 shrink-0 rounded-full border-2 border-espn object-cover sm:h-16 sm:w-16"
            style={{ objectPosition: "center 20%" }}
          />
          <div className="text-center sm:text-left">
            <p className="font-display text-[11px] font-semibold uppercase tracking-widest text-espn">
              {isToday ? "Today" : "Countdown to Austin's Birthday"}
            </p>
            <p className="mt-1 font-display text-base font-semibold uppercase tracking-wide text-gray-900 sm:text-lg">
              {isToday
                ? "Happy birthday, Commissioner"
                : "Friday, May 21, 2027"}
            </p>
          </div>
        </div>
        {!isToday && <Tiles t={t} pending={remaining === null} />}
      </div>
    </section>
  );
}

export default function Countdowns() {
  return (
    <div className="mb-8 space-y-3">
      <DraftBar />
      <BirthdayBar />
    </div>
  );
}
