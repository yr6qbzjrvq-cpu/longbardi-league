// ============================================================
// HSPNeighborhood — tomatoes (milestone 13, pure module)
// ------------------------------------------------------------
// The ONE definition of how a thrown tomato flies, where it
// lands and what the splat looks like. Imported by the client
// engine (components/NeighborhoodRoom) AND by
// /api/neighborhood/throw, exactly like movement.js is shared
// by the walk sim and the move route.
//
// The whole feature rides on determinism, the same trick the
// walking uses: the server broadcasts ONE small record
// (origin, target, start timestamp, flight duration) and every
// client replays an identical arc from it. Nothing about the
// flight or the splat is negotiated between peers, and no
// client can publish a throw — the gameplay topic is
// server-only (see lib/neighborhood/topics.js), so a tomato
// exists because a validated API route said so.
//
// Splat ART is deterministic too: the shape, the flecks and
// the seeds are generated from a hash of the throw id, so a
// splat looks the same in every browser without a single byte
// of geometry crossing the wire.
//
// Nothing here touches the DOM at import time; the draw
// helpers take a 2d context, so the module is safe to import
// in a serverless route.
// ============================================================

// ---- kinds -------------------------------------------------
// "spot"   — floor, wall, prop: a world-space point.
// "player" — sticks to an avatar wherever it walks.
// "screen" — a normalized point (0..1) inside a room's screen
//            rect, so the splat lands ON the big board / the
//            bar TV even while a live feed is playing.
export const THROW_KINDS = ["spot", "player", "screen"];

// One tomato per player per this window; the server enforces
// it in Postgres (neighborhood_record_throw) and the client
// paces itself to the same number so the 429 is rare.
export const THROW_COOLDOWN_MS = 1500;

// World px above the feet where a tomato leaves the hand, and
// where one lands on a body. Avatars are ~150 world px tall.
export const HAND_LIFT = 96;
export const BODY_LIFT = 84;

// Stick, then fade. Total life is what the engine prunes on.
export const SPLAT_HOLD_MS = 3200;
export const SPLAT_FADE_MS = 1400;
export const SPLAT_LIFE_MS = SPLAT_HOLD_MS + SPLAT_FADE_MS;

// A splat lands with a quick squash-and-settle pop.
export const SPLAT_POP_MS = 190;

export const TOMATO_RADIUS = 15; // world px in flight
export const SPLAT_RADIUS = 30; // world px, before the pop scale
export const SCREEN_SPLAT_RADIUS = 34; // px in screen-rect space

// Keep a wild afternoon from turning into a slideshow. Oldest
// splats are dropped first; in practice the 4.6s life means
// this is never reached at league sizes.
export const MAX_SPLATS = 48;

// Flat vectors, thick soft outline — house style.
const OUTLINE = "#5d1010";
const RED = "#d7342b";
const RED_DEEP = "#a81f1c";
const RED_LIGHT = "#ef6a52";
const PULP = "#f7c9a8";
const GREEN = "#3f9247";

// ---- flight ------------------------------------------------

// Distance decides the flight time and how high the arc goes,
// so a lob across Mission Control reads differently from a
// point-blank splat. Clamped at both ends: never a bullet,
// never a lazy balloon.
export function flightDurationMs(ox, oy, tx, ty) {
  const d = Math.hypot(tx - ox, ty - oy);
  return Math.round(Math.min(1150, Math.max(420, 360 + d * 0.95)));
}

export function arcHeightFor(ox, oy, tx, ty) {
  const d = Math.hypot(tx - ox, ty - oy);
  return Math.min(200, 60 + d * 0.28);
}

// Position along the arc at `u` in 0..1. Straight-on 3/4 view,
// so "up" is just -y: linear in the ground direction plus a
// parabola lifting the middle of the flight.
export function arcPointAt(ox, oy, tx, ty, u, arcH) {
  const k = Math.max(0, Math.min(1, u));
  const h = arcH == null ? arcHeightFor(ox, oy, tx, ty) : arcH;
  return {
    x: ox + (tx - ox) * k,
    y: oy + (ty - oy) * k - h * 4 * k * (1 - k),
    // A tomato tumbles a couple of times on the way over.
    rot: k * Math.PI * 3.2,
  };
}

// ---- splat timing ------------------------------------------

export function splatAlpha(ageMs) {
  if (ageMs <= SPLAT_HOLD_MS) return 1;
  const f = (ageMs - SPLAT_HOLD_MS) / SPLAT_FADE_MS;
  return Math.max(0, 1 - f);
}

// Squash on contact, settle a beat later.
export function splatScale(ageMs) {
  if (ageMs >= SPLAT_POP_MS) return 1;
  const u = Math.max(0, ageMs) / SPLAT_POP_MS;
  // 0.55 at contact, a small overshoot mid-pop, settled at 1.
  return 1 - 0.45 * (1 - u) + 0.3 * Math.sin(Math.PI * u);
}

