import { NextResponse } from "next/server";
import { getWeek, isLocked, currentSeason } from "@/lib/nfl";
import { authenticate, getPicksForWeek } from "@/lib/pickem";
import { getAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: your own picks for a week. Requires your PIN, so nobody can read
// someone else's sheet before the week locks.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const week = Number(searchParams.get("week"));
  const name = searchParams.get("name");
  const pin = searchParams.get("pin");

  const weekData = await getWeek(week);
  if (!weekData) {
    return NextResponse.json({ error: "Bad week." }, { status: 400 });
  }

  const auth = await authenticate(name, pin);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const supabase = getAdminClient();
  const { data } = await supabase
    .from("pickem_picks")
    .select("game_id, pick")
    .eq("player_id", auth.player.id)
    .eq("season", currentSeason())
    .eq("week", week);

  const picks = {};
  for (const row of data || []) picks[row.game_id] = row.pick;

  return NextResponse.json({
    ok: true,
    player: auth.player.name,
    created: Boolean(auth.created),
    picks,
    locked: isLocked(weekData),
  });
}

// POST: submit or update picks. Refused once the week has locked.
export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const week = Number(payload?.week);
  const picks = payload?.picks;

  const weekData = await getWeek(week);
  if (!weekData) {
    return NextResponse.json({ error: "Bad week." }, { status: 400 });
  }

  // Server-side lock check. The UI hides the form too, but this is what
  // actually stops a late submission.
  if (isLocked(weekData)) {
    return NextResponse.json(
      { error: "This week is locked. Kickoff has already happened." },
      { status: 403 }
    );
  }

  const auth = await authenticate(payload?.name, payload?.pin);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  if (!picks || typeof picks !== "object") {
    return NextResponse.json({ error: "No picks sent." }, { status: 400 });
  }

  // Only accept picks for real games in this week, and only teams playing.
  const valid = [];
  for (const game of weekData.games) {
    const choice = picks[game.id];
    if (!choice) continue;
    if (choice !== game.home.abbr && choice !== game.away.abbr) {
      return NextResponse.json(
        { error: "That team isn't in that game." },
        { status: 400 }
      );
    }
    valid.push({
      player_id: auth.player.id,
      season: currentSeason(),
      week,
      game_id: game.id,
      pick: choice,
      updated_at: new Date().toISOString(),
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ error: "No picks sent." }, { status: 400 });
  }

  const supabase = getAdminClient();
  const { error } = await supabase
    .from("pickem_picks")
    .upsert(valid, { onConflict: "player_id,season,week,game_id" });

  if (error) {
    return NextResponse.json(
      { error: "Couldn't save those picks." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, saved: valid.length });
}
