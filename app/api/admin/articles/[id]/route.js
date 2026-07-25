import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";

async function guard() {
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
  return supabase;
}

export async function PUT(request, { params }) {
  const supabase = await guard();
  if (supabase instanceof NextResponse) return supabase;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const updates = {
    title: body.title?.trim(),
    excerpt: body.excerpt?.trim() || null,
    content: body.content ?? "",
    image_url: body.image_url?.trim() || null,
    featured: Boolean(body.featured),
    published: body.published !== false,
    updated_at: new Date().toISOString(),
  };
  if (!updates.title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  if (updates.featured) {
    await supabase
      .from("articles")
      .update({ featured: false })
      .eq("featured", true)
      .neq("id", id);
  }

  const { data, error } = await supabase
    .from("articles")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidatePath("/");
  revalidatePath("/articles");
  revalidatePath(`/articles/${data.slug}`);
  return NextResponse.json({ article: data });
}

export async function DELETE(request, { params }) {
  const supabase = await guard();
  if (supabase instanceof NextResponse) return supabase;

  const { id } = await params;
  const { error } = await supabase.from("articles").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidatePath("/");
  revalidatePath("/articles");
  return NextResponse.json({ ok: true });
}
