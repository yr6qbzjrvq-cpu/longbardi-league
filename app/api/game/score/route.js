import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";

const CATS = ["johnny", "stevie"];

function publicUrl(path) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/cat-photos/${path}`;
}

// Grading happens here rather than in the browser, which is the whole reason
// the answers were withheld from the round payload.
export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const answers = Array.isArray(payload?.answers) ? payload.answers : null;
  if (!answers || answers.length === 0 || answers.length > 50) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const ids = answers.map((a) => String(a?.id || "")).filter(Boolean);
  const { data, error } = await supabase
    .from("cat_photos")
    .select("id, path, cat")
    .in("id", ids);

  if (error) {
    return NextResponse.json(
      { error: "Couldn't score that round." },
      { status: 500 }
    );
  }

  const byId = new Map((data || []).map((r) => [r.id, r]));
  let score = 0;

  const results = answers.map((a) => {
    const row = byId.get(String(a?.id));
    const guess = String(a?.guess || "").toLowerCase();
    const actual = row?.cat || null;
    const correct = Boolean(actual) && CATS.includes(guess) && guess === actual;
    if (correct) score += 1;
    return {
      id: row?.id ?? null,
      url: row ? publicUrl(row.path) : null,
      guess,
      actual,
      correct,
    };
  });

  return NextResponse.json({ score, total: results.length, results });
}
