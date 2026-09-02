// ============================================================
// HSPNeighborhood — client realtime connection (milestone 4)
// ------------------------------------------------------------
// One connection object per room visit. Join flow:
//   1. subscribe to the room's Supabase Realtime channel FIRST
//      (so no "move" broadcast slips past between the roster
//      fetch and the subscription),
//   2. POST /api/neighborhood/join to claim the username and
//      get the authoritative roster (rejects: name_taken,
//      room_full, kicked — surfaced to the caller as err.code),
//   3. presence.track so everyone else sees us instantly.
//
// Presence is KEYED BY playerId: a reconnect (or refresh)
// replaces the old presence entry instead of leaving a ghost,
// and the join API upserts the same DB row. On websocket
// re-subscribes we re-track + re-join to resync the roster.
//
// Moderation events (milestone 7): a "kicked" broadcast names
// one player — their own client fires onKicked (removed
// screen); everyone else drops the avatar like a leave. A
// "chat_delete" broadcast fires onChatDelete so open logs and
// bubbles lose the deleted message live.
//
// Tomatoes (milestone 13): a "throw" broadcast carries one
// validated throw (thrower, origin, target, start time, flight
// duration) and every client replays the same arc and splat
// from it — the walking pattern, applied to projectiles.
//
// Screen share (milestone 9): a SECOND channel carries the
// WebRTC handshake for the big board. The five rtc-* broadcast
// events are relayed verbatim to onSignal, and the connection
// exposes signal() to send them plus screenPresenceIds() so
// the broadcaster can refuse anyone who is not actually
// watching.
//
// Milestone 12 — ONE broadcast, TWO rooms. That channel used
// to be per-room, which quietly meant a broadcast could only
// ever reach the room it started in: a viewer standing in the
// Sports Bar was on a different topic and the broadcaster in
// Mission Control never heard its hello. Both rooms with a
// screen now subscribe to the SAME signaling topic
// (screenChannelFor() in the room registry -> rtcTopic()), so
// one mesh spans both rooms with no second connection and no
// second announcement. Rooms with no screen open no rtc
// channel at all. We track presence on that channel too, so
// "is this viewer really watching?" has an answer that is not
// tied to one room's roster.
//
// CHANNEL AUTHORIZATION (milestone 10, the go-public flip):
// both channels are PRIVATE, so Supabase runs RLS policies on
// realtime.messages for every subscribe and every publish
// (supabase/neighborhood_realtime_auth.sql). The split into
// two topics is the whole point: on `neighborhood:<room>` a
// client may READ and track presence but may NOT publish, so
// forged move/chat/kicked events are impossible — those can
// only come from an API route holding the service-role key. On
// `neighborhood-rtc:<room>` clients may publish, because the
// handshake needs it; nothing there is trusted on identity
// alone (see lib/neighborhood/broadcastGrant.js).
//
// Before subscribing we ask the server for a credential. With
// SUPABASE_JWT_SECRET configured that is a token scoped to
// this one room; otherwise the browser presents the project
// anon key, which the read policy also accepts. Either way the
// write rules above are unchanged — the token narrows WHICH
// room you may listen to, it is not what stops forgery.
//
// SEAM (future upgrade): this file is the ONLY client
// transport code. Validation, pathing and walk math live in
// lib/neighborhood/* shared modules, so a dedicated socket
// server later just needs a sibling of this file speaking the
// same events ("move", "leave", presence) — no client rewrite.
// ============================================================

import { getPublicClient } from "@/lib/supabase";
import { RTC_EVENTS } from "@/lib/neighborhood/screenshare";
import { VOICE_EVENTS } from "@/lib/neighborhood/voice";
import { channelTopic, rtcTopic } from "@/lib/neighborhood/topics";
import { screenChannelFor } from "@/lib/neighborhood/rooms";

const HEARTBEAT_MS = 30_000;

