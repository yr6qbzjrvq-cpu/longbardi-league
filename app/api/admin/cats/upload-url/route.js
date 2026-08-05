import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";

const EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Hands back a one-shot signed URL so the browser uploads straight to Supabase
// Storage. Nothing large ever passes through a Vercel function, which is what
// the old 4.5MB body cap was enforcing.
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

  const contentType = String(payload?.contentType || "");
  if (!EXT[contentType]) {
    return NextResponse.json(
      { error: "Unsupported file type." },
      { status: 400 }
    );
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  // Random path so the filename never hints at which cat it is.
  const path = `${crypto.randomUUID()}.${EXT[contentType]}`;

  const { data, error } = await supabase.storage
    .from("cat-photos")
    .createSignedUploadUrl(path);

  if (error) {
    return NextResponse.json(
      { error: "Couldn't start the upload." },
      { status: 500 }
    );
  }

  return NextResponse.json({ path, token: data.token });
}
