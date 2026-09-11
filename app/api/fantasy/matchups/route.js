import { NextResponse } from "next/server";
import { getMatchups, isPlaceholder } from "@/lib/fantasy";
import { canSeeFantasy } from "@/lib/fantasyAccess";
import { totalWeeks } from "@/lib/nfl";

export const dynamic = "force-dynamic";

// The matchup page polls this every 45 seconds while games are on, and that
// poll is the thing that keeps the Yahoo cache fresh — there is no cron
// (Vercel Hobby allows one run a DAY). getMatchups() serves the cached copy
// and, if it has gone stale and no other request is already doing it, calls
// Yahoo once and writes the new numbers back for everybody.
export async function GET(request) {
  if (!(await canSeeFantasy())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const week = Number(searchParams.get("week")) || 1;
  if (week < 1 || week > totalWeeks()) {
    return NextResponse.json({ error: "Bad week." }, { status: 400 });
  }

  const [matchups, placeholder] = await Promise.all([
    getMatchups(week),
    isPlaceholder(),
  ]);

  return NextResponse.json({
    week,
    placeholder,
    source: placeholder ? "placeholder" : "yahoo",
    updatedAt: new Date().toISOString(),
    matchups,
  });
}
