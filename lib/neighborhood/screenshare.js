// ============================================================
// HSPNeighborhood — screen share pipeline (milestone 9)
// ------------------------------------------------------------
// Austin's desktop on the Mission Control big board, over
// WebRTC, peer to peer. No media ever touches Vercel: the only
// server involvement is the admin gate that authorizes a
// broadcast session (app/api/neighborhood/broadcast).
//
// SIGNALING rides a shared Supabase Realtime channel
// (lib/neighborhood/realtime.js, topic
// neighborhood-rtc:<screen channel>) as five broadcast events.
// Milestone 12: every room with a screen — Mission Control's
// big board and the Sports Bar's screen over the counter —
// subscribes to that ONE topic, so a single broadcast serves
// viewers in both rooms from a single mesh. The broadcaster
// still refuses to answer any id that is not in that channel's
// presence list, which is now "everyone watching the board"
// rather than "everyone in this room".
//
//   rtc-live   broadcaster → room   { broadcasterId, live }
//   rtc-hello  viewer → broadcaster { from, to?, session, nonce }
//   rtc-offer  broadcaster → viewer { from, to, sdp, grant }
//   rtc-answer viewer → broadcaster { from, to, sdp }
//   rtc-ice    either direction     { from, to, candidate }
//
// WHO GETS TO PUT A PICTURE ON THE BOARD (milestone 10). The
// signaling channel is writable by everyone in the room, so
// "the offer says it's from Austin" proves nothing. Every
// offer therefore carries a GRANT that only the admin-gated
// /api/neighborhood/broadcast route can mint, and the viewer
// checks it at /api/neighborhood/broadcast/verify before it
// will look at the SDP. The grant is bound to a nonce the
// VIEWER invented for this page load, so a captured grant is
// useless anywhere else and cannot be replayed later. rtc-live
// carries no authority at all — a forged one only makes
// viewers say hello, and a forged "stopped" is ignored unless
// it comes from the broadcaster the viewer actually verified.
//
// The broadcaster is ALWAYS the offerer, so there is no glare
// and no need for perfect-negotiation rollback. One
// RTCPeerConnection per viewer (a mesh) — fine for a league of
// this size; an SFU is the upgrade path if we ever outgrow it.
//
// A viewer's hello is the ONE thing that triggers an offer.
// Viewers say hello when they walk into the room (catching a
// broadcast already in progress) and when they see a fresh
// rtc-live announcement, then retry a few times if no picture
// arrives. Having the broadcaster ALSO offer proactively to
// everyone present looked like useful redundancy, but it
// raced the hello and renegotiated every viewer twice on
// every start — the retry below covers a lost hello without
// that.
//
// TURN (milestone 11 — the cellular fix). Public STUN alone
// only works when the two peers can reach each other directly,
// which a phone on cellular generally cannot: carrier-grade
// NAT is symmetric, so the address STUN learns is useless to
// the broadcaster and the connection sits at "connecting" and
// then fails. So both halves now ask the server for ICE
// servers (/api/neighborhood/ice) right before building a peer
// connection, and get Cloudflare TURN relay credentials back
// when the deployment has them. The answer is cached here for
// the whole page, so a room full of viewers costs one request.
// When TURN is NOT configured — or the route is unreachable,
// or slow — every path falls back to STUN_ONLY, which is
// exactly the config that shipped before, so the wifi path is
// untouched either way. relayAvailable() tells the room engine
// which of the two worlds it is in, so a failure can be
// reported honestly.
// ============================================================

export const RTC_EVENTS = {
  live: "rtc-live",
  hello: "rtc-hello",
  offer: "rtc-offer",
  answer: "rtc-answer",
  ice: "rtc-ice",
};

// What we used before TURN existed, and still the fallback
// everywhere: if anything at all goes wrong fetching relay
// credentials, a peer is built with exactly this.
export const STUN_ONLY = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

