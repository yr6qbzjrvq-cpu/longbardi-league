"use client";

import { useEffect, useState } from "react";

// Both targets are pinned to a fixed UTC offset so the clocks count to the
// same instant regardless of the viewer's timezone.
// Sept 6 2026 and May 21 2027 both fall in daylight time, so Pacific is UTC-7.
const DRAFT_TIME = new Date("2026-09-06T14:00:00-07:00").getTime();
const BIRTHDAY_TIME = new Date("2027-05-21T00:00:00-07:00").getTime();

const GIFT_LIST_URL =
  "https://www.amazon.com/registries/gl/owner-view/28CJFEWGKNI?ref_=list_d_gl_lfu_nav_3";

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

function Tile({ value, label }) {
  const display = value === null ? "--" : String(value).padStart(2, "0");
  return (
    <div className="min-w-[40px] rounded bg-espn px-1.5 py-1 text-center sm:min-w-[46px]">
      <div className="font-display text-base font-semibold tabular-nums leading-tight text-white sm:text-lg">
        {display}
      </div>
      <div className="text-[8px] uppercase tracking-widest text-white/70">
        {label}
      </div>
    </div>
  );
}

function Tiles({ t, pending }) {
  return (
    <div className="flex shrink-0 gap-1.5">
      <Tile value={pending ? null : t.days} label="Days" />
      <Tile value={pending ? null : t.hours} label="Hrs" />
      <Tile value={pending ? null : t.minutes} label="Min" />
      <Tile value={pending ? null : t.seconds} label="Sec" />
    </div>
  );
}

function Football() {
  return (
    <svg
      viewBox="0 0 100 64"
      aria-hidden="true"
      className="h-11 w-[68px] shrink-0 -rotate-[18deg] drop-shadow sm:h-12 sm:w-[76px]"
    >
      {/* Ball */}
      <path
        d="M4 32 C20 8 80 8 96 32 C80 56 20 56 4 32 Z"
        fill="#8a4b1f"
        stroke="#f2e9df"
        strokeWidth="2.5"
      />
      {/* End stripes */}
      <path
        d="M19 24 L19 40 M81 24 L81 40"
        stroke="#f2e9df"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Laces */}
      <path
        d="M38 32 L62 32"
        stroke="#f2e9df"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M43 27 L43 37 M50 27 L50 37 M57 27 L57 37"
        stroke="#f2e9df"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DraftBar() {
  const remaining = useCountdown(DRAFT_TIME);
  const onTheClock = remaining !== null && remaining <= 0;
  const t = breakdown(remaining ?? 0);

  return (
    <section className="relative overflow-hidden rounded-md bg-nav">
      {/* Yard lines */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 26px)",
        }}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <Football />
          <div>
            <p className="font-display text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              {onTheClock ? "Longbardi League" : "Draft Day"}
            </p>
            <p className="font-display text-sm font-semibold uppercase tracking-wide text-white">
              {onTheClock ? "We are on the clock" : "Sun, Sept 6 · 2:00 PM PT"}
            </p>
          </div>
        </div>
        {!onTheClock && <Tiles t={t} pending={remaining === null} />}
      </div>
    </section>
  );
}

// [left%, top%, width px, height px, rotation deg, tailwind bg]
const CONFETTI = [
  [4, 20, 5, 8, -20, "bg-amber-400"],
  [11, 66, 5, 7, 35, "bg-rose-500"],
  [19, 14, 4, 7, 12, "bg-emerald-400"],
  [27, 76, 5, 5, -45, "bg-violet-500"],
  [35, 32, 4, 8, 25, "bg-espn"],
  [43, 70, 5, 5, -15, "bg-amber-400"],
  [51, 16, 5, 7, 40, "bg-rose-500"],
  [59, 80, 4, 7, -30, "bg-emerald-400"],
  [67, 28, 5, 8, 18, "bg-violet-500"],
  [75, 64, 5, 5, -40, "bg-amber-400"],
  [83, 18, 4, 7, 22, "bg-espn"],
  [91, 72, 5, 6, -25, "bg-rose-500"],
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

// The whole card links out to the gift list, with no visual hint that it does.
// No hover state, no tooltip, and cursor-default so it reads as static.
function BirthdayBar() {
  const remaining = useCountdown(BIRTHDAY_TIME);
  const isToday = remaining !== null && remaining <= 0;
  const t = breakdown(remaining ?? 0);

  return (
    <a
      href={GIFT_LIST_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="relative block cursor-default overflow-hidden rounded-md border border-gray-200 bg-gradient-to-r from-amber-50 via-white to-rose-50"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, #1d4ed8 0 10px, #f59e0b 10px 20px, #f43f5e 20px 30px, #10b981 30px 40px)",
        }}
      />
      <Confetti />

      <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/commissioner.svg"
              alt="The Commissioner"
              className="h-16 w-16 rounded-full border-2 border-espn object-cover sm:h-[72px] sm:w-[72px]"
              style={{ objectPosition: "center 18%" }}
            />
            {/* Party hat */}
            <span
              aria-hidden="true"
              className="absolute -left-1 -top-2 rotate-[-22deg]"
            >
              <span className="block h-0 w-0 border-x-[8px] border-b-[16px] border-x-transparent border-b-rose-500" />
              <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-amber-400" />
            </span>
          </div>

          <div>
            <p className="font-display text-[10px] font-semibold uppercase tracking-widest text-espn">
              {isToday ? "Today" : "Austin's Birthday"}
            </p>
            <p className="font-display text-sm font-semibold uppercase tracking-wide text-gray-900">
              {isToday ? "Happy birthday, Commissioner" : "Fri, May 21, 2027"}
            </p>
          </div>
        </div>
        {!isToday && <Tiles t={t} pending={remaining === null} />}
      </div>
    </a>
  );
}

export default function Countdowns() {
  return (
    <div className="mb-6 grid gap-3 lg:grid-cols-2">
      <DraftBar />
      <BirthdayBar />
    </div>
  );
}
