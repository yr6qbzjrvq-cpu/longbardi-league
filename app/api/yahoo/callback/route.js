import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAuthed } from "@/lib/auth";
import { applyTokenResponse, exchangeCode } from "@/lib/yahoo/oauth";
import {
  isYahooConfigured,
  OAUTH_STATE_COOKIE,
  yahooRedirectUri,
} from "@/lib/yahoo/config";
import { getConnection, recordError, saveConnection } from "@/lib/yahoo/store";
import { discoverLeagues } from "@/lib/yahoo/sync";

export const dynamic = "force-dynamic";

function back(params) {
  const url = new URL("/admin/yahoo", yahooRedirectUri());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

// Step 2: Yahoo sends the browser back here with ?code=. Swap it for
// tokens, then go looking for the league.
export async function GET(request) {
  if (!(await isAuthed())) return back({ error: "not_admin" });
  if (!isYahooConfigured()) return back({ error: "not_configured" });

  const { searchParams } = new URL(request.url);

  const denied = searchParams.get("error");
  if (denied) {
    await recordError(`Yahoo consent was declined: ${denied}`);
    return back({ error: "denied" });
  }

  const code = searchParams.get("code");
  if (!code) return back({ error: "no_code" });

  const store = await cookies();
  const expected = store.get(OAUTH_STATE_COOKIE)?.value;
  const got = searchParams.get("state");
  if (!expected || !got || expected !== got) {
    return back({ error: "bad_state" });
  }
  store.delete(OAUTH_STATE_COOKIE);

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    await recordError(err.message, { fatal: true });
    return back({ error: "exchange_failed" });
  }

  const { row } = await getConnection();
  const patch = applyTokenResponse(row, tokens);
  const saved = await saveConnection({
    ...patch,
    connected_at: new Date().toISOString(),
    token_lock_at: null,
  });
  if (saved.error) {
    return back({ error: "save_failed" });
  }

  // Now that we can call the API, ask Yahoo which NFL leagues this account
  // is in. One league: pick it automatically. Several: the admin page shows
  // a picker.
  let leagues = [];
  try {
    leagues = await discoverLeagues();
  } catch (err) {
    await recordError(`Connected, but the league lookup failed: ${err.message}`);
    return back({ connected: "1", error: "league_lookup_failed" });
  }

  const active = leagues.filter((l) => !l.isFinished);
  const choice = active.length === 1 ? active[0] : null;

  if (choice) {
    await saveConnection({
      league_key: choice.leagueKey,
      league_name: choice.name,
      league_season: choice.season,
      league_num_teams: choice.numTeams,
      league_current_week: choice.currentWeek,
    });
    return back({ connected: "1" });
  }

  return back({ connected: "1", pick: "1" });
}
