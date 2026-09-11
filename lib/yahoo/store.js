// Server-only storage for the Yahoo connection and the response cache.
//
// Both tables are service-role-only: RLS is ON and they carry ZERO
// policies, so the anon key the browser holds cannot read a row even if it
// asks nicely. Tokens never leave the server — the admin page renders a
// summary, never the secrets.

import { getAdminClient } from "../supabase.js";

export const CONNECTION_ID = "default";

// Columns the admin UI is allowed to see. Deliberately excludes
// access_token and refresh_token.
export const SAFE_CONNECTION_FIELDS = [
  "status",
  "yahoo_nickname",
  "yahoo_guid",
  "league_key",
  "league_name",
  "league_season",
  "league_num_teams",
  "league_current_week",
  "connected_at",
  "last_sync_at",
  "last_error",
  "last_error_at",
  "force_placeholder",
  "token_expires_at",
];

export function publicConnection(row) {
  if (!row) return null;
  const out = {};
  for (const key of SAFE_CONNECTION_FIELDS) out[key] = row[key] ?? null;
  out.hasRefreshToken = Boolean(row.refresh_token);
  return out;
}

// A missing table is not an error worth exploding over: it just means the
// SQL hasn't been run yet, which the admin page reports as "set up needed".
function softFail(error) {
  if (!error) return null;
  const message = error.message || String(error);
  return { message, missingTable: /relation .* does not exist|schema cache|Could not find the table/i.test(message) };
}

export async function getConnection() {
  const supabase = getAdminClient();
  if (!supabase) return { row: null, error: "Supabase is not configured." };

  const { data, error } = await supabase
    .from("yahoo_connection")
    .select("*")
    .eq("id", CONNECTION_ID)
    .maybeSingle();

  const failure = softFail(error);
  if (failure) {
    return {
      row: null,
      error: failure.missingTable
        ? "The Yahoo tables are missing — run supabase/yahoo.sql."
        : failure.message,
      missingTable: failure.missingTable,
    };
  }
  return { row: data || null, error: null };
}

export async function saveConnection(patch) {
  const supabase = getAdminClient();
  if (!supabase) return { error: "Supabase is not configured." };

  const { error } = await supabase
    .from("yahoo_connection")
    .upsert(
      { id: CONNECTION_ID, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );

  return { error: error?.message || null };
}

export async function clearConnection() {
  return saveConnection({
    access_token: null,
    refresh_token: null,
    token_expires_at: null,
    yahoo_guid: null,
    yahoo_nickname: null,
    league_key: null,
    league_name: null,
    league_season: null,
    league_num_teams: null,
    league_current_week: null,
    status: "disconnected",
    connected_at: null,
    last_sync_at: null,
    last_error: null,
    last_error_at: null,
    token_lock_at: null,
  });
}

export async function recordSync() {
  return saveConnection({
    last_sync_at: new Date().toISOString(),
    last_error: null,
    last_error_at: null,
  });
}

// Failures are loud on purpose: they land on the admin page with a
// timestamp, because a silently dead Yahoo link is the thing that bites.
export async function recordError(message, { fatal = false } = {}) {
  return saveConnection({
    last_error: String(message).slice(0, 500),
    last_error_at: new Date().toISOString(),
    ...(fatal ? { status: "needs_reconnect" } : {}),
  });
}

// --- cache ---------------------------------------------------------------

export async function readCache(key) {
  const supabase = getAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("yahoo_cache")
    .select("cache_key, payload, fetched_at")
    .eq("cache_key", key)
    .maybeSingle();

  if (error || !data || data.payload === null) return null;
  return { payload: data.payload, fetchedAt: data.fetched_at };
}

export async function writeCache(key, payload) {
  const supabase = getAdminClient();
  if (!supabase) return { error: "Supabase is not configured." };

  const now = new Date().toISOString();
  const { error } = await supabase.from("yahoo_cache").upsert(
    {
      cache_key: key,
      payload,
      fetched_at: now,
      lock_at: null,
      updated_at: now,
    },
    { onConflict: "cache_key" }
  );
  return { error: error?.message || null };
}

export async function clearCache(prefix) {
  const supabase = getAdminClient();
  if (!supabase) return { error: "Supabase is not configured." };
  let query = supabase.from("yahoo_cache").delete();
  query = prefix ? query.like("cache_key", `${prefix}%`) : query.neq("cache_key", "");
  const { error } = await query;
  return { error: error?.message || null };
}

// Atomic "am I the one who refreshes this key?". Implemented as a single
// SQL statement (supabase/yahoo.sql) so two lambdas a millisecond apart
// cannot both decide yes and double-call Yahoo.
export async function claimCacheRefresh(key, lockMs) {
  const supabase = getAdminClient();
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("yahoo_claim_cache", {
    p_key: key,
    p_lock_ms: lockMs,
  });
  if (error) return false;
  return data === true;
}

export async function claimTokenRefresh(lockMs) {
  const supabase = getAdminClient();
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("yahoo_claim_token", {
    p_id: CONNECTION_ID,
    p_lock_ms: lockMs,
  });
  if (error) return false;
  return data === true;
}
