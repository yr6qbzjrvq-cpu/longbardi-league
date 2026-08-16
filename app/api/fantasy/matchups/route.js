import { NextResponse } from "next/server";
import { getMatchups, isPlaceholder } from "@/lib/fantasy";
import { canSeeFantasy } from "@/lib/fantasyAccess";

export const dynamic = "force-dynamic";

// The matchup page polls this while games are on. Kept deliberately thin so
// swapping in Yahoo means changing lib/fantasy.js and nothing else.
export async function GET(request) {
  if (!(await canSeeFantasy())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const week = Number(searchParams.get("week")) || 1;
  if (week < 1 || week > 18) {
    return NextResponse.json({ error: "Bad week." }, { status: 400 });
  }

  const matchups = await getMatchups(week);

  return NextResponse.json({
    week,
    placeholder: isPlaceholder(),
    updatedAt: new Date().toISOString(),
    matchups,
  });
}
