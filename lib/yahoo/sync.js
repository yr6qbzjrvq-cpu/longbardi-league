// Cache-first reads of the league, with a Yahoo refresh attached to the
// requests that find the cache stale.
//
// Nothing in here is scheduled. The 45-second poll from MatchupBoard is
// the clock: it asks for matchups, finds the cached copy older than the
// staleness window, wins the single-flight claim, calls Yahoo once, and
// writes the result back for everyone else.
//
// What goes into the cache is ALREADY mapped into the site's shapes, so
// the read path is a single Supabase select and a JSON parse.

import { TEAMS } from "../leagueData.js";
import { matchupHref, matchupSlug } from "../fantasyShapes.js";
import { isYahooConfigured, NFL_GAME_CODE } from "./config.js";
import { yahooGet, YahooApiError } from "./api.js";
import {
  countYetToPlay,
  makeManagerResolver,
  mapLeagueMeta,
  mapLeagues,
  mapRosters,
  mapScoreboard,
  mapStandings,
  mapTeams,
  weeklyScoresFromScoreboard,
} from "./map.js";
import { CLAIM_MS, decideRefresh, isStale } from "./freshness.js";
import {
  claimCacheRefresh,
  getConnection,
  readCache,
  recordError,
  recordSync,
  writeCache,
} from "./store.js";

const resolver = makeManagerResolver(TEAMS.map((t) => t.manager));

export const KEYS = {
  standings: "standings",
  teams: "teams",
  scoreboard: (week) => `scoreboard:w${week}`,
  rosters: (week) => `rosters:w${week}`,
};

// Within one lambda, two concurrent readers of the same key share a single
// promise. Across lambdas that job belongs to yahoo_claim_cache in SQL.
const inFlight = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function leagueKey() {
  if (!isYahooConfigured()) {
    throw new YahooApiError(
      "Yahoo is not configured (YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET).",
      { fatal: true }
    );
  }
  const { row } = await getConnection();
  if (!row?.league_key) {
    throw new YahooApiError("No Yahoo league selected yet.", { fatal: true });
  }
  return row.league_key;
}

// The one place a Yahoo call turns into a cache row.
async function refresh(key, produce) {
  const payload = await produce();
  await writeCache(key, payload);
  await recordSync();
  return { payload, fetchedAt: new Date().toISOString(), stale: false };
}

// cache-first read. Returns null when there is nothing to show, which is
// the caller's cue to fall back to the hand-built data.
async function cached(key, produce) {
  if (inFlight.has(key)) return inFlight.get(key);

  const run = (async () => {
    const hit = await readCache(key);
    const hasCache = Boolean(hit);
    const stale = isStale(hit?.fetchedAt);

    let claimed = false;
    if (!hasCache || stale) claimed = await claimCacheRefresh(key, CLAIM_MS);

    const decision = decideRefresh({ hasCache, stale, claimed });

    if (decision === "serve-cache") {
      return { payload: hit.payload, fetchedAt: hit.fetchedAt, stale };
    }

    if (decision === "fetch-required" && !claimed) {
      // Cold start, and someone else got there first. Give them a moment
      // rather than making a second identical call to Yahoo.
      for (let i = 0; i < 4; i += 1) {
        await sleep(500);
        const again = await readCache(key);
        if (again) {
          return {
            payload: again.payload,
            fetchedAt: again.fetchedAt,
            stale: isStale(again.fetchedAt),
          };
        }
      }
    }

    try {
      return await refresh(key, produce);
    } catch (err) {
      const message = err?.message || String(err);
      if (!(err instanceof YahooApiError)) await recordError(message);
      // A stale answer beats no answer; a missing one falls back.
      if (hit) return { payload: hit.payload, fetchedAt: hit.fetchedAt, stale: true };
      return null;
    }
  })();

  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}

// --- the fetchers --------------------------------------------------------

export async function fetchScoreboard(week) {
  const key = await leagueKey();
  const suffix = week ? `;week=${week}` : "";
  const doc = await yahooGet(`/league/${key}/scoreboard${suffix}`);
  const board = mapScoreboard(doc, resolver, {
    slug: matchupSlug,
    href: matchupHref,
  });
  return { ...board, weeklyScores: weeklyScoresFromScoreboard(board) };
}

export async function fetchStandings() {
  const key = await leagueKey();
  const doc = await yahooGet(`/league/${key}/standings`);
  return { rows: mapStandings(doc, resolver) };
}

export async function fetchTeams() {
  const key = await leagueKey();
  const doc = await yahooGet(`/league/${key}/teams`);
  return { teams: mapTeams(doc, resolver) };
}

// One call for all twelve rosters, with each player's week stats and
// points attached. Twelve separate team requests would work too, and would
// be twelve times the Yahoo traffic.
export async function fetchRosters(week) {
  const key = await leagueKey();
  const w = Number(week) || 1;
  const doc = await yahooGet(
    `/league/${key}/teams/roster;week=${w}/players/stats;type=week;week=${w}`
  );
  return { week: w, rosters: mapRosters(doc, resolver) };
}

export async function fetchLeagueMeta() {
  const key = await leagueKey();
  const doc = await yahooGet(`/league/${key}`);
  return mapLeagueMeta(doc);
}

// Used once, right after consent, to find out which league(s) Austin is in.
export async function discoverLeagues() {
  const doc = await yahooGet(
    `/users;use_login=1/games;game_keys=${NFL_GAME_CODE}/leagues`
  );
  return mapLeagues(doc);
}

export async function fetchLoginNickname() {
  try {
    const doc = await yahooGet("/users;use_login=1/games;game_keys=nfl/teams");
    const teams = mapTeams(doc, null);
    return teams.find((t) => t.nickname)?.nickname || "";
  } catch {
    return "";
  }
}

// --- the cached reads the site actually uses -----------------------------

export function getScoreboard(week) {
  return cached(KEYS.scoreboard(week), () => fetchScoreboard(week));
}

export function getStandings() {
  return cached(KEYS.standings, () => fetchStandings());
}

export function getRosters(week) {
  return cached(KEYS.rosters(week), () => fetchRosters(week));
}

// Read the roster cache WITHOUT triggering a Yahoo call. Used to work out
// "3 yet to play" on the matchup list, which is a nicety, not a reason to
// double our API traffic.
export async function peekRosters(week) {
  const hit = await readCache(KEYS.rosters(week));
  return hit?.payload || null;
}

// Yahoo never says how many starters are still to play. The site already
// pulls the real NFL slate for Pick 'Em, so the answer comes from there.
export function attachYetToPlay(board, rosterPayload, games) {
  if (!board?.matchups || !rosterPayload?.rosters || !games?.length) return board;
  const byManager = new Map(rosterPayload.rosters.map((r) => [r.manager, r]));
  const fill = (s) => ({
    ...s,
    yetToPlay: countYetToPlay(byManager.get(s.manager), games),
  });
  return {
    ...board,
    matchups: board.matchups.map((m) => ({
      ...m,
      away: fill(m.away),
      home: fill(m.home),
    })),
  };
}
