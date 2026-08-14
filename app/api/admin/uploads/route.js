import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const BUCKET = "cat-photos";

const EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Commissioner-only. Lists images you've uploaded, newest first, so you can
// grab the address of something again without re-uploading it.
export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }

  const { data, error } = await supabase.storage.from(BUCKET).list("articles", {
    limit: 50,
    sortBy: { column: "created_at", order: "desc" },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const images = (data || [])
    .filter((f) => f.name && !f.name.startsWith("."))
    .map((f) => ({
      name: f.name,
      createdAt: f.created_at,
      url: `${base}/storage/v1/object/public/${BUCKET}/articles/${f.name}`,
    }));

  return NextResponse.json({ images });
}

// Commissioner-only. Hands back a one-time signed URL so the browser can push
// an image straight to storage, which keeps big files away from the server's
// request size limit. Article images live under articles/ so they stay clear
// of the Johnny or Stevie photos in the same bucket.
export async function POST(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const contentType = String(payload?.contentType || "");
  const ext = EXT[contentType];
  if (!ext) {
    return NextResponse.json(
      { error: "That file type isn't supported." },
      { status: 400 }
    );
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }

  const path = `articles/${randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;

  return NextResponse.json({
    uploadUrl: `${base}/storage/v1/object/upload/sign/${BUCKET}/${path}?token=${data.token}`,
    publicUrl: `${base}/storage/v1/object/public/${BUCKET}/${path}`,
  });
}
