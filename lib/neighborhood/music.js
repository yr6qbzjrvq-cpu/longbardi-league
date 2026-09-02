// ============================================================
// HSPNeighborhood — room background music (milestone 18)
// ------------------------------------------------------------
// Everything you hear is synthesized right here with the Web
// Audio API — oscillators, filters, gain envelopes and one
// shared noise buffer for the brushes. No audio files, same
// zero-asset rule as the art.
//
// A room opts in with ONE line in its registry entry:
//
//   music: "casino"        // a track id from TRACKS below
//
// No `music` key = the room is silent, on purpose (Sports Bar,
// Restroom, Hidden Hallway, Mission Control, Casino Strip).
//
// The engine is a singleton (`roomMusic`) the room component
// drives with four calls:
//
//   unlock()        call from any user gesture — browsers only
//                   allow audio after one; idempotent + cheap
//   setTrack(id)    crossfade to a track (or null = fade to
//                   silence); called on room hops + mute toggle
//   setDucked(on)   soften under an overlay (arcade cabinet)
//   stop()          unmount: fade out and suspend
//
// Patterns are scheduled a beat or so ahead on a short timer
// (the standard Web Audio lookahead sequencer), with a pinch
// of Math.random() per bar so the loops evolve instead of
// grating. When nothing is playing the whole AudioContext is
// suspended — zero CPU in silent rooms.
//
// This module never touches window/document at import time, so
// the registry (imported by server code) can name track ids
// without dragging an AudioContext into Node.
// ============================================================

const MASTER_LEVEL = 0.16; // background, not foreground
const FADE_S = 1.0; // room-hop crossfade
const DUCK_LEVEL = 0.45; // under the arcade overlay
const LOOKAHEAD_S = 0.8; // schedule this far ahead
const TICK_MS = 200; // scheduler heartbeat

