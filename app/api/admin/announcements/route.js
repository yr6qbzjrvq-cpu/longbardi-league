import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";

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

  const title = String(payload?.title || "").trim();
  const body = String(payload?.body || "").trim();
  const publishedOn = String(payload?.published_on || "").trim();

  if (!title || title.length > 120) {
    return NextResponse.json({ error: "Add a title." }, { status: 400 });
  }
  if (!body) {
    return NextResponse.json({ error: "Add some text." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedOn)) {
    return NextResponse.json({ error: "Pick a date." }, { status: 400 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("announcements")
    .insert({ title, body, published_on: publishedOn })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Couldn't save that announcement." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id: data.id });
}
