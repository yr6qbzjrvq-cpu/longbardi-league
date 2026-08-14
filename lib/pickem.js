import crypto from "crypto";
import { getAdminClient } from "./supabase";

// PINs are salted and hashed. A four digit PIN is weak by nature, so the point
// is only to stop teammates casually submitting or peeking as each other.
// The stored value never leaves the server either way.
const PIN_SALT = "hspn-pickem-v1";

export function hashPin(name, pin) {
  return crypto
    .createHash("sha256")
    .update(`${PIN_SALT}:${name.toLowerCase()}:${pin}`)
    .digest("hex");
}

export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Returns { ok, player, error }. Creates the player on first use, which is
// when their PIN gets set.
export async function authenticate(name, pin) {
  const supabase = getAdminClient();
  if (!supabase) return { ok: false, error: "Not configured" };

  const clean = String(name || "").trim();
  const cleanPin = String(pin || "").trim();

  if (!clean) return { ok: false, error: "Pick your name." };
  if (!/^\d{4}$/.test(cleanPin)) {
    return { ok: false, error: "PIN must be 4 digits." };
  }

  const { data: existing } = await supabase
    .from("pickem_players")
    .select("id, name, pin_hash")
    .eq("name", clean)
    .maybeSingle();

  const hash = hashPin(clean, cleanPin);

  if (!existing) {
    const { data, error } = await supabase
      .from("pickem_players")
      .insert({ name: clean, pin_hash: hash })
      .select("id, name")
      .single();
    if (error) return { ok: false, error: "Couldn't set up that player." };
    return { ok: true, player: data, created: true };
  }

  if (!safeEqual(existing.pin_hash, hash)) {
    return { ok: false, error: "That PIN doesn't match." };
  }

  return { ok: true, player: { id: existing.id, name: existing.name } };
}

export async function getPicksForWeek(season, week) {
  const supabase = getAdminClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("pickem_picks")
    .select("player_id, game_id, pick")
    .eq("season", season)
    .eq("week", week);
  return data || [];
}

export async function getPlayers() {
  const supabase = getAdminClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("pickem_players")
    .select("id, name")
    .order("name");
  return data || [];
}

export async function getAllPicks(season) {
  const supabase = getAdminClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("pickem_picks")
    .select("player_id, week, game_id, pick")
    .eq("season", season);
  return data || [];
}
