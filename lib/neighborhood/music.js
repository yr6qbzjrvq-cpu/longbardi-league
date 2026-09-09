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

// ---- one-shot party sting (milestone 25) -------------------
// The Sports Bar is a SILENT room and stays one: nothing here
// changes what `music:` means. A sting is a one-shot jingle
// triggered by an event (today: the big red button behind the
// bar), it runs on its own bus so the room-track crossfade and
// the mute-persisted `setTrack` lifecycle are untouched, and it
// stops itself when the show does.
const STING_LEVEL = 0.3; // louder than background — it IS the moment
const STING_FADE_S = 0.55;
const STING_DUCK = 0.35; // how far a room track drops underneath one

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

// four-on-the-floor kick: a sine dropping into the floor
function kick(ctx, dest, t0, vol) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(155, t0);
  osc.frequency.exponentialRampToValueAtTime(46, t0 + 0.085);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
  osc.connect(g);
  g.connect(dest);
  osc.start(t0);
  osc.stop(t0 + 0.3);
}

// disco clap: three noise slaps a few ms apart, then a tail
function clap(ctx, noiseBuf, dest, t0, vol) {
  for (const [d, v] of [[0, 0.7], [0.011, 0.85], [0.023, 1]]) {
    brush(ctx, noiseBuf, dest, {
      t0: t0 + d,
      dur: 0.05,
      vol: vol * v,
      freq: 1700,
    });
  }
  brush(ctx, noiseBuf, dest, { t0: t0 + 0.03, dur: 0.16, vol: vol * 0.45, freq: 2100 });
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

// ---- one-shot stings ---------------------------------------
// Same shape as a TRACK (bpm + a bar() that schedules one bar),
// so the scheduler is the one we already had. The difference is
// entirely in the lifecycle: a sting runs for a fixed number of
// milliseconds on its own bus and then tears itself down.

const STINGS = {
  // The big red button. Four-on-the-floor, offbeat open hats,
  // claps on 2 and 4, an octave disco bassline and string stabs
  // on the "and" — Am / F / C / G, 122bpm, gone in ten seconds.
  party: {
    bpm: 122,
    beats: 4,
    bar(ctx, noiseBuf, dest, t0, bar, spb) {
      const roots = [45, 41, 48, 43]; // A  F  C  G
      const stabs = [
        [57, 60, 64], // Am
        [53, 57, 60], // F
        [55, 60, 64], // C/E
        [50, 55, 59], // G
      ];
      const root = roots[bar % 4];
      const ch = stabs[bar % 4];

      for (let b = 0; b < 4; b++) {
        const bt = t0 + b * spb;
        kick(ctx, dest, bt, 0.55);
        // offbeat open hat — the disco tell
        brush(ctx, noiseBuf, dest, {
          t0: bt + spb * 0.5,
          dur: 0.13,
          vol: 0.05,
          freq: 8600,
        });
        // 16th tambourine, quiet, under everything
        for (const q of [0.25, 0.75]) {
          brush(ctx, noiseBuf, dest, {
            t0: bt + spb * q,
            dur: 0.03,
            vol: 0.016,
            freq: 11000,
          });
        }
        if (b === 1 || b === 3) clap(ctx, noiseBuf, dest, bt, 0.12);
      }

      // octave bass, straight eighths
      for (let i = 0; i < 8; i++) {
        tone(ctx, dest, {
          f: hz(i % 2 === 0 ? root : root + 12),
          t0: t0 + i * spb * 0.5,
          dur: spb * 0.4,
          type: "sawtooth",
          vol: 0.16,
          filterF: 420,
          attack: 0.006,
        });
      }

      // string stabs on the "and" of 2 and 4
      for (const b of [1, 3]) {
        const st = t0 + b * spb + spb * 0.5;
        for (const m of ch) {
          tone(ctx, dest, {
            f: hz(m),
            t0: st,
            dur: spb * 0.42,
            type: "sawtooth",
            vol: 0.055,
            filterF: 2400,
            attack: 0.012,
          });
        }
      }

      // every other bar, a little descending glitter run
      if (bar % 2 === 1) {
        const run = [84, 81, 79, 76];
        for (let i = 0; i < run.length; i++) {
          key(ctx, dest, {
            f: hz(run[i]),
            t0: t0 + spb * (2.5 + i * 0.25),
            dur: spb * 0.5,
            vol: 0.05,
            filterF: 4200,
            attack: 0.005,
          });
        }
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
    // one-shot stings (milestone 25) ride their own bus so they
    // are loud enough to be the moment without touching the
    // background level, the crossfade, or the mute state
    this.stingBus = null;
    this.sting = null;
    this.duckOverlay = false; // arcade / racetrack
    this.duckSting = false; // a sting is playing over the track
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
      // Stings bypass master/duck entirely: a one-shot jingle
      // has nothing to do with the background level, and
      // nothing about the room track's lifecycle should be able
      // to move it.
      this.stingBus = this.ctx.createGain();
      this.stingBus.gain.value = STING_LEVEL;
      this.stingBus.connect(this.ctx.destination);
      // one second of white noise, looped for every brush hit
      const len = Math.floor(this.ctx.sampleRate);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // hidden tab = silence (and no scheduler piling up);
      // visible again = pick the room track back up
      // hidden tab = silence. A sting does not wait for you to
      // come back: the visuals it belongs to are wall-clock
      // driven and will be over, so it is killed outright.
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) this.stopSting(0.12);
        this._sync();
      });
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
    this.duckOverlay = !!on;
    this._applyDuck();
  }

  // Two independent reasons to soften the room track (an
  // overlay is open; a sting is playing over it). They multiply
  // instead of fighting, so closing the arcade mid-party does
  // not shove the track back up over the jingle.
  _applyDuck() {
    if (!this.ctx || !this.duck) return;
    const level =
      (this.duckOverlay ? DUCK_LEVEL : 1) * (this.duckSting ? STING_DUCK : 1);
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(level, t, 0.15);
  }

  // ---- one-shot stings (milestone 25) ----------------------
  //
  // `startSting("party", ms)` plays a fixed-length jingle and
  // then stops, full stop. It never becomes `this.player`, so
  // setTrack / room hops / the mute toggle keep working exactly
  // as they did — and a silent room is still a silent room the
  // moment the sting is over.
  //
  // The CALLER decides whether the player wants sound: the room
  // component only calls this when the speaker toggle is on, so
  // mute gives you the party with the lights and none of the
  // noise.
  startSting(id, durationMs) {
    this.unlock();
    const ctx = this.ctx;
    if (!ctx || !this.stingBus) return;
    const trk = STINGS[id];
    if (!trk) return;
    if (typeof document !== "undefined" && document.hidden) return;
    const ms = Number(durationMs);
    if (!Number.isFinite(ms) || ms < 400) return;
    this.stopSting(0.06);

    const gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(this.stingBus);
    const spb = 60 / trk.bpm;
    const barLen = spb * trk.beats;
    const st = {
      id,
      gain,
      timer: 0,
      nextT: 0,
      bar: 0,
      endAt: ctx.currentTime + ms / 1000,
      dead: false,
    };
    const tick = () => {
      if (st.dead) return;
      if (st.nextT === 0) st.nextT = ctx.currentTime + 0.06;
      while (
        st.nextT < ctx.currentTime + LOOKAHEAD_S &&
        st.nextT < st.endAt - 0.05
      ) {
        trk.bar(ctx, this.noiseBuf, gain, st.nextT, st.bar, spb);
        st.bar += 1;
        st.nextT += barLen;
      }
      if (ctx.currentTime >= st.endAt - STING_FADE_S) this.stopSting();
    };
    st.timer = setInterval(tick, TICK_MS);
    this.sting = st;
    this.duckSting = true;
    this._applyDuck();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    tick();
  }

  stopSting(fadeS) {
    const st = this.sting;
    if (!st) return;
    this.sting = null;
    st.dead = true; // schedule nothing more
    clearInterval(st.timer);
    this.duckSting = false;
    this._applyDuck();
    const ctx = this.ctx;
    const f = Math.max(0.03, fadeS === undefined ? STING_FADE_S : fadeS);
    if (ctx) {
      const t = ctx.currentTime;
      try {
        st.gain.gain.cancelScheduledValues(t);
        st.gain.gain.setValueAtTime(st.gain.gain.value, t);
        st.gain.gain.linearRampToValueAtTime(0.0001, t + f);
      } catch {
        /* context torn down under us — nothing to fade */
      }
    }
    // let the notes already scheduled ring out under the fade
    setTimeout(() => {
      try {
        st.gain.disconnect();
      } catch {
        /* already gone */
      }
      this._sync(); // suspend if nothing else is sounding
    }, (f + 0.25) * 1000);
  }

  // Unmount: fade to nothing and power down.
  stop() {
    this.trackId = null;
    this.stopSting(0.08);
    this._sync();
  }

  _sync() {
    if (!this.ctx || !this.unlocked) return;
    const hidden = typeof document !== "undefined" && document.hidden;
    const want = hidden ? null : this.trackId;
    if (this.player && this.player.id !== want) this._fadeOutPlayer();
    if (want && !this.player) this._startPlayer(want);
    // A sting counts as "something is sounding": suspending the
    // context underneath one would freeze the jingle halfway.
    if (!this.player && !this.sting && this.ctx.state === "running") {
      // nothing sounding or fading — full stop, zero CPU
      this.ctx.suspend().catch(() => {});
    } else if ((this.player || this.sting) && this.ctx.state === "suspended") {
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
