import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TIERS = ["announcements", "all"];

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const email = String(payload?.email || "")
    .trim()
    .toLowerCase();
  const tier = String(payload?.tier || "all");

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json(
      { error: "That doesn't look like a valid email address." },
      { status: 400 }
    );
  }
  if (!TIERS.includes(tier)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Subscriptions aren't set up yet." },
      { status: 503 }
    );
  }

  // Was this address already on the list? Determines the message we show back.
  const { data: existing } = await supabase
    .from("subscribers")
    .select("id, tier")
    .eq("email", email)
    .maybeSingle();

  const { error } = await supabase
    .from("subscribers")
    .upsert({ email, tier }, { onConflict: "email" });

  if (error) {
    return NextResponse.json(
      { error: "Couldn't save that. Try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    updated: Boolean(existing),
    changed: Boolean(existing) && existing.tier !== tier,
  });
}