// ---- deterministic art -------------------------------------

// FNV-1a over the throw id: every client hashes the same id
// and therefore draws the same splatter.
export function seedFromId(id) {
  const str = String(id == null ? "" : id);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// mulberry32 — small, fast, identical everywhere.
export function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Geometry for one splat, in units of `radius`. Built once
// when the splat lands and cached on the record.
export function makeSplatArt(seed, radius) {
  const rnd = rngFrom(seed);
  const lobes = 9 + Math.floor(rnd() * 4);
  const pts = [];
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const r = radius * (0.6 + rnd() * 0.58);
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.84 });
  }
  const blobs = [];
  const blobCount = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < blobCount; i++) {
    const a = rnd() * Math.PI * 2;
    const d = radius * (0.48 + rnd() * 0.62);
    blobs.push({
      x: Math.cos(a) * d,
      y: Math.sin(a) * d * 0.8,
      r: radius * (0.17 + rnd() * 0.23),
    });
  }
  const flecks = [];
  const fleckCount = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < fleckCount; i++) {
    const a = rnd() * Math.PI * 2;
    const d = radius * (1.12 + rnd() * 1.0);
    flecks.push({
      x: Math.cos(a) * d,
      y: Math.sin(a) * d * 0.86,
      r: radius * (0.08 + rnd() * 0.13),
    });
  }
  const pips = [];
  const pipCount = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < pipCount; i++) {
    const a = rnd() * Math.PI * 2;
    const d = radius * rnd() * 0.48;
    pips.push({
      x: Math.cos(a) * d,
      y: Math.sin(a) * d * 0.8,
      rot: rnd() * Math.PI,
      r: radius * 0.11,
    });
  }
  return { pts, blobs, flecks, pips, radius };
}

function splatBody(art) {
  const p = new Path2D();
  const pts = art.pts;
  const n = pts.length;
  // Closed smooth curve through the lobe points: quadratics
  // anchored on the midpoints keep it round and organic
  // instead of a spiky star.
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let m = mid(pts[n - 1], pts[0]);
  p.moveTo(m.x, m.y);
  for (let i = 0; i < n; i++) {
    const next = mid(pts[i], pts[(i + 1) % n]);
    p.quadraticCurveTo(pts[i].x, pts[i].y, next.x, next.y);
  }
  p.closePath();
  for (const b of art.blobs) {
    p.moveTo(b.x + b.r, b.y);
    p.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  }
  return p;
}

// One splat, centered on (x, y), already faded/scaled by the
// caller's alpha + scale. Flat fills, one thick soft outline.
export function drawSplat(ctx, art, x, y, alpha, scale) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const body = splatBody(art);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4.5;
  ctx.stroke(body);
  ctx.fillStyle = RED;
  ctx.fill(body);

  // inner pulp, a shrunken copy of the same shape
  ctx.save();
  ctx.scale(0.56, 0.56);
  const inner = splatBody(art);
  ctx.fillStyle = RED_LIGHT;
  ctx.fill(inner);
  ctx.restore();

  // seeds
  ctx.fillStyle = PULP;
  for (const s of art.pips) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, s.r * 1.5, s.r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // flecks that flew off on impact
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.6;
  ctx.fillStyle = RED_DEEP;
  for (const f of art.flecks) {
    ctx.beginPath();
    ctx.ellipse(f.x, f.y, f.r * 1.25, f.r, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();
  }
  ctx.restore();
}

// The tomato itself, mid-flight.
export function drawTomato(ctx, x, y, r, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot || 0);
  ctx.lineJoin = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.93, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = RED;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.34, r * 0.3, r * 0.19, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fill();
  // calyx
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.2;
  ctx.fillStyle = GREEN;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const tipX = Math.cos(a) * r * 0.72;
    const tipY = Math.sin(a) * r * 0.72 - r * 0.62;
    if (i === 0) ctx.moveTo(tipX, tipY);
    else ctx.lineTo(tipX, tipY);
    const b = a + Math.PI / 5;
    ctx.lineTo(Math.cos(b) * r * 0.22, Math.sin(b) * r * 0.22 - r * 0.62);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

// A small shadow under the tomato so the arc reads as height
// and not just as drifting sideways.
export function drawTomatoShadow(ctx, gx, gy, u, r) {
  const lift = 1 - 4 * u * (1 - u) * 0.72;
  ctx.save();
  ctx.globalAlpha = 0.16 * lift;
  ctx.fillStyle = "#101820";
  ctx.beginPath();
  ctx.ellipse(gx, gy, r * 0.95 * lift, r * 0.4 * lift, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Clamp a normalized screen coordinate from the wire.
export function unit(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.min(1, Math.max(0, v));
}