// Cached per page load. The server hands out one credential
// set with hours of TTL, so refetching per viewer would be
// waste; we re-ask a minute before it expires.
let iceCache = null; // { servers, goodUntil, relay }
let icePending = null;
const ICE_MARGIN_MS = 60 * 1000; // re-ask before a credential actually dies
const ICE_FALLBACK_MS = 60 * 1000; // don't re-ask a broken route every peer

// Was the last answer an actual relay? The room engine uses
// this to word a failure ("needs a relay" vs "try again").
export function relayAvailable() {
  return !!(iceCache && iceCache.relay);
}

// goodUntil is already margin-adjusted, so the read path is a
// single comparison.
function cacheIce(servers, goodUntil, relay) {
  iceCache = { servers, goodUntil, relay: !!relay };
  return servers;
}

// Ask the server for ICE servers for this player. Never
// throws, never returns nothing: STUN_ONLY is the floor.
export async function fetchIceServers({ playerId, roomId }) {
  const now = Date.now();
  if (iceCache && iceCache.goodUntil > now) return iceCache.servers;
  if (icePending) return icePending;
  icePending = (async () => {
    try {
      const res = await fetch("/api/neighborhood/ice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, roomId }),
      });
      const data = await res.json().catch(() => null);
      const servers =
        data && Array.isArray(data.iceServers) && data.iceServers.length > 0
          ? data.iceServers.filter((s) => s && s.urls)
          : null;
      if (!servers || servers.length === 0) {
        return cacheIce(STUN_ONLY, now + ICE_FALLBACK_MS, false);
      }
      const relay = !!data.relay;
      // A STUN-only answer is a normal, healthy answer (TURN
      // simply isn't configured) — cache it briefly so the
      // room isn't asking again on every handshake.
      const until =
        relay && data.expiresAt
          ? data.expiresAt - ICE_MARGIN_MS
          : now + ICE_FALLBACK_MS;
      return cacheIce(servers, until, relay);
    } catch {
      return cacheIce(STUN_ONLY, now + ICE_FALLBACK_MS, false);
    } finally {
      icePending = null;
    }
  })();
  return icePending;
}

// 720p60 by default; the HD toggle asks for 1080p60. Audio
// processing is OFF across the board — this is program audio,
// not a voice call, and AGC/noise suppression would chew up
// music and crowd noise.
export function displayConstraints(hd) {
  return {
    video: {
      displaySurface: "browser", // nudge the picker toward a TAB
      frameRate: { ideal: 60, max: 60 },
      width: { ideal: hd ? 1920 : 1280 },
      height: { ideal: hd ? 1080 : 720 },
    },
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
      sampleRate: 48000,
    },
    systemAudio: "include",
    surfaceSwitching: "include",
    selfBrowserSurface: "exclude", // don't offer the game tab itself
  };
}

// Must match NONCE_RE in lib/neighborhood/broadcastGrant.js —
// the server refuses to sign anything shaped differently.
export const NONCE_RE = /^[A-Za-z0-9_-]{8,64}$/;

function makeNonce() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 32);
}

const VIDEO_BITRATE = { sd: 4_500_000, hd: 6_000_000 };
const HELLO_RETRY_MS = 4000; // a lost hello costs one beat, not the session
const HELLO_RETRIES = 3;

// Opus defaults to mono at ~32kbps in an SDP offer. Ask for
// real stereo at a music-grade rate. Chrome honours all three
// of these on the fmtp line for the Opus payload type.
function stereoOpus(sdp) {
  if (!sdp) return sdp;
  return sdp.replace(/a=fmtp:(\d+) ([^\r\n]*useinbandfec=1[^\r\n]*)/g, (m, pt, params) => {
    let p = params;
    if (!/stereo=/.test(p)) p += ";stereo=1";
    if (!/sprop-stereo=/.test(p)) p += ";sprop-stereo=1";
    if (!/maxaveragebitrate=/.test(p)) p += ";maxaveragebitrate=192000";
    return `a=fmtp:${pt} ${p}`;
  });
}

