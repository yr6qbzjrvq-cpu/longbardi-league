import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";

const ROUND_SIZE = 20;

function publicUrl(path) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/cat-photos/${path}`;
}

// Returns photos for a round WITHOUT their answers. The cat label never leaves
// the server here, so opening devtools doesn't spoil the game.
export async function GET() {
  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("cat_photos")
    .select("id, path")
    .not("cat", "is", null);

  if (error) {
    return NextResponse.json(
      { error: "Couldn't load the photos." },
      { status: 500 }
    );
  }

  const pool = data || [];
  // Fisher-Yates, then take up to ROUND_SIZE.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const questions = pool.slice(0, ROUND_SIZE).map((p) => ({
    id: p.id,
    url: publicUrl(p.path),
  }));

  return NextResponse.json({ questions, available: pool.length });
}
