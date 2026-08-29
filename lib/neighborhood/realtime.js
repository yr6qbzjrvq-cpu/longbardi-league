// ============================================================
// HSPNeighborhood — client realtime connection (milestone 4)
// ------------------------------------------------------------
// One connection object per room visit. Join flow:
//   1. subscribe to the room's Supabase Realtime channel FIRST
//      (so no "move" broadcast slips past between the roster
//      fetch and the subscription),
//   2. POST /api/neighborhood/join to claim the username and
//      get the authoritative roster (rejects: name_taken,
//      room_full — surfaced to the caller as err.code),
//   3. presence.track so everyone else sees us instantly.
//
// Presence is KEYED BY playerId: a reconnect (or refresh)
// replaces the old presence entry instead of leaving a ghost,
// and the join API upserts the same DB row. On websocket
// re-subscribes we re-track + re-join to resync the roster.
//
// SEAM (future upgrade): this file is the ONLY client
// transport code. Validation, pathing and walk math live in
// lib/neighborhood/* shared modules, so a dedicated socket
// server later just needs a sibling of this file speaking the
// same events ("move", "leave", presence) — no client rewrite.
// ============================================================

import { getPublicClient } from "@/lib/supabase";

const HEARTBEAT_MS = 30_000;

let cachedClient;
function client() {
  if (cachedClient === undefined) cachedClient = getPublicClient();
  return cachedClient;
}

async function api(path, body, keepalive = false) {
  const res = await fetch(`/api/neighborhood/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // no JSON body
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.code = (data && data.code) || `http_${res.status}`;
    err.status = res.status;
    throw err;
  }
  return data || {};
}

// Returns a connection: { self, players, serverNow, clockOffset,
// solo, move(x,y), updateSelf(x,y), leave() }. Throws with
// err.code "name_taken" / "room_full" / "bad_name" when the
// join is rejected.
export async function joinRoom({ roomId, player, onRoster, onPeerJoin, onPeerMove, onPeerLeave }) {
  const supabase = client();
  const joinBody = {
    playerId: player.playerId,
    username: player.username,
    avatar: player.avatar,
    roomId,
  };

  let selfPos = { x: 0, y: 0 };
  const presencePayload = () => ({
    username: player.username,
    avatar: player.avatar,
    x: selfPos.x,
    y: selfPos.y,
  });

  let channel = null;
  if (supabase) {
    channel = supabase.channel(`neighborhood:${roomId}`, {
      config: { presence: { key: player.playerId }, broadcast: { self: false } },
    });
    channel.on("broadcast", { event: "move" }, ({ payload }) => {
      if (payload && payload.id && payload.id !== player.playerId) onPeerMove(payload);
    });
    channel.on("broadcast", { event: "leave" }, ({ payload }) => {
      if (payload && payload.id && payload.id !== player.playerId) onPeerLeave(payload.id);
    });
    channel.on("presence", { event: "join" }, ({ key, newPresences }) => {
      if (key !== player.playerId && newPresences && newPresences[0]) {
        onPeerJoin(key, newPresences[0]);
      }
    });
    channel.on("presence", { event: "leave" }, ({ key }) => {
      if (key === player.playerId) return;
      // Same playerId can appear from a reconnect: only treat
      // it as gone when no presence meta remains for the key.
      const remaining = channel.presenceState()[key];
      if (!remaining || remaining.length === 0) onPeerLeave(key);
    });

    let firstSubscribe = true;
    await new Promise((resolve) => {
      // Never hang the join on a flaky websocket — the join
      // API still registers us; realtime catches up later.
      const failsafe = setTimeout(resolve, 8000);
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          if (firstSubscribe) {
            firstSubscribe = false;
            clearTimeout(failsafe);
            resolve();
          } else {
            // Reconnected after a blip: re-announce ourselves
            // and resync the authoritative roster so anything
            // missed while offline is corrected (and our own
            // ghost, if any, is replaced — presence key wins).
            try {
              await channel.track(presencePayload());
              const fresh = await api("join", joinBody);
              if (onRoster) onRoster(fresh.players || [], fresh.serverNow || Date.now());
            } catch {
              // next heartbeat retries
            }
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          if (firstSubscribe) {
            firstSubscribe = false;
            clearTimeout(failsafe);
            resolve();
          }
        }
      });
    });
  }

  let joined;
  try {
    joined = await api("join", joinBody);
  } catch (err) {
    if (channel && supabase) {
      try {
        supabase.removeChannel(channel);
      } catch {
        // already gone
      }
    }
    throw err;
  }

  const allPlayers = Array.isArray(joined.players) ? joined.players : [];
  const self = allPlayers.find((p) => p.id === player.playerId) || null;
  if (self) selfPos = { x: self.x, y: self.y };

  if (channel) {
    try {
      await channel.track(presencePayload());
    } catch {
      // presence is best-effort; roster resyncs cover us
    }
  }

  const serverNow = Number.isFinite(joined.serverNow) ? joined.serverNow : Date.now();
  const clockOffset = serverNow - Date.now();
  let closed = false;

  // Keep last_seen fresh so capacity/uniqueness checks see us;
  // if our row vanished (server pruned us during a long sleep)
  // quietly rejoin.
  const heartbeatTimer = setInterval(async () => {
    if (closed) return;
    try {
      const r = await api("heartbeat", { playerId: player.playerId });
      if (r && r.ok === false && r.code === "not_joined") {
        const fresh = await api("join", joinBody);
        if (onRoster) onRoster(fresh.players || [], fresh.serverNow || Date.now());
      }
    } catch {
      // transient — try again next beat
    }
  }, HEARTBEAT_MS);

  return {
    self,
    players: allPlayers.filter((p) => p.id !== player.playerId),
    serverNow,
    clockOffset,
    solo: !channel,
    // Ask the server to walk us somewhere. The server computes
    // the authoritative path from ITS deterministic idea of our
    // position — we never send a position, only a destination.
    move: (x, y) => api("move", { playerId: player.playerId, x, y }),
    // Keep the presence payload's resting spot roughly current
    // (used only as a first guess by peers who missed events).
    updateSelf: (x, y) => {
      selfPos = { x, y };
    },
    leave: () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeatTimer);
      if (channel && supabase) {
        try {
          supabase.removeChannel(channel);
        } catch {
          // already gone
        }
      }
      // keepalive fetch so the row is deleted even on tab close
      api("leave", { playerId: player.playerId }, true).catch(() => {});
    },
  };
}