// CAN THIS BROWSER *CAPTURE* A SCREEN? getDisplayMedia is a
// desktop-only API — no mobile browser implements it (iOS
// Safari, Chrome and Firefox on Android all leave it
// undefined). So this is the check for the Share My Screen
// button, and ONLY for that.
export function screenShareSupported() {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === "function" &&
    screenViewSupported()
  );
}

// CAN THIS BROWSER *WATCH* A SCREEN SHARE? Receiving is just a
// peer connection and a <video> — every phone can do it. The
// two checks were one function until milestone 10, which is
// why the big board sat on "AWAITING FEED" for every mobile
// viewer: the room gated the VIEWER on the capture API, so a
// phone never built a peer, never said hello, and was never
// offered anything. Keep them separate.
export function screenViewSupported() {
  return typeof window !== "undefined" && typeof window.RTCPeerConnection === "function";
}

// Ask the server whether this browser is allowed to broadcast.
// GET is the cheap "should I even show the button" probe; both
// verbs 404 for anyone without the commissioner cookie.
export async function checkBroadcastAuth() {
  try {
    const res = await fetch("/api/neighborhood/broadcast", { method: "GET" });
    if (!res.ok) return false;
    const data = await res.json();
    return !!(data && data.ok);
  } catch {
    return false;
  }
}

// ---- broadcaster -------------------------------------------
// Owns the capture stream and one connection per viewer.

