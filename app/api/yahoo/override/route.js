import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { saveConnection } from "@/lib/yahoo/store";

export const dynamic = "force-dynamic";

// The commissioner's kill switch. Yahoo stays connected, but the site goes
// back to the hand-built numbers — for when Yahoo is showing nonsense and
// disconnecting (and re-consenting later) would be overkill.
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

  const saved = await saveConnection({
    force_placeholder: Boolean(payload?.force),
  });
  if (saved.error) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, force: Boolean(payload?.force) });
}
