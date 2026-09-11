import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { clearCache, saveConnection } from "@/lib/yahoo/store";
import { discoverLeagues } from "@/lib/yahoo/sync";

export const dynamic = "force-dynamic";

// Which league are we mirroring? Set automatically after connecting when
// there is only one; this is the picker for when there is more than one.
export async function POST(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const leagueKey = String(payload?.leagueKey || "").trim();
  if (!leagueKey) {
    return NextResponse.json({ error: "Missing league." }, { status: 400 });
  }

  let leagues;
  try {
    leagues = await discoverLeagues();
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }

  const chosen = leagues.find((l) => l.leagueKey === leagueKey);
  if (!chosen) {
    return NextResponse.json(
      { error: "That league isn't one of yours." },
      { status: 400 }
    );
  }

  const saved = await saveConnection({
    league_key: chosen.leagueKey,
    league_name: chosen.name,
    league_season: chosen.season,
    league_num_teams: chosen.numTeams,
    league_current_week: chosen.currentWeek,
  });
  if (saved.error) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  // Anything cached belonged to the old league.
  await clearCache();

  return NextResponse.json({ ok: true, league: chosen });
}

// The picker needs the list.
export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  try {
    return NextResponse.json({ leagues: await discoverLeagues() });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
