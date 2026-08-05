import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";

export async function DELETE(request, { params }) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  // Look up the storage path first so the file gets removed too.
  const { data: row } = await supabase
    .from("cat_photos")
    .select("path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("cat_photos").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (row?.path) {
    await supabase.storage.from("cat-photos").remove([row.path]);
  }

  return NextResponse.json({ ok: true });
}
