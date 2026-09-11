import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { WEEKLY_SCORES } from "@/lib/leagueData";
import { clearCache, recordSync, writeCache } from "@/lib/yahoo/store";
import {
  fetchRosters,
  fetchScoreboard,
  fetchStandings,
  KEYS,
} from "@/lib/yahoo/sync";

export const dynamic = "force-dynamic";

// "Sync now" on the admin page: throw the cache away and pull a fresh copy
// of everything, reporting exactly what worked. This is the button to press
// on 9/15 right after connecting, to prove the whole chain works.
export async function POST(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  let week = WEEKLY_SCORES.week;
  try {
    const body = await request.json();
    if (body?.week) week = Number(body.week) || week;
  } catch {
    // no body is fine
  }

  await clearCache();

  const results = {};
  const step = async (name, key, run) => {
    try {
      const payload = await run();
      await writeCache(key, payload);
      results[name] = { ok: true };
      return payload;
    } catch (err) {
      results[name] = { ok: false, error: err.message };
      return null;
    }
  };

  const board = await step("scoreboard", KEYS.scoreboard(week), () =>
    fetchScoreboard(week)
  );
  await step("standings", KEYS.standings, () => fetchStandings());
  await step("rosters", KEYS.rosters(week), () => fetchRosters(week));

  const ok = Object.values(results).every((r) => r.ok);
  if (ok) await recordSync();

  return NextResponse.json({
    ok,
    week,
    matchups: board?.matchups?.length || 0,
    results,
  });
}
