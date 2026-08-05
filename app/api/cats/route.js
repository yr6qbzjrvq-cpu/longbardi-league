import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";

const CATS = ["johnny", "stevie"];

// Records a photo after the browser has already pushed the file to storage.
// Admin only: every photo needs a correct answer attached, so randoms can't add.
export async function POST(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const path = String(payload?.path || "").trim();
  const cat = String(payload?.cat || "").toLowerCase();

  if (!path) {
    return NextResponse.json({ error: "Missing file." }, { status: 400 });
  }
  if (!CATS.includes(cat)) {
    return NextResponse.json(
      { error: "Pick Johnny or Stevie." },
      { status: 400 }
    );
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const { error } = await supabase.from("cat_photos").insert({ path, cat });
  if (error) {
    await supabase.storage.from("cat-photos").remove([path]);
    return NextResponse.json(
      { error: "Couldn't save that photo." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
