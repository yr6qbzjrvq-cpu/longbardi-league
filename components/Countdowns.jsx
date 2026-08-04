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

// [left%, top%, width px, height px, rotation deg, tailwind bg]
const CONFETTI = [
  [3, 18, 8, 12, -20, "bg-amber-400"],
  [9, 62, 7, 11, 35, "bg-rose-500"],
  [15, 12, 6, 10, 12, "bg-emerald-400"],
  [21, 78, 8, 8, -45, "bg-violet-500"],
  [28, 30, 6, 12, 25, "bg-espn"],
  [34, 70, 7, 7, -15, "bg-amber-400"],
  [41, 14, 8, 11, 40, "bg-rose-500"],
  [48, 84, 6, 10, -30, "bg-emerald-400"],
  [55, 26, 7, 12, 18, "bg-violet-500"],
  [62, 66, 8, 8, -40, "bg-amber-400"],
  [69, 10, 6, 11, 22, "bg-espn"],
  [76, 74, 7, 10, -25, "bg-rose-500"],
  [83, 22, 8, 12, 45, "bg-emerald-400"],
  [89, 58, 6, 9, -10, "bg-violet-500"],
  [94, 34, 7, 11, 30, "bg-amber-400"],
  [97, 80, 6, 8, -35, "bg-rose-500"],
];

function Confetti() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {CONFETTI.map(([l, top, w, h, rot, color], i) => (
        <span
          key={i}
          className={`absolute rounded-[1px] opacity-70 ${color}`}
          style={{
            left: `${l}%`,
            top: `${top}%`,
            width: `${w}px`,
            height: `${h}px`,
            transform: `rotate(${rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}

function BirthdayBar() {
  const remaining = useCountdown(BIRTHDAY_TIME);
  const isToday = remaining !== null && remaining <= 0;
  const t = breakdown(remaining ?? 0);

  return (
    <section className="relative overflow-hidden rounded-md border border-gray-200 bg-gradient-to-r from-amber-50 via-white to-rose-50">
      {/* Streamer along the top edge */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1.5"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, #1d4ed8 0 14px, #f59e0b 14px 28px, #f43f5e 28px 42px, #10b981 42px 56px)",
        }}
      />
      <Confetti />

      <div className="relative flex flex-col items-center gap-4 px-4 py-6 sm:flex-row sm:justify-between sm:px-6">
        <div className="flex items-center gap-5">
          <div className="relative shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/commissioner.svg"
              alt="The Commissioner"
              className="h-28 w-28 rounded-full border-4 border-espn object-cover shadow-sm sm:h-36 sm:w-36"
              style={{ objectPosition: "center 18%" }}
            />
            {/* Party hat */}
            <span
              aria-hidden="true"
              className="absolute -left-1 -top-3 rotate-[-22deg] sm:-left-2 sm:-top-4"
            >
              <span className="block h-0 w-0 border-x-[13px] border-b-[26px] border-x-transparent border-b-rose-500 sm:border-x-[16px] sm:border-b-[32px]" />
              <span className="absolute -top-2 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-amber-400 sm:h-3.5 sm:w-3.5" />
            </span>
          </div>

          <div className="text-center sm:text-left">
            <p className="font-display text-[11px] font-semibold uppercase tracking-widest text-espn">
              {isToday ? "Today" : "Countdown to Austin's Birthday"}
            </p>
            <p className="mt-1 font-display text-lg font-semibold uppercase tracking-wide text-gray-900 sm:text-2xl">
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
