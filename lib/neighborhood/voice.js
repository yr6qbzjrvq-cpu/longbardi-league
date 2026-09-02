// ============================================================
// HSPNeighborhood — proximity voice chat (milestone 19)
// ------------------------------------------------------------
// Opt-in, peer-to-peer voice for whoever is in the room with
// you, at a volume that follows the map: full voice inside
// ~120 world px, fading to silence by ~450, updated every few
// frames from the same deterministic positions everything else
// uses. No audio ever touches a server — every stream is a
// WebRTC link straight between two browsers, exactly like the
// big-board feed, and nothing is recorded anywhere.
//
// SIGNALING rides the per-room rtc topic
// (neighborhood-rtc:<roomId> — lib/neighborhood/topics.js).
// That topic prefix is already client-writable under the RLS
// policies from milestone 10, and the scoped-token policy has
// allowed `neighborhood-rtc:<nb_room>` since before milestone
// 12 moved the SCREEN handshake onto the shared big-board
// channel — so voice needs no SQL change, and the two meshes
// (screen on neighborhood-rtc:big-board, voice on
// neighborhood-rtc:<room>) can never hear each other's events.
// A player in the Sports Bar can watch the feed and talk at
// the same time over two separate channels.
//
//   voice-join    newcomer → room     { from, nonce, session }
//   voice-ack     member → newcomer   { from, to, nonce, count, session }
//   voice-full    member → newcomer   { from, to, count }
//   voice-offer   newcomer → member   { from, to, sdp, grant, nonce, session }
//   voice-answer  member → newcomer   { from, to, sdp, grant }
//   voice-ice     either direction    { from, to, candidate }
//   voice-leave   anyone → room       { from }
//
// GLARE is avoided by convention, not negotiation: the LATER
// joiner is always the offerer. Existing members answer a
// voice-join with voice-ack and then wait to be offered.
//
// TRUST (the screen-share story, for everyone). The channel is
// client-writable, so both directions of every handshake carry
// a GRANT minted by the gated /api/neighborhood/voice route —
// which refuses anyone not joined, not in this room, banned,
// or MUTED — bound to a nonce the receiving peer invented for
// its own session (lib/neighborhood/voiceGrant.js). An offer
// with no valid grant never becomes a peer connection; an
// answer with no valid grant is dropped before its SDP is
// read. That is how the commissioner's one mute button covers
// chat and voice alike: the muted player can neither offer nor
// answer, and the admin route broadcasts `voice_mute` on the
// server-only gameplay topic so live peers drop them at once.
//
// MESH CAP. One RTCPeerConnection per pair means n·(n-1)/2
// links and n-1 uplinks apiece — fine for a league table, not
// for a crowd. At VOICE_MAX (8) talkers, members refuse the
// next voice-join with a polite voice-full instead of letting
// every link degrade at once. If league nights ever outgrow
// that, the upgrade is an SFU, not a bigger cap.
//
// AUDIO. The mic is captured with echoCancellation, noise
// suppression and auto gain ON (this is a voice call — the
// exact opposite of the screen share's program-audio tuning).
// Each remote stream runs source → analyser → gain →
// destination in ONE AudioContext owned by this module —
// deliberately NOT the music engine's context, whose
// suspend/resume lifecycle (lib/neighborhood/music.js) must
// keep working untouched in silent rooms. The analyser sits
// BEFORE the gain, so the little speaking indicator over an
// avatar works even when they are across the room and faded
// out. iOS Safari quirk: WebAudio will not pull samples from a
// remote MediaStream unless a media element is also consuming
// it, so each peer gets a muted, playsinline <audio> whose
// only job is to keep the samples flowing; the audible path is
// the gain node. Everything here is inert until start() — no
// mic, no context, no channel, no CPU while voice is off.
// ============================================================

import { fetchIceServers } from "@/lib/neighborhood/screenshare";

export const VOICE_EVENTS = {
  join: "voice-join",
  ack: "voice-ack",
  full: "voice-full",
  offer: "voice-offer",
  answer: "voice-answer",
  ice: "voice-ice",
  leave: "voice-leave",
};

// Talkers per room before later joiners are politely refused.
export const VOICE_MAX = 8;

// The proximity curve: full volume inside FULL_DIST world px,
// silent from SILENT_DIST out. Smoothstepped between, so the
// fade has no audible corners. Rooms are 700–1120 px wide, so
// "same corner" is loud, "across the room" is a murmur and
// "other end of the square" is nothing.
export const VOICE_FULL_DIST = 120;
export const VOICE_SILENT_DIST = 450;

