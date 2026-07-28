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

  const { error } = await supabase.from("subscribers").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
