// ============================================================
// HSPNeighborhood — shared chat message rules (milestone 5)
// ------------------------------------------------------------
// Pure module, no browser or server dependencies — imported by
// the chat API route (authoritative) AND by the client input
// for instant feedback, the same pattern as validateUsername.
// sanitize → length cap → keep-it-friendly filter. Messages
// are stored and broadcast as PLAIN TEXT ONLY: every render
// path (canvas bubbles, React text nodes) already treats them
// as text, and this module strips markup anyway so nothing
// that even looks like HTML survives to storage.
// ============================================================

import { containsBlockedWord } from "@/lib/neighborhoodPlayer";

export const CHAT_MAX = 200;

// How long a speech bubble hangs around: base + reading time.
export function bubbleDurationMs(text) {
  return Math.min(4000 + String(text || "").length * 40, 9000);
}

// Strip control characters (including zero-width and line
// separator tricks) and anything shaped like markup, then
// collapse runs of whitespace. Chat is single-line plain text.
export function sanitizeChatText(raw) {
  return String(raw || "")
    .replace(/<[^>]*>/g, " ") // whole tags out
    .replace(/[<>]/g, " ") // stray angle brackets too
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Returns { ok: true, value } or { ok: false, error, code }.
export function validateChatText(raw) {
  const value = sanitizeChatText(raw);
  if (!value) {
    return { ok: false, error: "Say something first.", code: "empty" };
  }
  if (value.length > CHAT_MAX) {
    return {
      ok: false,
      error: `Keep it under ${CHAT_MAX} characters.`,
      code: "too_long",
    };
  }
  if (containsBlockedWord(value)) {
    return {
      ok: false,
      error: "Keep it friendly — that message won't send.",
      code: "blocked_word",
    };
  }
  return { ok: true, value };
}
