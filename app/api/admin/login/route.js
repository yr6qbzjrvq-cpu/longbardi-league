import { NextResponse } from "next/server";
import crypto from "crypto";
import { sessionToken, SESSION_COOKIE } from "@/lib/auth";

export async function POST(request) {
  const { password } = await request.json().catch(() => ({}));

  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { error: "ADMIN_PASSWORD is not set on the server." },
      { status: 500 }
    );
  }

  const expected = Buffer.from(process.env.ADMIN_PASSWORD);
  const given = Buffer.from(String(password || ""));
  const match =
    expected.length === given.length &&
    crypto.timingSafeEqual(expected, given);

  if (!match) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
