import crypto from "crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAuthed } from "@/lib/auth";
import { buildAuthUrl } from "@/lib/yahoo/oauth";
import {
  isYahooConfigured,
  OAUTH_STATE_COOKIE,
  yahooClientId,
  yahooRedirectUri,
} from "@/lib/yahoo/config";

export const dynamic = "force-dynamic";

// Step 1 of the OAuth dance. Commissioner only — this is the button on
// /admin/yahoo. Everything that can go wrong lands back on that page with a
// readable reason rather than a stack trace.
export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.redirect(new URL("/admin", yahooRedirectUri()));
  }

  if (!isYahooConfigured()) {
    return NextResponse.redirect(
      new URL("/admin/yahoo?error=not_configured", yahooRedirectUri())
    );
  }

  // Random state, stored in an httpOnly cookie, compared on the way back.
  // Stops anyone from feeding us someone else's authorization code.
  const state = crypto.randomBytes(24).toString("hex");
  const store = await cookies();
  store.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    // lax, not strict: Yahoo sends the browser back with a top-level GET,
    // and a strict cookie would not ride along.
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });

  return NextResponse.redirect(
    buildAuthUrl({
      clientId: yahooClientId(),
      redirectUri: yahooRedirectUri(),
      state,
    })
  );
}
