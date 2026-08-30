// ============================================================
// HSPNeighborhood — screen share pipeline (milestone 9)
// ------------------------------------------------------------
// Austin's desktop on the Mission Control big board, over
// WebRTC, peer to peer. No media ever touches Vercel: the only
// server involvement is the admin gate that authorizes a
// broadcast session (app/api/neighborhood/broadcast).
//
// SIGNALING rides the room's EXISTING Supabase Realtime
// channel (lib/neighborhood/realtime.js) as five new broadcast
// events. Because that channel is per-room, signaling is
// automatically scoped to whoever is standing in Mission
// Control — and the broadcaster refuses to answer any id that
// is not in the room's presence list.
//
//   rtc-live   broadcaster → room   { broadcasterId, live }
//   rtc-hello  viewer → broadcaster { from, to?, session }
//   rtc-offer  broadcaster → viewer { from, to, sdp }
//   rtc-answer viewer → broadcaster { from, to, sdp }
//   rtc-ice    either direction     { from, to, candidate }
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
// TURN: none yet (public STUN only). A viewer behind a
// symmetric NAT will sit at "connecting" and then fail —
// onState reports that so it can be surfaced, and adding a
// TURN server is a one-line change to ICE_SERVERS.
// ============================================================

export const RTC_EVENTS = {
  live: "rtc-live",
  hello: "rtc-hello",
  offer: "rtc-offer",
  answer: "rtc-answer",
  ice: "rtc-ice",
};

// Public STUN only for now. Cloudflare TURN goes here (M3).
const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

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

export function screenShareSupported() {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === "function" &&
    typeof window !== "undefined" &&
    typeof window.RTCPeerConnection === "function"
  );
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

  function inRoom(id) {
    if (!id || id === selfId) return false;
    try {
      const ids = conn.presenceIds ? conn.presenceIds() : [];
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

  async function offerTo(viewerId, session) {
    if (!live || !stream) return;
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

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
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
        // No TURN yet — this is the case M3 needs to fix.
        failures.push({ viewerId, at: Date.now() });
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
    });
    report();
  }

  async function handleSignal(event, payload) {
    if (!payload || !live) return;

    if (event === RTC_EVENTS.hello) {
      // Only people actually standing in this room get a feed.
      if (payload.to && payload.to !== selfId) return;
      if (!inRoom(payload.from)) return;
      await offerTo(payload.from, payload.session);
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

export function createViewer({ conn, selfId, onStream, onState }) {
  let pc = null;
  let broadcasterId = null;
  let pending = [];
  let gotStream = false;
  let retryTimer = null;
  let attempts = 0;
  // Identifies THIS viewer instance, so the broadcaster can
  // tell a retry (ignore) from a reload (re-offer).
  const session = `${selfId}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;

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
    conn.signal(RTC_EVENTS.hello, { from: selfId, to: to || undefined, session });
    if (attempts >= HELLO_RETRIES) return;
    attempts += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!gotStream) hello(broadcasterId);
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
    if (onStream) onStream(null);
    if (onState) onState(nextState || "standby");
  }

  // Walked into the room: if someone is already broadcasting,
  // this is what gets us a picture. Harmless when nobody is.
  function announce() {
    if (!conn || !conn.signal) return;
    attempts = 0;
    hello(null);
  }

  async function handleSignal(event, payload) {
    if (!payload) return;

    if (event === RTC_EVENTS.live) {
      if (payload.live && payload.broadcasterId !== selfId) {
        broadcasterId = payload.broadcasterId;
        gotStream = false;
        attempts = 0;
        if (onState) onState("connecting");
        hello(broadcasterId);
      } else if (!payload.live) {
        reset("standby");
      }
      return;
    }

    if (payload.to !== selfId) return;

    if (event === RTC_EVENTS.offer && payload.sdp) {
      broadcasterId = payload.from;
      if (pc) {
        try {
          pc.close();
        } catch {
          // already closed
        }
      }
      pending = [];
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
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
          // Almost certainly a NAT that needs TURN (M3).
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
