import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";
import { slugify } from "@/lib/articles";

export async function POST(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured. Add your env vars first (see README)." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  const record = {
    title: body.title.trim(),
    slug: slugify(body.title),
    excerpt: body.excerpt?.trim() || null,
    content: body.content || "",
    image_url: body.image_url?.trim() || null,
    featured: Boolean(body.featured),
    published: body.published !== false,
  };

  // Only one featured article at a time.
  if (record.featured) {
    await supabase.from("articles").update({ featured: false }).eq("featured", true);
  }

  let { data, error } = await supabase
    .from("articles")
    .insert(record)
    .select()
    .single();

  // Slug collision → retry with a unique suffix.
  if (error?.code === "23505") {
    record.slug = `${record.slug}-${Date.now().toString(36)}`;
    ({ data, error } = await supabase
      .from("articles")
      .insert(record)
      .select()
      .single());
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidatePath("/");
  revalidatePath("/articles");
  return NextResponse.json({ article: data });
}