export function createBroadcaster({ conn, selfId, roomId, onState, onViewers }) {
  const peers = new Map(); // viewerId → { pc, pending, session }
  let stream = null;
  let live = false;
  let hd = false;
  const failures = [];

  // One grant per viewer nonce, minted by the admin-only
  // broadcast route. Cached because a viewer's hello retries
  // reuse the same nonce, and a grant outlives the handshake
  // it was minted for.
  const grants = new Map(); // nonce → grant string
  async function grantFor(nonce) {
    if (!nonce) return null;
    const cached = grants.get(nonce);
    if (cached) return cached;
    try {
      const res = await fetch("/api/neighborhood/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: selfId, roomId, nonce }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.grant) return null;
      if (grants.size > 64) grants.clear(); // a long night of re-entries
      grants.set(nonce, data.grant);
      return data.grant;
    } catch {
      return null;
    }
  }

  function report() {
    if (onViewers) {
      onViewers({
        count: peers.size,
        connected: [...peers.values()].filter(
          (p) => p.pc.connectionState === "connected"
        ).length,
        failures: [...failures],
      });
    }
  }

  // Is this id actually watching a screen right now? Presence
  // on the shared board channel spans both rooms with a
  // screen, so a viewer in the Sports Bar counts exactly like
  // one standing in front of the big board. Falls back to the
  // room roster for a transport that has no board presence.
  function watching(id) {
    if (!id || id === selfId) return false;
    try {
      const ids = conn.screenPresenceIds
        ? conn.screenPresenceIds()
        : conn.presenceIds
          ? conn.presenceIds()
          : [];
      return ids.includes(id);
    } catch {
      return false;
    }
  }

  function dropPeer(id) {
    const entry = peers.get(id);
    if (!entry) return;
    try {
      entry.pc.close();
    } catch {
      // already closed
    }
    peers.delete(id);
    report();
  }

  async function offerTo(viewerId, session, nonce) {
    if (!live || !stream) return;
    // No grant, no offer: a viewer will refuse an unsigned
    // offer anyway, so sending one would only burn a
    // connection. (Only happens if the mint call fails.)
    const grant = await grantFor(nonce);
    if (!grant) {
      failures.push({ viewerId, at: Date.now(), reason: "no_grant" });
      report();
      return;
    }
    if (!live || !stream) return; // the mint round-trip is awaited
    const existing = peers.get(viewerId);
    if (existing) {
      // Same viewer instance saying hello again (its retry
      // crossed with our offer): the link in flight is fine.
      const stale =
        existing.pc.connectionState === "failed" ||
        existing.pc.connectionState === "closed";
      if (!stale && session && existing.session === session) return;
      // Different session = a genuine reload/re-entry, so the
      // old link is dead weight. Replace it.
      dropPeer(viewerId);
    }

    // Relay credentials (or plain STUN when TURN isn't
    // configured). Cached, so only the first viewer of the
    // night pays for the round trip.
    const iceServers = await fetchIceServers({ playerId: selfId, roomId });
    if (!live || !stream) return; // another awaited round trip
    const pc = new RTCPeerConnection({ iceServers });
    const entry = { pc, pending: [], session: session || null };
    peers.set(viewerId, entry);

    for (const track of stream.getTracks()) {
      pc.addTransceiver(track, {
        direction: "sendonly",
        streams: [stream],
        sendEncodings: [
          {
            maxBitrate: hd ? VIDEO_BITRATE.hd : VIDEO_BITRATE.sd,
            maxFramerate: 60,
          },
        ],
      });
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        conn.signal(RTC_EVENTS.ice, {
          from: selfId,
          to: viewerId,
          candidate: ev.candidate.toJSON(),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        // With a relay configured this should be rare; without
        // one it is the cellular case (see the header).
        failures.push({ viewerId, at: Date.now(), relay: relayAvailable() });
        dropPeer(viewerId);
      } else if (pc.connectionState === "closed") {
        peers.delete(viewerId);
      }
      report();
    };

    const offer = await pc.createOffer();
    offer.sdp = stereoOpus(offer.sdp);
    await pc.setLocalDescription(offer);

    // Motion over detail: keep 60fps and let resolution give.
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender) {
      try {
        const params = sender.getParameters();
        params.degradationPreference = "maintain-framerate";
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = hd ? VIDEO_BITRATE.hd : VIDEO_BITRATE.sd;
        params.encodings[0].maxFramerate = 60;
        await sender.setParameters(params);
      } catch {
        // older browsers: the sendEncodings above still apply
      }
    }

    conn.signal(RTC_EVENTS.offer, {
      from: selfId,
      to: viewerId,
      sdp: pc.localDescription,
      grant,
    });
    report();
  }

  async function handleSignal(event, payload) {
    if (!payload || !live) return;

    if (event === RTC_EVENTS.hello) {
      // Only people actually watching a screen get a feed.
      if (payload.to && payload.to !== selfId) return;
      if (!watching(payload.from)) return;
      if (!NONCE_RE.test(String(payload.nonce || ""))) return;
      await offerTo(payload.from, payload.session, payload.nonce);
      return;
    }

    if (payload.to !== selfId) return;
    const entry = peers.get(payload.from);
    if (!entry) return;

    if (event === RTC_EVENTS.answer && payload.sdp) {
      await entry.pc.setRemoteDescription(payload.sdp);
      for (const c of entry.pending.splice(0)) {
        try {
          await entry.pc.addIceCandidate(c);
        } catch {
          // a stale candidate is not fatal
        }
      }
      return;
    }

    if (event === RTC_EVENTS.ice && payload.candidate) {
      if (!entry.pc.remoteDescription) {
        entry.pending.push(payload.candidate);
      } else {
        try {
          await entry.pc.addIceCandidate(payload.candidate);
        } catch {
          // ignore
        }
      }
    }
  }

  async function start(options) {
    if (live) return;
    hd = !!(options && options.hd);

    // The admin gate. Media is P2P, but STARTING a broadcast is
    // commissioner-only and the server says so.
    const res = await fetch("/api/neighborhood/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: selfId, roomId }),
    });
    if (!res.ok) {
      const err = new Error("Not allowed to broadcast.");
      err.code = res.status === 404 ? "not_admin" : `http_${res.status}`;
      throw err;
    }

    // Throws NotAllowedError if the picker is dismissed —
    // that is a normal cancel, not a failure.
    stream = await navigator.mediaDevices.getDisplayMedia(displayConstraints(hd));

    for (const track of stream.getTracks()) {
      if (track.kind === "video") {
        track.contentHint = "motion";
      } else {
        track.contentHint = "music";
      }
      // Chrome's own "Stop sharing" bar ends the track.
      track.addEventListener("ended", () => stop());
    }

    live = true;
    if (onState) onState("live");
    // Warm the ICE cache now, so the first hello doesn't wait
    // on a credential round trip.
    fetchIceServers({ playerId: selfId, roomId });
    // Announce, then wait to be greeted. Everyone in the room
    // hears this and says hello; late arrivals say hello when
    // they walk in.
    conn.signal(RTC_EVENTS.live, { broadcasterId: selfId, live: true });
    report();
  }

  function stop() {
    if (!live && !stream) return;
    live = false;
    if (conn && conn.signal) {
      conn.signal(RTC_EVENTS.live, { broadcasterId: selfId, live: false });
    }
    for (const id of [...peers.keys()]) dropPeer(id);
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // already stopped
        }
      }
      stream = null;
    }
    if (onState) onState("idle");
    report();
  }

  return {
    start,
    stop,
    handleSignal,
    dropViewer: dropPeer,
    isLive: () => live,
    getStream: () => stream,
    failures: () => [...failures],
  };
}

