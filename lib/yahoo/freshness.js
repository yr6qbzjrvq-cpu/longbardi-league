// When is the cache too old, and who is allowed to go ask Yahoo?
//
// Vercel's Hobby plan caps cron at one run per day, so nothing here is
// scheduled. Freshness is request-driven: MatchupBoard already polls
// /api/fantasy/matchups every 45 seconds, and that poll is what pulls new
// numbers through. The rules:
//
//   * during NFL game windows the cache goes stale after 60s, so a poller
//     sees scores move about as fast as Yahoo updates them;
//   * the rest of the week it goes stale after 15 minutes, because nothing
//     changes and Yahoo's terms ask us not to hammer the API;
//   * only ONE request may refresh a given key at a time (the claim), so
//     twelve people with the page open do not become twelve Yahoo calls.
//
// All pure. scripts/test-yahoo.mjs drives it with fixed clocks.

export const FAST_STALE_MS = 60 * 1000;
export const SLOW_STALE_MS = 15 * 60 * 1000;

// How long a refresher holds the claim before another request may retry.
// Long enough to cover a slow Yahoo call, short enough that a lambda dying
// mid-flight only costs one cycle.
export const CLAIM_MS = 30 * 1000;

// Eastern time, because that is how the NFL schedule is written.
export function easternParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  return {
    weekday: parts.weekday,
    hour,
    minute: Number(parts.minute),
  };
}

// Is a live NFL window plausible right now? Deliberately generous — being
// wrong costs one extra Yahoo call a minute, and being wrong the other way
// costs stale scores during a game.
export function isGameWindow(date = new Date()) {
  const { weekday, hour } = easternParts(date);
  switch (weekday) {
    case "Sun":
      return hour >= 9; // London kickoffs through the night game
    case "Mon":
      return hour >= 18 || hour < 1;
    case "Tue":
      return hour < 1; // Monday night bleeding past midnight
    case "Thu":
      return hour >= 18;
    case "Fri":
      return hour < 1 || (hour >= 12 && hour < 20); // Black Friday game
    case "Sat":
      return hour >= 12; // December Saturday slates
    default:
      return false;
  }
}

export function staleAfterMs(date = new Date()) {
  return isGameWindow(date) ? FAST_STALE_MS : SLOW_STALE_MS;
}

export function isStale(fetchedAt, now = new Date()) {
  if (!fetchedAt) return true;
  const then = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt);
  if (Number.isNaN(then.getTime())) return true;
  return now.getTime() - then.getTime() >= staleAfterMs(now);
}

// The whole decision in one testable place.
//   "fetch-required" — nothing cached, the caller has to wait for Yahoo
//   "fetch"          — stale, and we won the claim, so refresh and serve
//   "serve-cache"    — fresh, or someone else is already refreshing
export function decideRefresh({ hasCache, stale, claimed }) {
  if (!hasCache) return "fetch-required";
  if (!stale) return "serve-cache";
  return claimed ? "fetch" : "serve-cache";
}
