// ============================================================
// HSPNeighborhood — server-side multiplayer state (milestone 4)
// ------------------------------------------------------------
// Shared by the /api/neighborhood/* routes. Event-level server
// authority lives here plus lib/neighborhood/movement and
// lib/neighborhood/pathing: clients only ever ASK to walk
// somewhere; the routes compute the authoritative position and
// path with the exact modules the client renders with, then
// broadcast the result on the room's Realtime channel.
//
// Storage: the neighborhood_players table (RLS on, zero
// policies — house pattern: all access through these gated
// routes with the service-role client). A row's x/y is the
// position at path start; path + path_started_at let anyone
// compute the current position deterministically. move_times
// backs the rate limit in Postgres so it survives serverless
// cold starts and multiple lambda instances.
//
// Moderation (milestone 7): muted blocks chat server-side; a
// kick stamps kicked_until and zeroes last_seen, so the row
// stays behind as the BAN RECORD — inactive for rosters,
// capacity and name-uniqueness (all filtered by last_seen),
// but every route checks activeBan() before letting the
// player back in. pruneStale and /leave both spare rows with
// a live ban so nobody can erase their own timeout.
//
// SEAM (future upgrade): to swap Vercel+Supabase for a
// dedicated socket server later, port the route handler bodies
// + these helpers onto the socket server and keep the wire
// events identical ("move", "leave" broadcasts + presence
// keyed by playerId) — the client transport lives entirely in
// lib/neighborhood/realtime.js, so no client rewrite.
// ============================================================

export const TABLE = "neighborhood_players";

// last_seen younger than this = "in the room" for capacity and
// username-uniqueness purposes. Heartbeats arrive every 30s.
export const ACTIVE_WINDOW_MS = 75_000;

export const PLAYER_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

// Default timeout when the commissioner kicks someone.
export const KICK_DEFAULT_MINUTES = 10;

export function activeCutoffIso(nowMs = Date.now()) {
  return new Date(nowMs - ACTIVE_WINDOW_MS).toISOString();
}

// PostgREST .or() filter that matches rows WITHOUT a live ban
// (no kicked_until, or one already in the past).
export function noBanFilter(nowMs = Date.now()) {
  return `kicked_until.is.null,kicked_until.lt.${new Date(nowMs).toISOString()}`;
}

// A row's live ban, or null. Returns the machine payload + the
// human message every route hands back on code "kicked".
export function activeBan(row, nowMs = Date.now()) {
  const until = row && row.kicked_until ? Date.parse(row.kicked_until) : NaN;
  if (!Number.isFinite(until) || until <= nowMs) return null;
  const minutes = Math.max(1, Math.ceil((until - nowMs) / 60_000));
  return {
    until,
    minutes,
    message: `You were removed from the neighborhood by the commissioner. You can come back in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  };
}

// Drop rows whose last_seen went stale (closed laptops, dead
// tabs that never sent /leave). Called on every join so the
// table stays tidy without a cron. Rows carrying a live ban
// survive — the row IS the ban record; it goes once the ban
// lapses.
export async function pruneStale(supabase) {
  await supabase
    .from(TABLE)
    .delete()
    .lt("last_seen", activeCutoffIso())
    .or(noBanFilter());
}

export async function listActivePlayers(supabase, roomId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, username, avatar, room, x, y, path, path_started_at, last_seen")
    .eq("room", roomId)
    .gte("last_seen", activeCutoffIso());
  if (error) throw error;
  return data || [];
}

// DB row → what goes over the wire to clients.
export function toWirePlayer(row) {
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    x: row.x,
    y: row.y,
    path: Array.isArray(row.path) ? row.path : [],
    startedAt: row.path_started_at ? Date.parse(row.path_started_at) : null,
  };
}

export function channelTopic(roomId) {
  return `neighborhood:${roomId}`;
}

// Broadcast one event to everyone subscribed to the room's
// Realtime channel via Supabase's HTTP broadcast endpoint — no
// websocket needed from a serverless function (the approved
// trade-off: peers see walks start ~150-300ms late, your own
// avatar moves instantly).
//
// CHANNEL SECURITY (milestone-1 decision): while the
// neighborhood is admin-gated, a public channel + anon-key
// subscribe is acceptable. Before the NEIGHBORHOOD_PUBLIC
// flip, harden this to private channels with signed Realtime
// tokens so only joined players can subscribe/broadcast.
export async function broadcastToRoom(roomId, event, payload) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [{ topic: channelTopic(roomId), event, payload, private: false }],
      }),
    });
  } catch {
    // A dropped broadcast only delays peers until their next
    // roster resync — never fail the API call over it.
  }
}
