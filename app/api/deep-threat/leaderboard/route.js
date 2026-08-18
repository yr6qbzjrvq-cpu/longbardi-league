import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeDeepThreat } from "@/lib/deepThreatAccess";

export const dynamic = "force-dynamic";

// The game runs in the browser, so a score arrives here on trust. The clamp
// below is the only thing standing between the board and someone with the
// dev tools open — worth knowing before this goes league-wide.
const MAX_STREAK = 300;
const MAX_NAME = 18;

async function topTen(supabase) {
  const { data, error } = await supabase
    .from("deep_threat_scores")
    .select("name, streak, created_at")
    .order("streak", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function GET() {
  if (!(await canSeeDeepThreat())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const supabase = getAdminClient();
  if (!supabase) return NextResponse.json({ scores: [] });

  try {
    return NextResponse.json({ scores: await topTen(supabase) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  if (!(await canSeeDeepThreat())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const raw = body && typeof body.name === "string" ? body.name : "";
  const name = raw
    .trim()
    .split(" ")
    .filter((part) => part.length > 0)
    .join(" ")
    .slice(0, MAX_NAME);
  const streak = Number(body && body.streak);

  if (!name) {
    return NextResponse.json({ error: "Enter a name." }, { status: 400 });
  }
  if (!Number.isInteger(streak) || streak < 1 || streak > MAX_STREAK) {
    return NextResponse.json(
      { error: "That score doesn't look right." },
      { status: 400 }
    );
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "The leaderboard isn't connected yet." },
      { status: 503 }
    );
  }

  const { error } = await supabase
    .from("deep_threat_scores")
    .insert({ name, streak });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    return NextResponse.json({ scores: await topTen(supabase) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