// ---- viewer ------------------------------------------------
// Answers the broadcaster and hands the inbound stream up to
// the room engine, which paints it onto the wall.

export function createViewer({ conn, selfId, roomId, onStream, onState }) {
  let pc = null;
  // Set ONLY after the server has vouched for an offer. Until
  // then we may be talking to anyone with a keyboard.
  let broadcasterId = null;
  // Who last claimed to be live. Untrusted — used purely as
  // the address for our hello.
  let announcedId = null;
  let pending = [];
  let gotStream = false;
  let retryTimer = null;
  let attempts = 0;
  // Identifies THIS viewer instance, so the broadcaster can
  // tell a retry (ignore) from a reload (re-offer).
  const session = `${selfId}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  // Our half of the anti-replay handshake: a fresh random
  // value per viewer instance. The grant that comes back is
  // only valid for this nonce, so nobody can hand us a grant
  // they captured from someone else's session.
  const nonce = makeNonce();
  const verified = new Map(); // grant string → broadcaster id

  // Ask the server whether an offer really came from the
  // commissioner. Cached per grant so a renegotiation during
  // one broadcast costs a single round trip.
  async function trustOffer(grant, from) {
    if (!grant || !from) return false;
    if (verified.get(grant) === from) return true;
    try {
      const res = await fetch("/api/neighborhood/broadcast/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant, nonce, from }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data || !data.ok || data.broadcasterId !== from) return false;
      if (verified.size > 16) verified.clear();
      verified.set(grant, from);
      return true;
    } catch {
      return false;
    }
  }

  function stopRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  // Say hello, and keep saying it until a picture shows up. A
  // hello can be lost (or arrive while the broadcaster is
  // still starting up); three tries covers it without ever
  // spamming the channel.
  function hello(to) {
    stopRetry();
    conn.signal(RTC_EVENTS.hello, {
      from: selfId,
      to: to || undefined,
      session,
      nonce,
    });
    if (attempts >= HELLO_RETRIES) return;
    attempts += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!gotStream) hello(broadcasterId || announcedId);
    }, HELLO_RETRY_MS);
  }

  function reset(nextState) {
    stopRetry();
    attempts = 0;
    gotStream = false;
    if (pc) {
      try {
        pc.close();
      } catch {
        // already closed
      }
      pc = null;
    }
    pending = [];
    broadcasterId = null;
    announcedId = null;
    if (onStream) onStream(null);
    if (onState) onState(nextState || "standby");
  }

  // Walked into the room: if someone is already broadcasting,
  // this is what gets us a picture. Harmless when nobody is.
  function announce() {
    if (!conn || !conn.signal) return;
    // Fetch ICE while the hello is in flight rather than after
    // the offer lands — one less thing between walking in and
    // seeing a picture.
    fetchIceServers({ playerId: selfId, roomId });
    attempts = 0;
    hello(null);
  }

  async function handleSignal(event, payload) {
    if (!payload) return;

    if (event === RTC_EVENTS.live) {
      // An announcement is a nudge, never a credential: all we
      // do with it is address our hello. The offer that comes
      // back is what has to prove itself.
      if (payload.live && payload.broadcasterId !== selfId) {
        announcedId = payload.broadcasterId;
        gotStream = false;
        attempts = 0;
        fetchIceServers({ playerId: selfId, roomId });
        if (onState) onState("connecting");
        hello(announcedId);
      } else if (!payload.live) {
        // Only the broadcaster we actually verified can take
        // the board down; otherwise anyone in the room could
        // kill everyone's feed with one forged event.
        if (broadcasterId && payload.broadcasterId === broadcasterId) {
          reset("standby");
        } else if (!broadcasterId && payload.broadcasterId === announcedId) {
          reset("standby");
        }
      }
      return;
    }

    if (payload.to !== selfId) return;

    if (event === RTC_EVENTS.offer && payload.sdp) {
      // THE trust boundary. No valid grant, no picture — we do
      // not even build a peer connection.
      const trusted = await trustOffer(payload.grant, payload.from);
      if (!trusted) return;
      broadcasterId = payload.from;
      if (pc) {
        try {
          pc.close();
        } catch {
          // already closed
        }
      }
      // Candidates that arrived while we were verifying belong
      // to this handshake — keep them (reset() clears them
      // when the session genuinely ends).
      // Relay credentials if this deployment has them. This is
      // the line that makes a cellular viewer work: without a
      // TURN candidate the phone's symmetric NAT has nothing
      // the broadcaster can reach.
      const iceServers = await fetchIceServers({ playerId: selfId, roomId });
      pc = new RTCPeerConnection({ iceServers });
      if (onState) onState("connecting");

      pc.ontrack = (ev) => {
        if (ev.streams && ev.streams[0] && onStream) {
          gotStream = true;
          stopRetry();
          onStream(ev.streams[0]);
          if (onState) onState("live");
        }
      };
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          conn.signal(RTC_EVENTS.ice, {
            from: selfId,
            to: broadcasterId,
            candidate: ev.candidate.toJSON(),
          });
        }
      };
      pc.onconnectionstatechange = () => {
        if (!pc) return;
        if (pc.connectionState === "failed") {
          // A NAT neither side could get through. With TURN
          // configured this should be rare; without it, this
          // is every cellular viewer.
          reset("failed");
        } else if (pc.connectionState === "disconnected") {
          if (onState) onState("connecting");
        }
      };

      await pc.setRemoteDescription(payload.sdp);
      for (const c of pending.splice(0)) {
        try {
          await pc.addIceCandidate(c);
        } catch {
          // ignore
        }
      }
      const answer = await pc.createAnswer();
      answer.sdp = stereoOpus(answer.sdp);
      await pc.setLocalDescription(answer);
      conn.signal(RTC_EVENTS.answer, {
        from: selfId,
        to: broadcasterId,
        sdp: pc.localDescription,
      });
      return;
    }

    if (event === RTC_EVENTS.ice && payload.candidate) {
      // Candidates are only interesting from the peer we are
      // actually negotiating with. Before the offer lands that
      // is whoever announced; after it, the verified id.
      const expected = broadcasterId || announcedId;
      if (expected && payload.from && payload.from !== expected) return;
      if (!pc || !pc.remoteDescription) {
        pending.push(payload.candidate);
      } else {
        try {
          await pc.addIceCandidate(payload.candidate);
        } catch {
          // ignore
        }
      }
    }
  }

  return {
    announce,
    handleSignal,
    teardown: () => reset("standby"),
    // The engine drops the feed when the broadcaster's avatar
    // leaves the room, without waiting for a timeout.
    broadcaster: () => broadcasterId,
  };
}