// Recent chat history for the log backfill on join/reload —
// oldest → newest, already gated + sanitized server-side.
export async function fetchChatHistory(roomId) {
  try {
    const res = await fetch(
      `/api/neighborhood/chat?room=${encodeURIComponent(roomId)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data && Array.isArray(data.messages) ? data.messages : [];
  } catch {
    return [];
  }
}

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
    err.data = data || null; // extra payload (e.g. kicked `until`)
    throw err;
  }
  return data || {};
}

// Returns a connection: { self, players, serverNow, clockOffset,
// solo, move(x,y), chat(text), updateSelf(x,y), detach(), leave() }.
// Throws with err.code "name_taken" / "room_full" / "bad_name" /
// "kicked" when the join is rejected.
export async function joinRoom({
  roomId,
  player,
  entry,
  onRoster,
  onPeerJoin,
  onPeerMove,
  onPeerLeave,
  onChat,
  onChatDelete,
  onKicked,
  onSignal,
  onThrow,
  onBlackjack,
  onVoiceMute,
}) {
  const supabase = client();
  const joinBody = {
    playerId: player.playerId,
    username: player.username,
    avatar: player.avatar,
    roomId,
    // Door transitions (milestone 6) ask to appear at the
    // interior side of the door they walked through; the join
    // API validates it against the room's walkable floor.
    entry: entry || undefined,
  };

  let selfPos = { x: 0, y: 0 };
  const presencePayload = () => ({
    username: player.username,
    avatar: player.avatar,
    x: selfPos.x,
    y: selfPos.y,
  });

  // Realtime credential for the private channels. "scoped" is
  // a signed token pinned to this room; "shared" means the
  // deployment has no signing secret and the browser falls
  // back to the anon key. Never fatal: a failure here just
  // means we try the subscribe with whatever we already have.
  let auth = { mode: "shared", expiresAt: 0 };
  async function refreshAuth() {
    if (!supabase) return;
    try {
      const res = await fetch("/api/neighborhood/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: player.playerId, roomId }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.mode === "scoped" && data.token) {
        auth = { mode: "scoped", expiresAt: Number(data.expiresAt) || 0 };
        await supabase.realtime.setAuth(data.token);
      } else {
        auth = { mode: "shared", expiresAt: 0 };
      }
    } catch {
      // anon key it is
    }
  }
  await refreshAuth();

  let channel = null;
  let rtcChannel = null;
  if (supabase) {
    channel = supabase.channel(channelTopic(roomId), {
      config: {
        private: true,
        presence: { key: player.playerId },
        broadcast: { self: false },
      },
    });
    channel.on("broadcast", { event: "move" }, ({ payload }) => {
      if (payload && payload.id && payload.id !== player.playerId) onPeerMove(payload);
    });
    channel.on("broadcast", { event: "leave" }, ({ payload }) => {
      if (payload && payload.id && payload.id !== player.playerId) onPeerLeave(payload.id);
    });
    channel.on("broadcast", { event: "kicked" }, ({ payload }) => {
      if (!payload || !payload.id) return;
      if (payload.id === player.playerId) {
        if (onKicked) onKicked(payload);
      } else {
        onPeerLeave(payload.id);
      }
    });
    channel.on("broadcast", { event: "chat_delete" }, ({ payload }) => {
      if (payload && payload.id && onChatDelete) onChatDelete(payload);
    });
    // Tomatoes (milestone 13). Same trust story as `move`:
    // this event can only come from the throw route, because
    // clients cannot publish on the gameplay topic at all. Our
    // OWN throws render optimistically at tap time (like our
    // own walk does), so the server echo of our own tomato is
    // dropped here rather than drawn twice.
    channel.on("broadcast", { event: "throw" }, ({ payload }) => {
      if (payload && payload.playerId && payload.playerId !== player.playerId && onThrow) {
        onThrow(payload);
      }
    });
    // Blackjack (milestone 14). Trust story identical to
    // `move` and `throw`: this event can only come from the
    // blackjack route, because clients cannot publish on the
    // gameplay topic. Unlike a tomato there is NO optimistic
    // local version of a hand — cards, money and whose turn it
    // is are whatever the server last said, full stop.
    channel.on("broadcast", { event: "blackjack" }, ({ payload }) => {
      if (payload && onBlackjack) onBlackjack(payload);
    });
    // Voice moderation (milestone 19). Rides the GAMEPLAY
    // topic, which clients cannot publish on, so a forged
    // "so-and-so is muted" is exactly as impossible as a
    // forged kick: this can only come from the admin route.
    // The engine drops the named player from the voice mesh
    // (or tears its own voice down, if the name is ours).
    channel.on("broadcast", { event: "voice_mute" }, ({ payload }) => {
      if (payload && payload.id && onVoiceMute) onVoiceMute(payload);
    });
    channel.on("broadcast", { event: "chat" }, ({ payload }) => {
      // Own messages render optimistically at send time, so the
      // server echo is only applied for everyone else.
      if (payload && payload.playerId && payload.playerId !== player.playerId && onChat) {
        onChat(payload);
      }
    });
    // Screen-share handshake (milestone 9) on its own topic —
    // the one channel clients are allowed to publish on.
    // Payloads are relayed untouched: every routing and TRUST
    // decision (is this for me? is the sender in the room? is
    // this really the commissioner's offer?) belongs to the
    // peer logic in lib/neighborhood/screenshare.js.
    const screenChannel = screenChannelFor(roomId);
    if (screenChannel) {
      rtcChannel = supabase.channel(rtcTopic(screenChannel), {
        config: {
          private: true,
          // `enabled` is explicit because newer realtime clients
          // keep presence OFF unless a channel asks for it. Older
          // ones ignore the flag, so it is safe either way — and
          // the broadcaster treats presence as a hint, not a gate
          // (lib/neighborhood/screenshare.js), so a deployment
          // where presence never arrives still gets a picture.
          presence: { key: player.playerId, enabled: true },
          broadcast: { self: false },
        },
      });
      for (const rtcEvent of Object.values(RTC_EVENTS)) {
        rtcChannel.on("broadcast", { event: rtcEvent }, ({ payload }) => {
          if (payload && onSignal) onSignal(rtcEvent, payload);
        });
      }
    }
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
            } catch (err) {
              // A ban that landed while we were offline
              // surfaces here — everything else waits for the
              // next heartbeat to retry.
              if (err && err.code === "kicked" && onKicked) {
                onKicked({
                  id: player.playerId,
                  until: err.data && err.data.until,
                  message: err.message,
                });
              }
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

    // The signaling channel joins right behind it, for rooms
    // that have a screen. Awaited so that walking into a room
    // already showing a broadcast finds a live channel for the
    // first rtc-hello (a lost one costs a retry beat, not the
    // session).
    if (rtcChannel) {
      await new Promise((resolve) => {
        const failsafe = setTimeout(resolve, 8000);
        let settled = false;
        rtcChannel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            // Presence here is the board audience — everyone
            // watching, in either room. The broadcaster only
            // answers ids on this list.
            rtcChannel.track({ room: roomId }).catch(() => {});
          }
          if (settled) return;
          if (
            status === "SUBSCRIBED" ||
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT"
          ) {
            settled = true;
            clearTimeout(failsafe);
            resolve();
          }
        });
      });
    }
  }

  let joined;
  try {
    joined = await api("join", joinBody);
  } catch (err) {
    if (supabase) {
      for (const ch of [channel, rtcChannel]) {
        if (!ch) continue;
        try {
          supabase.removeChannel(ch);
        } catch {
          // already gone
        }
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
  // quietly rejoin. A rejoin refused with "kicked" goes to the
  // removed screen — the server won't take us back until the
  // ban lapses, so there is nothing to retry.
  const heartbeatTimer = setInterval(async () => {
    if (closed) return;
    // A scoped Realtime token outlives an hour; re-mint well
    // before it lapses so the socket is never dropped
    // mid-visit. Shared (anon-key) mode has nothing to renew.
    if (
      auth.mode === "scoped" &&
      auth.expiresAt &&
      auth.expiresAt - Date.now() < 10 * 60 * 1000
    ) {
      await refreshAuth();
    }
    try {
      const r = await api("heartbeat", { playerId: player.playerId });
      if (r && r.ok === false && r.code === "not_joined") {
        const fresh = await api("join", joinBody);
        if (onRoster) onRoster(fresh.players || [], fresh.serverNow || Date.now());
      }
    } catch (err) {
      if (err && err.code === "kicked" && onKicked) {
        onKicked({
          id: player.playerId,
          until: err.data && err.data.until,
          message: err.message,
        });
      }
      // otherwise transient — try again next beat
    }
  }, HEARTBEAT_MS);

  function closeChannels() {
    if (!supabase) return;
    for (const ch of [channel, rtcChannel]) {
      if (!ch) continue;
      try {
        supabase.removeChannel(ch);
      } catch {
        // already gone
      }
    }
  }

  return {
    self,
    players: allPlayers.filter((p) => p.id !== player.playerId),
    serverNow,
    clockOffset,
    solo: !channel,
    // Say something: the server validates + stores + broadcasts;
    // resolves with { ok, message } where message carries the
    // confirmed id/timestamp for the optimistic log entry.
    chat: (text) => api("chat", { playerId: player.playerId, text }),
    // Throw a tomato. `target` is { kind: "spot", x, y } |
    // { kind: "player", targetId } | { kind: "screen", sx, sy }
    // — a TARGET, never a trajectory: the server decides where
    // we are standing and how the thing flies, so every client
    // replays the identical arc.
    throwTomato: (target) =>
      api("throw", { playerId: player.playerId, ...target }),
    // Ask the table to do something: "sit", "bet", "hit", ...
    // Never an outcome — the route deals the cards and decides
    // the money, then broadcasts the result to the room.
    // `sync` is also how the clock moves: the table's deadlines
    // are advanced by whoever asks, because a serverless
    // function cannot tick on its own.
    blackjack: (action, extra) =>
      api("blackjack", { playerId: player.playerId, action, ...(extra || {}) }),
    // Ask the server to walk us somewhere. The server computes
    // the authoritative path from ITS deterministic idea of our
    // position — we never send a position, only a destination.
    move: (x, y) => api("move", { playerId: player.playerId, x, y }),
    // Fire one screen-share signaling event at the room. Not
    // awaited by callers: the handshake is retried by design
    // (viewers say hello again on the next rtc-live), so a
    // dropped packet costs a beat, never the session.
    signal: (event, payload) => {
      if (!rtcChannel) return Promise.resolve();
      return rtcChannel
        .send({ type: "broadcast", event, payload: payload || {} })
        .catch(() => {});
    },
    // Open the per-room VOICE signaling channel (milestone 19)
    // on demand — only when this player turns voice on, so a
    // voice-off visit costs zero extra channels. The topic is
    // rtcTopic(roomId): the per-room slot the RLS policies
    // have allowed clients to publish on since milestone 10
    // (and the slot a scoped token's nb_room claim already
    // names), while the SCREEN handshake lives on the shared
    // big-board topic — two meshes, two topics, no crosstalk.
    // Resolves null (never throws) when the subscribe fails,
    // and the caller owns close().
    openVoice: (onVoiceSignal) => {
      if (!supabase) return Promise.resolve(null);
      const ch = supabase.channel(rtcTopic(roomId), {
        config: {
          private: true,
          presence: { key: player.playerId, enabled: true },
          broadcast: { self: false },
        },
      });
      for (const voiceEvent of Object.values(VOICE_EVENTS)) {
        ch.on("broadcast", { event: voiceEvent }, ({ payload }) => {
          if (payload && onVoiceSignal) onVoiceSignal(voiceEvent, payload);
        });
      }
      return new Promise((resolve) => {
        let settled = false;
        const failsafe = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            supabase.removeChannel(ch);
          } catch {
            // already gone
          }
          resolve(null);
        }, 8000);
        ch.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            ch.track({ voice: true }).catch(() => {});
            if (settled) return;
            settled = true;
            clearTimeout(failsafe);
            resolve({
              send: (event, payload) =>
                ch
                  .send({ type: "broadcast", event, payload: payload || {} })
                  .catch(() => {}),
              presenceIds: () => {
                try {
                  return Object.keys(ch.presenceState() || {});
                } catch {
                  return [];
                }
              },
              close: () => {
                try {
                  supabase.removeChannel(ch);
                } catch {
                  // already gone
                }
              },
            });
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            if (settled) return;
            settled = true;
            clearTimeout(failsafe);
            try {
              supabase.removeChannel(ch);
            } catch {
              // already gone
            }
            resolve(null);
          }
        });
      });
    },
    // Who is actually in this room right now, by playerId.
    presenceIds: () => {
      if (!channel) return [];
      try {
        return Object.keys(channel.presenceState() || {});
      } catch {
        return [];
      }
    },
    // Who is watching the board right now, by playerId —
    // across BOTH rooms that have a screen, because they share
    // this channel. The broadcaster only answers ids on this
    // list (lib/neighborhood/screenshare.js). Like every
    // presence list this is a client-published claim, not
    // proof: it keeps the mesh to people who are actually
    // here, while what makes an offer TRUSTED is the signed
    // grant the viewer verifies server-side.
    screenPresenceIds: () => {
      if (!rtcChannel) return [];
      try {
        return Object.keys(rtcChannel.presenceState() || {});
      } catch {
        return [];
      }
    },
    // Keep the presence payload's resting spot roughly current
    // (used only as a first guess by peers who missed events).
    updateSelf: (x, y) => {
      selfPos = { x, y };
    },
    // Tear down the channel + heartbeat WITHOUT deleting the
    // player row — used when hopping rooms (milestone 6): by
    // the time the old connection is detached, the join API has
    // already moved our row to the new room, so a /leave here
    // would delete the new room's row. Also the right teardown
    // after a kick: the row must stay as the ban record (the
    // server refuses to delete it anyway).
    detach: () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeatTimer);
      closeChannels();
    },
    leave: () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeatTimer);
      closeChannels();
      // keepalive fetch so the row is deleted even on tab close
      api("leave", { playerId: player.playerId }, true).catch(() => {});
    },
  };
}