// Must match VOICE_NONCE_RE in lib/neighborhood/voiceGrant.js.
export const VOICE_NONCE_RE = /^[A-Za-z0-9_-]{8,64}$/;

// Pure and exported so the curve is testable and the README
// numbers can never drift from the code.
export function voiceGainForDistance(dist) {
  if (!Number.isFinite(dist)) return 0;
  if (dist <= VOICE_FULL_DIST) return 1;
  if (dist >= VOICE_SILENT_DIST) return 0;
  const t = (VOICE_SILENT_DIST - dist) / (VOICE_SILENT_DIST - VOICE_FULL_DIST);
  return t * t * (3 - 2 * t);
}

// Voice needs both halves: a peer connection AND a microphone.
export function voiceSupported() {
  return (
    typeof window !== "undefined" &&
    typeof window.RTCPeerConnection === "function" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

// Voice-call tuning — the OPPOSITE of displayConstraints() in
// screenshare.js, which turns all three off for program audio.
export function micConstraints() {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  };
}

// ---- module-level media ------------------------------------
// The mic stream and the AudioContext are cached at module
// level so a door hop (mesh torn down, new mesh in the next
// room) neither re-prompts for the mic nor rebuilds the audio
// graph's clock. Both are released for real when voice is
// turned OFF, so an idle page holds no mic and burns no audio
// CPU (the battery half of the feature).

let micStream = null;
let voiceCtx = null;

async function acquireMic() {
  if (
    micStream &&
    micStream.getAudioTracks().some((t) => t.readyState === "live")
  ) {
    return micStream;
  }
  micStream = await navigator.mediaDevices.getUserMedia(micConstraints());
  return micStream;
}

export function releaseVoiceMedia() {
  if (micStream) {
    for (const t of micStream.getTracks()) {
      try {
        t.stop();
      } catch {
        // already stopped
      }
    }
    micStream = null;
  }
  if (voiceCtx && voiceCtx.state !== "closed") {
    voiceCtx.close().catch(() => {});
  }
  voiceCtx = null;
}

function ensureCtx() {
  if (!voiceCtx || voiceCtx.state === "closed") {
    const AC = window.AudioContext || window.webkitAudioContext;
    voiceCtx = new AC();
  }
  if (voiceCtx.state === "suspended") voiceCtx.resume().catch(() => {});
  return voiceCtx;
}

// Call from any user gesture while voice is on. iOS suspends
// an AudioContext on interruptions (calls, Siri, tab swaps)
// and only a gesture-driven resume brings it back — the same
// path the music engine walks with unlock().
export function resumeVoiceAudio() {
  if (voiceCtx && voiceCtx.state === "suspended") {
    voiceCtx.resume().catch(() => {});
  }
}

function makeNonce() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return [...bytes]
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

// Voice activity detection: a plain level threshold with a
// short hold, read off each analyser ~8 times a second.
const VAD_TICK_MS = 120;
const VAD_RMS_ON = 0.025;
const VAD_HOLD_MS = 350;

// ---- the mesh ----------------------------------------------
// One per room visit with voice on. `conn` is the object
// joinRoom() returns (lib/neighborhood/realtime.js) — the mesh
// uses conn.openVoice() for its channel and nothing else.

export function createVoiceMesh({
  conn,
  selfId,
  roomId,
  onPeers, // ({ count, connected }) — participants incl. self
  onSpeaking, // (Set of playerIds, incl. our own while transmitting)
  onFull, // (count) — the room's mesh is at VOICE_MAX
  onEnded, // (code) — server said no mid-session ("muted", "kicked")
}) {
  const peers = new Map(); // playerId → entry
  const remoteNonces = new Map(); // playerId → their nonce
  const grantCache = new Map(); // peerNonce → our grant for them
  const verifiedGrants = new Map(); // grant string → playerId
  const session = `${selfId}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const nonce = makeNonce();
  let channel = null;
  let live = false;
  let transmit = false;
  let selfAnalyser = null;
  let selfSource = null;
  let selfSpeakUntil = 0;
  let vadTimer = null;
  let speakingSet = new Set();
  const vadBuf = new Uint8Array(512);

  function send(event, payload) {
    if (channel) channel.send(event, payload);
  }

  function participants() {
    return peers.size + 1;
  }

  function report() {
    if (!onPeers) return;
    let connected = 0;
    for (const e of peers.values()) {
      if (e.pc.connectionState === "connected") connected += 1;
    }
    onPeers({ count: participants(), connected });
  }

  function applyTransmit() {
    if (!micStream) return;
    for (const t of micStream.getAudioTracks()) t.enabled = transmit;
  }

  // Open mic sets this true; push-to-talk flips it with the
  // key/button. track.enabled=false replaces the outbound
  // samples with silence at the source — nothing reaches the
  // wire, and our own VAD goes quiet with it.
  function setTransmit(v) {
    transmit = !!v;
    applyTransmit();
  }

  async function myGrantFor(peerNonce) {
    const cached = grantCache.get(peerNonce);
    if (cached) return cached;
    const res = await fetch("/api/neighborhood/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: selfId, roomId, nonce: peerNonce }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.grant) {
      const err = new Error((data && data.error) || "Voice grant refused.");
      err.code = (data && data.code) || `http_${res.status}`;
      throw err;
    }
    if (grantCache.size > 64) grantCache.clear();
    grantCache.set(peerNonce, data.grant);
    return data.grant;
  }

  // The server said WE may not speak (muted mid-session, ban,
  // pruned row). Anything transient is just a peer that does
  // not connect this time.
  function grantRefused(code) {
    if (code === "muted" || code === "kicked" || code === "not_joined") {
      const cb = onEnded;
      stop();
      if (cb) cb(code);
      return true;
    }
    return false;
  }

  async function trustPeer(grant, from) {
    if (!grant || !from) return false;
    if (verifiedGrants.get(grant) === from) return true;
    try {
      const res = await fetch("/api/neighborhood/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", grant, nonce, from, roomId }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data || !data.ok || data.playerId !== from) return false;
      if (verifiedGrants.size > 32) verifiedGrants.clear();
      verifiedGrants.set(grant, from);
      return true;
    } catch {
      return false;
    }
  }

  function dropPeer(id) {
    const e = peers.get(id);
    if (!e) return;
    try {
      e.pc.close();
    } catch {
      // already closed
    }
    for (const node of [e.source, e.analyser, e.gain]) {
      if (node) {
        try {
          node.disconnect();
        } catch {
          // already disconnected
        }
      }
    }
    if (e.el) {
      try {
        e.el.srcObject = null;
      } catch {
        // fine
      }
    }
    peers.delete(id);
    if (speakingSet.has(id)) {
      speakingSet = new Set(speakingSet);
      speakingSet.delete(id);
      if (onSpeaking) onSpeaking(speakingSet);
    }
    report();
  }

  function attachRemote(entry, stream) {
    // iOS/Chrome quirk: WebAudio only pulls from a remote
    // stream that a media element is also consuming. This one
    // is muted and invisible — the audible path is the gain.
    try {
      const el = new Audio();
      el.muted = true;
      el.autoplay = true;
      el.playsInline = true;
      if (el.setAttribute) el.setAttribute("playsinline", "");
      el.srcObject = stream;
      const played = el.play();
      if (played && played.catch) played.catch(() => {});
      entry.el = el;
    } catch {
      // the WebAudio graph may still manage alone
    }
    try {
      const ctx = ensureCtx();
      entry.source = ctx.createMediaStreamSource(stream);
      entry.analyser = ctx.createAnalyser();
      entry.analyser.fftSize = 512;
      entry.gain = ctx.createGain();
      entry.gain.gain.value = voiceGainForDistance(entry.dist);
      entry.appliedGain = entry.gain.gain.value;
      entry.source.connect(entry.analyser);
      entry.analyser.connect(entry.gain);
      entry.gain.connect(ctx.destination);
    } catch {
      // no graph, no sound — the connection state UI still works
    }
    report();
  }

  async function buildPc(id, remoteSession) {
    const iceServers = await fetchIceServers({ playerId: selfId, roomId });
    const pc = new RTCPeerConnection({ iceServers });
    const entry = {
      pc,
      pending: [],
      session: remoteSession || null,
      dist: Infinity,
      appliedGain: 0,
      speakUntil: 0,
      gain: null,
      source: null,
      analyser: null,
      el: null,
    };
    peers.set(id, entry);
    if (micStream) {
      for (const track of micStream.getAudioTracks()) {
        pc.addTrack(track, micStream);
      }
    }
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        send(VOICE_EVENTS.ice, {
          from: selfId,
          to: id,
          candidate: ev.candidate.toJSON(),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "closed"
      ) {
        if (peers.get(id) && peers.get(id).pc === pc) dropPeer(id);
      } else {
        report();
      }
    };
    pc.ontrack = (ev) => {
      const stream =
        (ev.streams && ev.streams[0]) || new MediaStream([ev.track]);
      const current = peers.get(id);
      if (current === entry && !entry.source) attachRemote(entry, stream);
    };
    return entry;
  }

  // We are the newcomer: offer to a member who acked us.
  async function makeOffer(id, theirNonce, theirSession) {
    if (!live || id === selfId) return;
    const existing = peers.get(id);
    if (existing) {
      const stale =
        existing.pc.connectionState === "failed" ||
        existing.pc.connectionState === "closed";
      if (!stale && (!theirSession || existing.session === theirSession)) {
        return; // the link in flight is fine
      }
      dropPeer(id);
    }
    let grant;
    try {
      grant = await myGrantFor(theirNonce);
    } catch (err) {
      grantRefused(err && err.code);
      return;
    }
    if (!live || peers.has(id)) return;
    const entry = await buildPc(id, theirSession);
    if (!live || peers.get(id) !== entry) return;
    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    send(VOICE_EVENTS.offer, {
      from: selfId,
      to: id,
      sdp: entry.pc.localDescription,
      grant,
      nonce,
      session,
    });
  }

  async function handleSignal(event, payload) {
    if (!live || !payload || payload.from === selfId) return;
    try {
      if (event === VOICE_EVENTS.join) {
        const from = String(payload.from || "");
        if (!from || !VOICE_NONCE_RE.test(String(payload.nonce || ""))) return;
        const existing = peers.get(from);
        if (existing && payload.session && existing.session !== payload.session) {
          dropPeer(from); // a reload — the old link is dead weight
        }
        remoteNonces.set(from, String(payload.nonce));
        if (!peers.has(from) && participants() >= VOICE_MAX) {
          send(VOICE_EVENTS.full, {
            from: selfId,
            to: from,
            count: participants(),
          });
          return;
        }
        send(VOICE_EVENTS.ack, {
          from: selfId,
          to: from,
          nonce,
          count: participants(),
          session,
        });
        return;
      }

      if (payload.to !== selfId) return;

      if (event === VOICE_EVENTS.ack) {
        if (!VOICE_NONCE_RE.test(String(payload.nonce || ""))) return;
        remoteNonces.set(String(payload.from), String(payload.nonce));
        if (participants() >= VOICE_MAX && !peers.has(payload.from)) return;
        await makeOffer(
          String(payload.from),
          String(payload.nonce),
          payload.session
        );
        return;
      }

      if (event === VOICE_EVENTS.full) {
        const cb = onFull;
        stop();
        if (cb) cb(Number(payload.count) || VOICE_MAX);
        return;
      }

      if (event === VOICE_EVENTS.offer && payload.sdp) {
        // THE trust boundary, both directions of it. No valid
        // grant bound to OUR nonce → we never touch the SDP.
        if (!VOICE_NONCE_RE.test(String(payload.nonce || ""))) return;
        const trusted = await trustPeer(payload.grant, payload.from);
        if (!trusted || !live) return;
        // Our answer must prove US to THEM, bound to the nonce
        // they sent with the offer. If the server refuses (we
        // just got muted), there is no handshake to finish.
        let grant;
        try {
          grant = await myGrantFor(String(payload.nonce));
        } catch (err) {
          grantRefused(err && err.code);
          return;
        }
        if (!live) return;
        if (peers.has(payload.from)) dropPeer(payload.from);
        const entry = await buildPc(payload.from, payload.session);
        if (!live || peers.get(payload.from) !== entry) return;
        await entry.pc.setRemoteDescription(payload.sdp);
        for (const c of entry.pending.splice(0)) {
          try {
            await entry.pc.addIceCandidate(c);
          } catch {
            // a stale candidate is not fatal
          }
        }
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        send(VOICE_EVENTS.answer, {
          from: selfId,
          to: payload.from,
          sdp: entry.pc.localDescription,
          grant,
        });
        return;
      }

      if (event === VOICE_EVENTS.answer && payload.sdp) {
        const entry = peers.get(payload.from);
        if (!entry || entry.pc.remoteDescription) return;
        // The answerer proves itself too — this is the half
        // that keeps a muted player from ANSWERING their way
        // into everyone's ears.
        const trusted = await trustPeer(payload.grant, payload.from);
        if (!trusted || !live) return;
        const current = peers.get(payload.from);
        if (current !== entry) return;
        await entry.pc.setRemoteDescription(payload.sdp);
        for (const c of entry.pending.splice(0)) {
          try {
            await entry.pc.addIceCandidate(c);
          } catch {
            // ignore
          }
        }
        return;
      }

      if (event === VOICE_EVENTS.ice && payload.candidate) {
        const entry = peers.get(payload.from);
        if (!entry) return;
        if (!entry.pc.remoteDescription) {
          entry.pending.push(payload.candidate);
        } else {
          try {
            await entry.pc.addIceCandidate(payload.candidate);
          } catch {
            // ignore
          }
        }
        return;
      }

      if (event === VOICE_EVENTS.leave) {
        remoteNonces.delete(payload.from);
        dropPeer(payload.from);
      }
    } catch {
      // a malformed signal must never break the room
    }
  }

  function levelOf(analyser) {
    try {
      analyser.getByteTimeDomainData(vadBuf);
    } catch {
      return 0;
    }
    let sum = 0;
    for (let i = 0; i < vadBuf.length; i += 1) {
      const v = (vadBuf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / vadBuf.length);
  }

  function vadTick() {
    const now = Date.now();
    const next = new Set();
    if (selfAnalyser && transmit && levelOf(selfAnalyser) > VAD_RMS_ON) {
      selfSpeakUntil = now + VAD_HOLD_MS;
    }
    if (selfSpeakUntil > now) next.add(selfId);
    for (const [id, e] of peers) {
      if (e.analyser && levelOf(e.analyser) > VAD_RMS_ON) {
        e.speakUntil = now + VAD_HOLD_MS;
      }
      if (e.speakUntil > now) next.add(id);
    }
    let changed = next.size !== speakingSet.size;
    if (!changed) {
      for (const id of next) {
        if (!speakingSet.has(id)) {
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      speakingSet = next;
      if (onSpeaking) onSpeaking(next);
    }
  }

  // The engine calls this every few frames with a distance
  // lookup; each peer's gain glides to the new value so
  // walking never zips or clicks.
  function updateDistances(distFor) {
    if (!live) return;
    const ctx = voiceCtx;
    for (const [id, e] of peers) {
      const d = distFor(id);
      e.dist = Number.isFinite(d) ? d : Infinity;
      if (e.gain && ctx) {
        const g = voiceGainForDistance(e.dist);
        e.appliedGain = g;
        try {
          e.gain.gain.setTargetAtTime(g, ctx.currentTime, 0.08);
        } catch {
          e.gain.gain.value = g;
        }
      }
    }
  }

  async function start() {
    if (live) return;
    // The mic prompt lands on the user's own tap — the tap
    // that turned voice on is the gesture the browser wants.
    const mic = await acquireMic(); // throws NotAllowedError on deny
    const ctx = ensureCtx();
    applyTransmit();
    try {
      selfSource = ctx.createMediaStreamSource(mic);
      selfAnalyser = ctx.createAnalyser();
      selfAnalyser.fftSize = 512;
      selfSource.connect(selfAnalyser); // analysis only — never to output
    } catch {
      selfAnalyser = null;
    }
    channel = await conn.openVoice(handleSignal);
    if (!channel) {
      const err = new Error("Voice needs the live connection.");
      err.code = "offline";
      throw err;
    }
    live = true;
    send(VOICE_EVENTS.join, { from: selfId, nonce, session });
    vadTimer = setInterval(vadTick, VAD_TICK_MS);
    report();
    if (typeof window !== "undefined") {
      window.__hspnVoice = {
        participants,
        speaking: () => new Set(speakingSet),
        gains: () => {
          const out = {};
          for (const [id, e] of peers) {
            out[id] = {
              dist: e.dist,
              gain: e.appliedGain,
              state: e.pc.connectionState,
            };
          }
          return out;
        },
      };
    }
  }

  // keepMedia keeps the mic + AudioContext warm for the mesh
  // in the next room (a door hop); a real OFF releases both.
  function stop(opts) {
    if (!live && !channel) return;
    live = false;
    if (vadTimer) {
      clearInterval(vadTimer);
      vadTimer = null;
    }
    send(VOICE_EVENTS.leave, { from: selfId });
    for (const id of [...peers.keys()]) dropPeer(id);
    if (channel) {
      channel.close();
      channel = null;
    }
    for (const node of [selfSource, selfAnalyser]) {
      if (node) {
        try {
          node.disconnect();
        } catch {
          // fine
        }
      }
    }
    selfSource = null;
    selfAnalyser = null;
    speakingSet = new Set();
    if (onSpeaking) onSpeaking(speakingSet);
    if (typeof window !== "undefined" && window.__hspnVoice) {
      delete window.__hspnVoice;
    }
    if (!opts || !opts.keepMedia) releaseVoiceMedia();
  }

  return {
    start,
    stop,
    setTransmit,
    updateDistances,
    dropPeer,
    handleSignal,
    participants,
    isLive: () => live,
  };
}
