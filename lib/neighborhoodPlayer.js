// ============================================================
// HSPNeighborhood — per-browser player identity + name rules
// ------------------------------------------------------------
// IMPORTANT (Austin's call, milestone 1): while the world is
// admin-gated he will share the admin login with friends to
// test multiplayer. So player identity is per-BROWSER — a
// localStorage player id + chosen username — never the auth
// account. Two phones on the same admin login are two players.
//
// validateUsername() is a pure function with no browser
// dependencies, so the milestone-4 join API can run the exact
// same rules server-side before writing to plaza_players.
// Username UNIQUENESS is deliberately deferred to that join
// API (first-come in-room); localStorage is just a draft.
// ============================================================

import { normalizeAvatar } from "./neighborhoodAvatar";

const STORAGE_KEY = "hspn_neighborhood_player_v1";

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 16;

// Names that would let a player impersonate staff. Matched
// against a leetspeak-flattened version of the name.
const RESERVED = [
  "admin",
  "administrator",
  "moderator",
  "commissioner",
  "commish",
  "official",
  "system",
  "server",
  "hspnstaff",
];

// Keep-it-friendly filter. Substring match on the flattened
// name, so it slightly over-blocks — acceptable for a private
// league hangout.
const BLOCKED = [
  "fuck",
  "shit",
  "cunt",
  "bitch",
  "whore",
  "slut",
  "nigg",
  "fagg",
  "rapist",
  "hitler",
  "nazi",
  "penis",
  "vagina",
  "porn",
];

// Flatten common letter-swaps so "4dm1n" reads as "admin".
function flatten(name) {
  return name
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/@/g, "a")
    .replace(/\$/g, "s")
    .replace(/[^a-z]/g, "");
}

// Returns { ok: true, value } with the cleaned name, or
// { ok: false, error } with a human message.
export function validateUsername(raw) {
  const value = String(raw || "").trim().replace(/\s+/g, " ");
  if (value.length < USERNAME_MIN) {
    return { ok: false, error: `Name needs at least ${USERNAME_MIN} characters.` };
  }
  if (value.length > USERNAME_MAX) {
    return { ok: false, error: `Name can be at most ${USERNAME_MAX} characters.` };
  }
  if (!/^[A-Za-z0-9 _-]+$/.test(value)) {
    return {
      ok: false,
      error: "Letters, numbers, spaces, dashes and underscores only.",
    };
  }
  if (!/[A-Za-z]/.test(value)) {
    return { ok: false, error: "Name needs at least one letter." };
  }
  const flat = flatten(value);
  if (RESERVED.some((word) => flat.includes(word))) {
    return { ok: false, error: "That name is reserved. Pick another." };
  }
  if (BLOCKED.some((word) => flat.includes(word))) {
    return { ok: false, error: "Keep it friendly — pick another name." };
  }
  return { ok: true, value };
}

function newPlayerId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Load the saved player, or null. Browser-only.
export function loadPlayer() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      playerId: typeof parsed.playerId === "string" ? parsed.playerId : newPlayerId(),
      username: typeof parsed.username === "string" ? parsed.username : "",
      avatar: normalizeAvatar(parsed.avatar),
      updatedAt: parsed.updatedAt || null,
    };
  } catch {
    return null;
  }
}

// Persist username + avatar, keeping any existing playerId so a
// returning player stays the same player. Browser-only.
export function savePlayer({ username, avatar }) {
  if (typeof window === "undefined") return null;
  const existing = loadPlayer();
  const record = {
    playerId: existing?.playerId || newPlayerId(),
    username,
    avatar: normalizeAvatar(avatar),
    updatedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage full / private mode — the session still works,
    // the character just won't survive a reload.
  }
  return record;
}
