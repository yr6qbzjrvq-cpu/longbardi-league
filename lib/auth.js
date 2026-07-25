import crypto from "crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "longbardi_admin";

// Deterministic session token derived from the admin password.
// Changing ADMIN_PASSWORD invalidates all existing sessions.
export function sessionToken() {
  if (!process.env.ADMIN_PASSWORD) return null;
  return crypto
    .createHash("sha256")
    .update(`longbardi-admin:${process.env.ADMIN_PASSWORD}`)
    .digest("hex");
}

export async function isAuthed() {
  const token = sessionToken();
  if (!token) return false;
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE);
  if (!cookie?.value) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(cookie.value),
      Buffer.from(token)
    );
  } catch {
    return false;
  }
}
