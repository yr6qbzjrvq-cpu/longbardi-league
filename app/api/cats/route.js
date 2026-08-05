import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 5 * 1024 * 1024;
const EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(request) {
  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Uploads aren't set up yet." },
      { status: 503 }
    );
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const file = form.get("file");
  const name = String(form.get("name") || "").trim();
  const caption = String(form.get("caption") || "").trim();

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Pick a photo first." }, { status: 400 });
  }
  if (!name || name.length > 40) {
    return NextResponse.json({ error: "Add your name." }, { status: 400 });
  }
  if (caption.length > 140) {
    return NextResponse.json(
      { error: "Caption is too long." },
      { status: 400 }
    );
  }
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json(
      { error: "That file type isn't supported. Use JPG, PNG, WEBP or GIF." },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "That image is too large. Keep it under 5MB." },
      { status: 400 }
    );
  }

  const path = `${Date.now()}-${crypto.randomUUID()}.${EXT[file.type]}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from("cat-photos")
    .upload(path, bytes, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json(
      { error: "Couldn't save that image. Try again." },
      { status: 500 }
    );
  }

  const { error: rowError } = await supabase
    .from("cat_photos")
    .insert({ path, name: name.slice(0, 40), caption: caption || null });

  if (rowError) {
    // Don't leave an orphaned file behind if the row insert fails.
    await supabase.storage.from("cat-photos").remove([path]);
    return NextResponse.json(
      { error: "Couldn't save that image. Try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
