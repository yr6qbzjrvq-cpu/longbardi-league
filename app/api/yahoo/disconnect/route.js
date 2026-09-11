import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { clearCache, clearConnection } from "@/lib/yahoo/store";

export const dynamic = "force-dynamic";

// Forget the tokens and everything we mirrored. The site drops straight
// back to the hand-built numbers — no other switch to throw.
export async function POST() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const cleared = await clearConnection();
  if (cleared.error) {
    return NextResponse.json({ error: cleared.error }, { status: 500 });
  }
  await clearCache();

  return NextResponse.json({ ok: true });
}
