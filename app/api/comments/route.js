import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";

// Server-side comment posting used only for the commissioner's privilege: a
// comment posted WITHOUT the mandated "Glory to our great commissioner"
// sign-off. Normal comments are inserted straight from the browser with the
// anon key (see components/Comments.jsx) and always keep the sign-off. The
// client calls this route only when a comment is prefixed with the private
// "/sudo" token. The exemption (no_signoff = true) is honored ONLY when the
// request carries a valid admin session; anyone else who reaches this route
// just gets a normal, signed-off comment. The anon key can never set
// no_signoff (the table's RLS insert policy forbids it) -- only this route,
// holding the service-role key, can, and the browser never sees that key.
export async function POST(request) {
  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 500 }
    );
  }

  const payload = await request.json().catch(() => ({}));
  const thread_key = String(payload.thread_key || "").trim().slice(0, 200);
  const name = String(payload.name || "").trim().slice(0, 40);
  const body = String(payload.body || "").trim().slice(0, 2000);
  if (!thread_key || !name || !body) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }

  const authed = await isAuthed();

  const { error } = await supabase.from("comments").insert({
    thread_key,
    name,
    body,
    no_signoff: authed,
  });

  if (error) {
    return NextResponse.json({ error: "Could not post that." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
