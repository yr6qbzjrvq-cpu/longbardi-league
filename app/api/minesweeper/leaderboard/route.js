import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeMinesweeper } from "@/lib/minesweeperAccess";

export const dynamic = "force-dynamic";

// Times arrive from the browser on trust, same caveat as the Deep Threat
// board: the clamps below are the only guard against someone with dev tools.
const MAX_SECONDS = 999;
const MAX_NAME = 24;
const DIFFICULTIES = ["rookie", "pro", "legend"];

async function topTen(supabase, difficulty) {
  const { data, error } = await supabase
    .from("minesweeper_scores")
    .select("name, seconds, created_at")
    .eq("difficulty", difficulty)
    .order("seconds", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) throw error;
  return data || [];
}

async function allBoards(supabase) {
  const boards = {};
  for (const difficulty of DIFFICULTIES) {
    boards[difficulty] = await topTen(supabase, difficulty);
  }
  return boards;
}

function emptyBoards() {
  return { rookie: [], pro: [], legend: [] };
}

export async function GET() {
  if (!(await canSeeMinesweeper())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const supabase = getAdminClient();
    if (!supabase) return NextResponse.json({ boards: emptyBoards() });
    return NextResponse.json({ boards: await allBoards(supabase) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  if (!(await canSeeMinesweeper())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const body = await request.json();
    const name = String(body.name || "").trim().slice(0, MAX_NAME);
    const difficulty = String(body.difficulty || "");
    const seconds = body.seconds;
    if (!name) {
      return NextResponse.json({ error: "Name required." }, { status: 400 });
    }
    if (!DIFFICULTIES.includes(difficulty)) {
      return NextResponse.json({ error: "Unknown difficulty." }, { status: 400 });
    }
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SECONDS) {
      return NextResponse.json({ error: "That time looks wrong." }, { status: 400 });
    }
    const supabase = getAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "The leaderboard is not configured." },
        { status: 503 }
      );
    }
    const { error } = await supabase
      .from("minesweeper_scores")
      .insert({ name, difficulty, seconds });
    if (error) throw error;
    return NextResponse.json({ boards: await allBoards(supabase) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