// midi note number -> Hz
function hz(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// ---- tiny instrument kit -----------------------------------
// Every voice is osc (or noise) -> [lowpass] -> gain envelope
// -> the track's fade bus. All levels are pre-mixed to sit
// far below clipping even when everything sounds at once.

function tone(ctx, dest, o) {
  const t0 = o.t0;
  const dur = o.dur;
  const osc = ctx.createOscillator();
  osc.type = o.type || "sine";
  osc.frequency.setValueAtTime(o.f, t0);
  if (o.detune) osc.detune.setValueAtTime(o.detune, t0);
  const g = ctx.createGain();
  const a = o.attack === undefined ? 0.012 : o.attack;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(o.vol, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let head = osc;
  if (o.filterF) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(o.filterF, t0);
    osc.connect(lp);
    head = lp;
  }
  head.connect(g);
  g.connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// soft two-partial "electric piano / vibraphone" hit
function key(ctx, dest, o) {
  tone(ctx, dest, { ...o, type: "sine" });
  tone(ctx, dest, {
    ...o,
    f: o.f * 2,
    vol: o.vol * 0.22,
    dur: o.dur * 0.6,
    type: "sine",
  });
}

// brushed noise (hats / shakers) from the shared buffer
function brush(ctx, noiseBuf, dest, o) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(o.freq || 6200, o.t0);
  bp.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, o.t0);
  g.gain.linearRampToValueAtTime(o.vol, o.t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, o.t0 + o.dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(o.t0);
  src.stop(o.t0 + o.dur + 0.02);
}

// ---- the four tracks ---------------------------------------
// Each track = tempo + a bar() that schedules one bar of
// events starting at t0. The scheduler calls bar() forever,
// handing it the bar index for progression math.

const TRACKS = {
  // Casino floor — a light jazzy shuffle: brushed ride
  // pattern, walking bass on chord tones, soft EP comping
  // on the offbeats. Fmaj7 / Dm7 / Gm7 / C7, swung.
  casino: {
    bpm: 108,
    beats: 4,
    bar(ctx, noiseBuf, dest, t0, bar, spb) {
      const swing = spb * 0.62; // where the "and" lands
      const chords = [
        { bass: [41, 45, 48, 43], keys: [57, 60, 64, 69] }, // Fmaj7
        { bass: [38, 41, 45, 43], keys: [57, 62, 65, 69] }, // Dm7
        { bass: [43, 46, 50, 45], keys: [58, 62, 65, 67] }, // Gm7
        { bass: [36, 40, 43, 46], keys: [58, 60, 64, 67] }, // C7
      ];
      const ch = chords[bar % 4];
      for (let b = 0; b < 4; b++) {
        const bt = t0 + b * spb;
        // walking bass: chord tone per beat, odd beats wander
        const note = b % 2 === 0 ? ch.bass[b] : pick(ch.bass);
        tone(ctx, dest, {
          f: hz(note + 12),
          t0: bt,
          dur: spb * 0.95,
          type: "triangle",
          vol: 0.5,
          filterF: 420,
          attack: 0.008,
        });
        // brushed ride: beat + swung offbeat
        brush(ctx, noiseBuf, dest, { t0: bt, dur: 0.09, vol: 0.05 });
        brush(ctx, noiseBuf, dest, {
          t0: bt + swing,
          dur: 0.055,
          vol: 0.028,
        });
      }
      // EP comps on 2 and 4 (sometimes anticipated)
      for (const b of [1, 3]) {
        const early = Math.random() < 0.3 ? -spb * 0.38 : 0;
        const ct = t0 + b * spb + early;
        for (const m of ch.keys) {
          key(ctx, dest, {
            f: hz(m),
            t0: ct,
            dur: spb * 1.4,
            vol: 0.075,
            filterF: 1800,
            attack: 0.02,
          });
        }
      }
    },
  },

  // Grocery store — mellow elevator tones: soft pad root,
  // patient vibraphone arpeggio up and back. C / Am / F / G.
  grocery: {
    bpm: 84,
    beats: 4,
    bar(ctx, noiseBuf, dest, t0, bar, spb) {
      const chords = [
        [60, 64, 67, 72], // C
        [57, 60, 64, 69], // Am
        [53, 57, 60, 65], // F
        [55, 59, 62, 67], // G
      ];
      const ch = chords[bar % 4];
      // warm pad: two slightly detuned triangles a bar long
      for (const d of [-4, 4]) {
        tone(ctx, dest, {
          f: hz(ch[0] - 12),
          t0,
          dur: spb * 4,
          type: "triangle",
          vol: 0.11,
          filterF: 700,
          attack: 0.5,
          detune: d,
        });
      }
      // vibraphone eighths: up the chord and back down
      const order = [0, 1, 2, 3, 2, 1, 0, 1];
      for (let i = 0; i < 8; i++) {
        if (Math.random() < 0.12) continue; // breathe
        key(ctx, dest, {
          f: hz(ch[order[i]]),
          t0: t0 + i * spb * 0.5,
          dur: spb * 1.1,
          vol: 0.085,
          filterF: 2400,
          attack: 0.015,
        });
      }
    },
  },

  // Fast food — upbeat, cheery, jingle-ish: bouncy root/fifth
  // bass eighths, offbeat hat tick, plucky pentatonic riff
  // that re-rolls its last half every couple of bars.
  fastfood: {
    bpm: 132,
    beats: 4,
    bar(ctx, noiseBuf, dest, t0, bar, spb) {
      const roots = [48, 53, 55, 48]; // C F G C
      const root = roots[bar % 4];
      for (let i = 0; i < 8; i++) {
        const bt = t0 + i * spb * 0.5;
        // bass bounce: root, fifth, root, fifth...
        tone(ctx, dest, {
          f: hz(i % 2 === 0 ? root : root + 7),
          t0: bt,
          dur: spb * 0.42,
          type: "triangle",
          vol: 0.4,
          filterF: 500,
          attack: 0.006,
        });
        // hat tick on the offbeats
        if (i % 2 === 1) {
          brush(ctx, noiseBuf, dest, {
            t0: bt,
            dur: 0.04,
            vol: 0.03,
            freq: 7600,
          });
        }
      }
      // cheery riff: pentatonic steps around the root, plucky
      const penta = [0, 2, 4, 7, 9, 12];
      const steps = [0, 2, 4, 2, pick([4, 5]), pick([2, 3]), pick([0, 1]), 0];
      for (let i = 0; i < 8; i++) {
        if (bar % 2 === 1 && i >= 4 && Math.random() < 0.35) continue;
        tone(ctx, dest, {
          f: hz(root + 24 + penta[steps[i] % 6]),
          t0: t0 + i * spb * 0.5,
          dur: spb * 0.5,
          type: "square",
          vol: 0.052,
          filterF: 1500,
          attack: 0.004,
        });
      }
    },
  },

  // Town square — gentle open-air ambience: slow strummy pad
  // chords and a sparse music-box melody that wanders the D
  // major pentatonic. Dsus2 / Bm7 / G / A.
  town: {
    bpm: 66,
    beats: 4,
    bar(ctx, noiseBuf, dest, t0, bar, spb) {
      const chords = [
        [50, 57, 62, 64], // Dsus2-ish
        [47, 54, 59, 62], // Bm
        [43, 50, 59, 62], // G
        [45, 52, 61, 64], // A
      ];
      const ch = chords[bar % 4];
      // pad: chord tones staggered like a slow strum
      ch.forEach((m, i) => {
        tone(ctx, dest, {
          f: hz(m),
          t0: t0 + i * 0.09,
          dur: spb * 4,
          type: "triangle",
          vol: 0.06,
          filterF: 900,
          attack: 0.6,
          detune: i % 2 === 0 ? -3 : 3,
        });
      });
      // music box: 1–3 soft high notes, never in a hurry
      const penta = [62, 64, 66, 69, 71, 74];
      const nNotes = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < nNotes; i++) {
        key(ctx, dest, {
          f: hz(pick(penta) + 12),
          t0: t0 + pick([0, 1, 1.5, 2, 3]) * spb,
          dur: spb * 2,
          vol: 0.05,
          filterF: 3200,
          attack: 0.01,
        });
      }
    },
  },
};

