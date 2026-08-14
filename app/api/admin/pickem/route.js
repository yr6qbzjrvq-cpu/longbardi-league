import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Commissioner-only. Removes a Pick 'Em player, which clears their PIN and
// their picks so they can start over (their picks cascade with the row).
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

  const id = payload?.id;
  if (!id) {
    return NextResponse.json({ error: "Missing player." }, { status: 400 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }

  // Delete picks first in case the foreign key isn't set to cascade.
  await supabase.from("pickem_picks").delete().eq("player_id", id);

  const { error } = await supabase
    .from("pickem_players")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
