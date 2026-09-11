// Test harness for the Yahoo Fantasy integration.
// Run: node scripts/test-yahoo.mjs
//
// Everything here runs offline. The fixtures in scripts/fixtures/yahoo are
// Yahoo's own published sample responses (sports.yahoo.com/developer/docs)
// plus a Longbardi-shaped league built to the same schema, so the mapping,
// the token-rotation rules and the staleness/single-flight logic can all be
// checked long before the API entitlement switches on.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseXml, find, findAll, kid, ownText, text, decodeEntities } from "../lib/yahoo/xml.js";
import {
  countYetToPlay,
  makeManagerResolver,
  mapLeagues,
  mapRosters,
  mapScoreboard,
  mapStandings,
  normalizeNflAbbr,
  readStatMap,
  statsForPosition,
  weeklyScoresFromScoreboard,
} from "../lib/yahoo/map.js";
import { applyTokenResponse, tokenExpired, EXPIRY_SKEW_MS } from "../lib/yahoo/oauth.js";
import {
  decideRefresh,
  isGameWindow,
  isStale,
  staleAfterMs,
  FAST_STALE_MS,
  SLOW_STALE_MS,
} from "../lib/yahoo/freshness.js";
import { buildAuthUrl } from "../lib/yahoo/oauth.js";
import { matchupHref, matchupSlug } from "../lib/fantasyShapes.js";
import { statLine } from "../lib/fantasy.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  parseXml(readFileSync(path.join(here, "fixtures", "yahoo", name), "utf8"));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log("  ok   " + name);
  } else {
    fail += 1;
    console.log("  FAIL " + name + (extra !== undefined ? "  << " + JSON.stringify(extra) : ""));
  }
}
function eq(name, a, b) {
  ok(`${name} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
}

const MANAGERS = [
  "Casey", "Scott", "Dominic", "Austin", "Nathan", "Jakki",
  "Rocco", "Tyler", "Steven", "Joey", "Hunter", "Anthony",
];
const resolve = makeManagerResolver(MANAGERS);

// =====================================================================
console.log("\n-- the XML reader --");
{
  const doc = parseXml(`<?xml version="1.0"?><a n="2"><b><c>x &amp; y</c></b><b><c>2</c></b><d/></a>`);
  eq("root element", doc.name, "a");
  eq("attributes", doc.attrs.n, "2");
  eq("repeated children", findAll(doc, "b").length, 2);
  eq("entities decoded", text(doc, "c"), "x & y");
  eq("self-closing tags", kid(doc, "d").name, "d");
  eq("numeric entity", decodeEntities("Ja&#39;Marr"), "Ja'Marr");
  ok("missing elements are empty, not thrown", text(doc, "nope") === "");
  ok("parsing junk returns null", parseXml("not xml at all") === null);
  ok("parsing nothing returns null", parseXml("") === null);
}
{
  // findAll must not descend INTO a match: a matchup contains teams, and a
  // team contains no matchups, so six matchups must stay six.
  const doc = parseXml("<l><m><t><m/></t></m><m><t/></m></l>");
  eq("findAll stops at the first match", findAll(doc, "m").length, 2);
}
{
  // ownText vs text: a matchup has its own <week>, and so does every
  // team_points block nested inside it.
  const doc = parseXml("<matchup><week>3</week><team><team_points><week>9</week></team_points></team></matchup>");
  eq("ownText reads the direct child", ownText(doc, "week"), "3");
  eq("text finds the first at any depth", text(doc, "week"), "3");
}

// =====================================================================
console.log("\n-- Yahoo's own published scoreboard sample --");
{
  const board = mapScoreboard(fixture("doc-scoreboard.xml"), resolve, {
    slug: matchupSlug,
    href: matchupHref,
  });
  eq("week", board.week, 16);
  eq("matchups", board.matchups.length, 2);

  const first = board.matchups[0];
  eq("away points", first.away.points, 112.82);
  eq("home points", first.home.points, 95.8);
  eq("away projection", first.away.projected, 108.87);
  eq("status becomes final", first.final, true);
  eq("team names survive", first.away.teamName, "marky's Bold Team");
  // These old samples have no <nickname>, so the resolver has to fall back
  // to the team name rather than blow up.
  eq("no nickname falls back to the team name", first.away.manager, "marky's Bold Team");
  eq("slug is order independent", first.slug, matchupSlug("Mayfield of dreams", "marky's Bold Team"));
  eq("href points at the matchup page", first.href.startsWith("/matchups/16/"), true);
  eq("second matchup read too", board.matchups[1].home.points, 100.94);
}

// =====================================================================
console.log("\n-- Yahoo's own published standings sample --");
{
  const rows = mapStandings(fixture("doc-standings.xml"), resolve);
  eq("three teams", rows.length, 3);
  eq("ordered by Yahoo's rank", rows.map((r) => r.rank), [1, 2, 3]);
  eq("wins", rows[0].wins, 8);
  eq("losses", rows[0].losses, 6);
  eq("points for", rows[0].pf, 1583.16);
  eq("points against", rows[0].pa, 1447.26);
  eq("losing streak", rows[0].streak, "L2");
  eq("winning streak", rows[2].streak, "W7");
  ok("every row has what StandingsTable reads",
    rows.every((r) => typeof r.team === "string" && typeof r.manager === "string" &&
      Number.isFinite(r.pf) && Number.isFinite(r.pa) && typeof r.streak === "string"));
}

// =====================================================================
console.log("\n-- a Longbardi week --");
const board = mapScoreboard(fixture("longbardi-scoreboard.xml"), resolve, {
  slug: matchupSlug,
  href: matchupHref,
});
{
  eq("six matchups", board.matchups.length, 6);
  eq("week 3", board.week, 3);

  const managers = board.matchups.flatMap((m) => [m.away.manager, m.home.manager]);
  eq("all twelve managers resolved to site names", managers.slice().sort(), MANAGERS.slice().sort());

  eq("exact nickname match", board.matchups[0].away.manager, "Casey");
  eq("dotted username matches", board.matchups[0].home.manager, "Scott");
  eq("short nickname falls back to the team name", board.matchups[1].away.manager, "Dominic");
  eq("hidden manager falls back to the team name", board.matchups[2].away.manager, "Nathan");
  eq("nickname with a suffix matches", board.matchups[3].away.manager, "Rocco");

  eq("finished game", board.matchups[0].final, true);
  eq("game in progress is not final", board.matchups[1].final, false);
  eq("game in progress has started", board.matchups[1].started, true);
  eq("game that hasn't kicked off", board.matchups[5].started, false);

  ok("every side has the five fields MatchupBoard renders",
    board.matchups.every((m) => [m.away, m.home].every((s) =>
      typeof s.manager === "string" && typeof s.teamName === "string" &&
      Number.isFinite(s.points) && Number.isFinite(s.projected) &&
      Number.isFinite(s.yetToPlay))));
}

console.log("\n-- the home page's score strip --");
{
  const scores = weeklyScoresFromScoreboard(board);
  eq("week carried through", scores.week, 3);
  eq("six rows", scores.matchups.length, 6);
  eq("first row", scores.matchups[0], {
    home: "Scott", homeScore: 96.3, away: "Casey", awayScore: 118.42, status: "Final",
  });
  eq("a game in progress is Live, not Final", scores.matchups[1].status, "Live");
  eq("a game that hasn't kicked off is Upcoming", scores.matchups[5].status, "Upcoming");
  eq("a week with play in it is not preseason", scores.preseason, false);
  ok("scores are numbers the strip can call toFixed on",
    scores.matchups.every((m) => Number.isFinite(m.homeScore) && Number.isFinite(m.awayScore)));
}
{
  // A week where nothing has kicked off should read as preseason, the same
  // as the hand-built data does today.
  const untouched = {
    week: 1,
    matchups: board.matchups.map((m) => ({ ...m, started: false })),
  };
  eq("nothing kicked off reads as preseason", weeklyScoresFromScoreboard(untouched).preseason, true);
}

console.log("\n-- twelve-team standings --");
{
  const rows = mapStandings(fixture("longbardi-standings.xml"), resolve);
  eq("twelve rows", rows.length, 12);
  eq("all resolved to site managers", rows.map((r) => r.manager).sort(), MANAGERS.slice().sort());
  eq("team column is the manager, like TEAMS has it", rows[0].team, rows[0].manager);
  eq("top of the table", rows[0].wins, 3);
  eq("bottom of the table", rows[11].wins, 0);
  eq("streak formatting", rows[11].streak, "L3");
  ok("the admin mapping table has what it needs",
    rows.every((r) => typeof r.yahooTeamName === "string" && r.teamKey));
}

// =====================================================================
console.log("\n-- rosters, slots and box scores --");
const rosters = mapRosters(fixture("doc-roster.xml"), resolve);
{
  eq("one team", rosters.length, 1);
  const r = rosters[0];
  eq("manager from the nickname", r.manager, "Austin");
  eq("team name", r.teamName, "Hillis Heroes");
  eq("five starters", r.starters.length, 5);
  eq("one on the bench", r.bench.length, 1);
  eq("bench player is the benched one", r.bench[0].name, "Tony Pollard");

  const [qb, flex, wr, k, def] = r.starters;
  eq("QB slot", qb.slot, "QB");
  eq("QB points", qb.points, 24.66);
  eq("Yahoo's W/R/T becomes the site's FLEX", flex.slot, "FLEX");
  eq("flex keeps the player's real position", flex.position, "RB");
  eq("abbreviations are upper-cased", qb.nflTeam, "ARI");
  eq("multi-letter abbreviations survive", wr.nflTeam, "CIN");
  eq("kicker slot", k.slot, "K");
  eq("defence slot", def.slot, "DEF");

  eq("QB stats", qb.stats, { passYds: 287, passTD: 2, int: 1, rushYds: 41, rushTD: 1 });
  eq("RB stats", flex.stats, { carries: 19, rushYds: 104, rushTD: 1, rec: 5, recYds: 38, recTD: 0 });
  eq("WR stats", wr.stats, { targets: 11, rec: 7, recYds: 118, recTD: 2 });
  eq("kicker field goals are summed across the distance buckets", k.stats.fgm, 3);
  eq("kicker extra points", k.stats.xpm, 3);
  eq("defence stats", def.stats, { sacks: 4, int: 2, fumRec: 1, pointsAllowed: 13, defTD: 1 });

  ok("every player has what the box score renders",
    [...r.starters, ...r.bench].every((p) =>
      typeof p.slot === "string" && typeof p.name === "string" &&
      typeof p.nflTeam === "string" && Number.isFinite(p.points)));
}

console.log("\n-- stat lines survive Yahoo's gaps --");
{
  // Yahoo only sends the categories the league scores. statLine has to
  // print what is there and silently skip what is not - never "undefined".
  const [qb, flex, wr, k, def] = rosters[0].starters;
  const lines = [qb, flex, wr, k, def].map(statLine);
  ok("no undefined anywhere", lines.every((l) => !l.includes("undefined")), lines);
  eq("QB line", statLine(qb), "287 pass yds, 2 TD, 1 INT, 41 rush yds, 1 rush TD");
  eq("RB line", statLine(flex), "19 car, 104 yds, 1 TD, 5 rec, 38 yds");
  eq("WR line", statLine(wr), "7/11, 118 yds, 2 TD");
  eq("kicker line drops the attempts Yahoo never sends", statLine(k), "3 FG, 3 XP");
  eq("defence line", statLine(def), "4 sack, 2 INT, 1 FR, 1 TD, 13 pts allowed");
  eq("a player with no stats at all", statLine({ position: "WR", stats: {} }), "");
  eq("a player with no stats key", statLine({ position: "QB" }), "");
  ok("the placeholder's fuller stats still print the old way",
    statLine({ position: "QB", stats: { completions: 21, attempts: 30, passYds: 260, passTD: 2 } })
      === "21/30, 260 pass yds, 2 TD");
}

console.log("\n-- stat mapping details --");
{
  const raw = readStatMap(find(fixture("doc-roster.xml"), "player"));
  eq("stat map is keyed by Yahoo's stat ids", raw["4"], 287);
  const partial = statsForPosition("WR", { "11": 4 });
  eq("absent stats stay absent rather than becoming zero", partial, { rec: 4 });
  ok("no targets key at all when Yahoo didn't send one", !("targets" in partial));
  eq("a dash means zero", readStatMap(parseXml(
    "<player><player_stats><stats><stat><stat_id>12</stat_id><value>-</value></stat></stats></player_stats></player>"
  ))["12"], 0);
}

// =====================================================================
console.log("\n-- league discovery --");
{
  const leagues = mapLeagues(fixture("leagues.xml"));
  eq("two leagues", leagues.length, 2);
  eq("league key", leagues[0].leagueKey, "449.l.1000");
  eq("name", leagues[0].name, "Longbardi");
  eq("twelve teams", leagues[0].numTeams, 12);
  eq("current week", leagues[0].currentWeek, 3);
  eq("the finished one is flagged", leagues[1].isFinished, true);
  eq("only one league is live, so the callback can auto-pick it",
    leagues.filter((l) => !l.isFinished).length, 1);
}

// =====================================================================
console.log("\n-- manager matching --");
{
  const r = makeManagerResolver(MANAGERS);
  eq("exact", r({ nickname: "Austin" }), "Austin");
  eq("case insensitive", r({ nickname: "AUSTIN" }), "Austin");
  eq("punctuation ignored", r({ nickname: "scott.watters" }), "Scott");
  eq("trailing initial", r({ nickname: "Casey L" }), "Casey");
  eq("nickname beats team name", r({ nickname: "Tyler", teamName: "Casey's Team" }), "Tyler");
  eq("team name when the nickname is useless", r({ nickname: "zz", teamName: "Anthony's Mob" }), "Anthony");
  eq("unmatched nickname is used as-is rather than lost",
    r({ nickname: "Guest9281", teamName: "Some Team" }), "Guest9281");
  eq("nothing at all", r({}), "Unknown");
}

// =====================================================================
console.log("\n-- yet to play --");
{
  const games = [
    { completed: true,  home: { abbr: "ARI" }, away: { abbr: "SF" } },
    { completed: false, home: { abbr: "CIN" }, away: { abbr: "BAL" } },
    { completed: false, home: { abbr: "DAL" }, away: { abbr: "WAS" } },
  ];
  const r = rosters[0];
  // Starters: ARI (done), SF (done), CIN (live), DAL (live), BAL (live).
  eq("three starters still to play", countYetToPlay(r, games), 3);
  eq("no slate, no guess", countYetToPlay(r, []), 0);
  eq("no roster, no guess", countYetToPlay(null, games), 0);
  eq("bench players never count", countYetToPlay(
    { starters: [], bench: [{ nflTeam: "CIN" }] }, games), 0);
  eq("ESPN's WSH is Yahoo's WAS", normalizeNflAbbr("WAS"), "WSH");
  eq("JAC is JAX", normalizeNflAbbr("JAC"), "JAX");
  eq("already-agreeing abbreviations are left alone", normalizeNflAbbr("KC"), "KC");
}

// =====================================================================
console.log("\n-- token rotation (the classic silent killer) --");
{
  const now = new Date("2026-09-15T12:00:00Z");
  const first = applyTokenResponse(null, {
    access_token: "AT1", refresh_token: "RT1", expires_in: 3600,
    xoauth_yahoo_guid: "GUID1",
  }, now);
  eq("access token stored", first.access_token, "AT1");
  eq("refresh token stored", first.refresh_token, "RT1");
  eq("guid stored", first.yahoo_guid, "GUID1");
  eq("expiry is now + expires_in", first.token_expires_at, new Date("2026-09-15T13:00:00Z").toISOString());
  eq("status becomes connected", first.status, "connected");
  eq("connecting clears the old error", first.last_error, null);

  const rotated = applyTokenResponse(first, {
    access_token: "AT2", refresh_token: "RT2", expires_in: 3600,
  }, now);
  eq("a rotated refresh token REPLACES the old one", rotated.refresh_token, "RT2");

  const noRotation = applyTokenResponse(rotated, {
    access_token: "AT3", expires_in: 3600,
  }, now);
  eq("no new refresh token keeps the one we have", noRotation.refresh_token, "RT2");
  ok("and never nulls it out", noRotation.refresh_token !== null);

  const empty = applyTokenResponse(rotated, {
    access_token: "AT4", refresh_token: "", expires_in: 3600,
  }, now);
  eq("an empty string is not a token", empty.refresh_token, "RT2");

  const noExpiry = applyTokenResponse(null, { access_token: "AT" }, now);
  eq("a missing expires_in falls back to an hour", noExpiry.token_expires_at,
    new Date("2026-09-15T13:00:00Z").toISOString());
}

console.log("\n-- expiry, with headroom --");
{
  const now = new Date("2026-09-15T12:00:00Z");
  const at = (mins) => new Date(now.getTime() + mins * 60000).toISOString();
  ok("no token at all is expired", tokenExpired({}, now));
  ok("no expiry recorded is expired", tokenExpired({ access_token: "x" }, now));
  ok("a token with an hour left is fine", !tokenExpired({ access_token: "x", token_expires_at: at(60) }, now));
  ok("a token already past is expired", tokenExpired({ access_token: "x", token_expires_at: at(-1) }, now));
  ok("a token inside the skew window refreshes early",
    tokenExpired({ access_token: "x", token_expires_at: at(1) }, now));
  eq("the skew is two minutes", EXPIRY_SKEW_MS, 120000);
  ok("a garbage expiry is treated as expired",
    tokenExpired({ access_token: "x", token_expires_at: "not a date" }, now));
}

console.log("\n-- the consent URL --");
{
  const url = buildAuthUrl({
    clientId: "CID",
    redirectUri: "https://hspn.vercel.app/api/yahoo/callback",
    state: "abc123",
  });
  const parsed = new URL(url);
  eq("Yahoo's authorize endpoint", parsed.origin + parsed.pathname, "https://api.login.yahoo.com/oauth2/request_auth");
  eq("client id", parsed.searchParams.get("client_id"), "CID");
  eq("authorization code flow", parsed.searchParams.get("response_type"), "code");
  eq("redirect uri", parsed.searchParams.get("redirect_uri"), "https://hspn.vercel.app/api/yahoo/callback");
  eq("state is carried", parsed.searchParams.get("state"), "abc123");
  ok("the secret is nowhere near the URL", !url.includes("secret"));
}

// =====================================================================
console.log("\n-- staleness --");
{
  // 2026-09-13 is a Sunday. Times below are UTC; ET is UTC-4 in September.
  const sundayAfternoon = new Date("2026-09-13T18:00:00Z"); // 2pm ET Sunday
  const wednesday = new Date("2026-09-16T18:00:00Z");       // 2pm ET Wednesday
  const thursdayNight = new Date("2026-09-18T00:30:00Z");   // 8:30pm ET Thursday
  const mondayNight = new Date("2026-09-15T01:00:00Z");     // 9pm ET Sunday
  const tuesdayMorning = new Date("2026-09-15T14:00:00Z");  // 10am ET Tuesday

  ok("Sunday afternoon is a game window", isGameWindow(sundayAfternoon));
  ok("Thursday night is a game window", isGameWindow(thursdayNight));
  ok("Wednesday afternoon is not", !isGameWindow(wednesday));
  ok("Tuesday morning is not", !isGameWindow(tuesdayMorning));
  ok("Sunday night is still a window", isGameWindow(mondayNight));

  eq("60s during games", staleAfterMs(sundayAfternoon), FAST_STALE_MS);
  eq("15 minutes otherwise", staleAfterMs(wednesday), SLOW_STALE_MS);

  const secsAgo = (n, from) => new Date(from.getTime() - n * 1000).toISOString();
  ok("30s old is fresh during a game", !isStale(secsAgo(30, sundayAfternoon), sundayAfternoon));
  ok("90s old is stale during a game", isStale(secsAgo(90, sundayAfternoon), sundayAfternoon));
  ok("90s old is still fresh on a Wednesday", !isStale(secsAgo(90, wednesday), wednesday));
  ok("20 minutes old is stale on a Wednesday", isStale(secsAgo(1200, wednesday), wednesday));
  ok("never fetched is stale", isStale(null, wednesday));
  ok("a nonsense timestamp is stale", isStale("whenever", wednesday));
}

console.log("\n-- single flight --");
{
  eq("nothing cached: someone has to go and get it",
    decideRefresh({ hasCache: false, stale: true, claimed: true }), "fetch-required");
  eq("nothing cached and we lost the race: still flagged as required",
    decideRefresh({ hasCache: false, stale: true, claimed: false }), "fetch-required");
  eq("fresh cache is served without asking Yahoo",
    decideRefresh({ hasCache: true, stale: false, claimed: false }), "serve-cache");
  eq("fresh cache is served even if we hold the claim",
    decideRefresh({ hasCache: true, stale: false, claimed: true }), "serve-cache");
  eq("stale and we won the claim: refresh",
    decideRefresh({ hasCache: true, stale: true, claimed: true }), "fetch");
  eq("stale but someone else is already on it: serve the stale copy",
    decideRefresh({ hasCache: true, stale: true, claimed: false }), "serve-cache");

  // The property that matters: of N concurrent readers of one stale key,
  // exactly one calls Yahoo.
  const claims = Array.from({ length: 12 }, (_, i) => i === 0);
  const decisions = claims.map((claimed) => decideRefresh({ hasCache: true, stale: true, claimed }));
  eq("twelve pollers, one Yahoo call", decisions.filter((d) => d === "fetch").length, 1);
  eq("the other eleven serve what they have", decisions.filter((d) => d === "serve-cache").length, 11);
}

// =====================================================================
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