// ---- the engine --------------------------------------------

class RoomMusic {
  constructor() {
    this.ctx = null; // AudioContext, created on first unlock()
    this.master = null; // master level x duck
    this.noiseBuf = null; // shared brush noise
    this.trackId = null; // what the room wants
    this.player = null; // { id, gain, timer, stopAt }
    this.unlocked = false;
  }

  // Call from ANY user gesture (walk tap, button press).
  // First call builds the context; later calls just resume a
  // suspended one. Safe to spam.
  unlock() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return; // no Web Audio — the world is just quiet
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_LEVEL;
      this.duck = this.ctx.createGain();
      this.duck.gain.value = 1;
      this.master.connect(this.duck);
      this.duck.connect(this.ctx.destination);
      // one second of white noise, looped for every brush hit
      const len = Math.floor(this.ctx.sampleRate);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // hidden tab = silence (and no scheduler piling up);
      // visible again = pick the room track back up
      document.addEventListener("visibilitychange", () => this._sync());
    }
    this.unlocked = true;
    this._sync();
  }

  // The room component calls this with the current room's
  // `music` id (or null for silent rooms / muted player).
  setTrack(id) {
    this.trackId = id && TRACKS[id] ? id : null;
    this._sync();
  }

  // Soften (don't stop) under an overlay — the arcade.
  setDucked(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(on ? DUCK_LEVEL : 1, t, 0.15);
  }

  // Unmount: fade to nothing and power down.
  stop() {
    this.trackId = null;
    this._sync();
  }

  _sync() {
    if (!this.ctx || !this.unlocked) return;
    const hidden = typeof document !== "undefined" && document.hidden;
    const want = hidden ? null : this.trackId;
    if (this.player && this.player.id !== want) this._fadeOutPlayer();
    if (want && !this.player) this._startPlayer(want);
    if (!this.player && this.ctx.state === "running") {
      // nothing sounding or fading — full stop, zero CPU
      this.ctx.suspend().catch(() => {});
    } else if (this.player && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  _startPlayer(id) {
    const trk = TRACKS[id];
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.connect(this.master);
    const spb = 60 / trk.bpm;
    const barLen = spb * trk.beats;
    const player = {
      id,
      gain,
      timer: 0,
      nextT: 0,
      bar: 0,
      dead: false,
    };
    const tick = () => {
      if (player.dead) return;
      if (player.nextT === 0) {
        // first tick after (re)start/resume: fade in from here
        player.nextT = ctx.currentTime + 0.06;
        const t = ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(1, t + FADE_S);
      }
      while (player.nextT < ctx.currentTime + LOOKAHEAD_S) {
        trk.bar(ctx, this.noiseBuf, gain, player.nextT, player.bar, spb);
        player.bar += 1;
        player.nextT += barLen;
      }
    };
    player.timer = setInterval(tick, TICK_MS);
    this.player = player;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    tick();
  }

  _fadeOutPlayer() {
    const player = this.player;
    if (!player) return;
    this.player = null;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    player.gain.gain.cancelScheduledValues(t);
    player.gain.gain.setValueAtTime(player.gain.gain.value, t);
    player.gain.gain.linearRampToValueAtTime(0.0001, t + FADE_S);
    // let scheduled notes ring under the fade, then tear down
    setTimeout(() => {
      player.dead = true;
      clearInterval(player.timer);
      try {
        player.gain.disconnect();
      } catch {
        /* already gone */
      }
      this._sync(); // suspend if nothing else started meanwhile
    }, (FADE_S + 0.2) * 1000);
  }
}

// One engine for the whole app — module-level, but inert (no
// AudioContext, no listeners) until the first unlock().
export const roomMusic = new RoomMusic();
