// ============================================================
// HSPNeighborhood — bullseye confetti (milestone 29)
// ------------------------------------------------------------
// Austin's ask: "Make it so if you throw a tomato at the dart
// board confetti falls down".
//
// The ONE definition of where the Sports Bar dartboard is, what
// counts as hitting it, and what a hit looks like. Imported by
// the client engine (components/NeighborhoodRoom) and by
// nothing else — deliberately.
//
// WHY THERE IS NO SERVER PIECE. A tomato already reaches every
// client as one small broadcast record: origin, target, start
// time, flight time. The landing point is therefore identical
// in every browser, which means "did that one land in the
// board?" is a pure function of data everybody already has.
// Running the test locally is not a shortcut — it is the same
// determinism the splat art rides on — and it leaves the
// security model exactly where it was: the gameplay topic stays
// server-write-only, and no client publishes anything new to
// make confetti appear on somebody else's screen.
//
// WHY NOTHING LINGERS. A burst is a pure function of (landing
// time, Date.now()): no per-frame integration, no accumulating
// state. A tab whose rAF was frozen while hidden comes back,
// finds the burst expired against the wall clock and draws
// nothing at all — the same reasoning that makes milestone 13
// stamp a splat with when it LANDED rather than when this tab
// got around to noticing.
//
// Coordinates here are ROOM/WORLD pixels, because the board is
// painted into the room background in world pixels (see
// drawSportsBarBackground in rooms.js) and the burst has to sit
// on it however the camera happens to be placed.
//
// Nothing here touches window/document at import time; the draw
// helpers take a 2d context.
// ============================================================

import { makeConfetti, drawConfettiPiece, rngFrom, seedFromId } from "./party";

// ---- the board ---------------------------------------------
// Mirrors the circle drawSportsBarBackground paints under the
// two framed jerseys: centre (39, 414), outer ring r = 30.
export const DARTBOARD_ROOM_ID = "sports-bar";
export const DARTBOARD = { x: 39, y: 414, r: 30 };

// The patch of cached background the shake re-stamps — a little
// wider than the board so the outline never clips. It sits well
// above the wainscot line (y = 472), so the wall behind it is
// flat palette colour.
export const DARTBOARD_PATCH = { x: 5, y: 380, w: 68, h: 68 };

// ---- timing ------------------------------------------------
// Short on purpose: an easter egg, not the party button.
export const DART_BURST_MS = 2600;
const FADE_OUT_S = 0.7;

// The board rocks on its nail for half a beat after the hit.
const WOBBLE_MS = 560;
const WOBBLE_PX = 3.2;

// Enough paper to read as a celebration, few enough that three
// bullseyes in a row cost nothing measurable.
const PIECE_COUNT = 36;

// World px per second squared.
const GRAVITY = 520;

// ---- the test ----------------------------------------------
// "spot" throws only: a tomato that stuck to a player or to the
// big screen did not hit the wall.
export function isDartboardHit(roomId, kind, x, y) {
  if (roomId !== DARTBOARD_ROOM_ID) return false;
  if (kind !== "spot") return false;
  const dx = Number(x) - DARTBOARD.x;
  const dy = Number(y) - DARTBOARD.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  return dx * dx + dy * dy <= DARTBOARD.r * DARTBOARD.r;
}

// ---- the burst ---------------------------------------------
// The pieces borrow party.js's art wholesale — same palette,
// same rectangles, ribbons and rounds, same tumble — and are
// then re-aimed into world pixels off the board face. Seeded on
// the throw id, so every browser drops the same paper in the
// same order without a byte of geometry crossing the wire.
export function makeDartBurst(id, atMs) {
  const seed = (seedFromId(id) ^ 0x9e3779b9) >>> 0;
  const pieces = makeConfetti(seed, PIECE_COUNT);
  const rnd = rngFrom(seed);
  for (const p of pieces) {
    // Mostly upward and outward, like a party popper held flat
    // against the wall.
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.1;
    const speed = 80 + rnd() * 170;
    p.x0 = (rnd() - 0.5) * DARTBOARD.r * 0.9;
    p.y0 = (rnd() - 0.5) * DARTBOARD.r * 0.9;
    p.vx = Math.cos(a) * speed;
    p.vy0 = Math.sin(a) * speed; // negative is up
    p.term = 95 + rnd() * 75; // terminal fall, world px/s
    p.birth = rnd() * 0.1; // the pop is one moment
    p.driftFreq = 1.2 + rnd() * 2.4;
    p.driftPx = 4 + rnd() * 13;
    // party.js sizes paper as a fraction of the view; here it is
    // world px, so the paper keeps the board's scale at any zoom.
    p.wPx = 7 + rnd() * 6;
    p.hPx = 10 + rnd() * 9;
  }
  return { id, at: atMs, durationMs: DART_BURST_MS, pieces };
}

export function dartBurstExpired(burst, nowMs) {
  return !burst || nowMs - burst.at >= burst.durationMs;
}

// Where one piece is at `tSec` after the hit, in world px
// RELATIVE TO THE BOARD CENTRE. Closed form with an exact
// apex/terminal split — the same shape as party.js's confettiAt
// — so there is no per-frame integration to drift between
// browsers or to blow up after a hidden tab.
export function dartConfettiAt(p, tSec, fadeK) {
  const age = tSec - p.birth;
  if (age < 0) return null;

  let y;
  if (p.vy0 < p.term) {
    const tA = (p.term - p.vy0) / GRAVITY;
    if (age <= tA) {
      y = p.y0 + p.vy0 * age + 0.5 * GRAVITY * age * age;
    } else {
      y = p.y0 + p.vy0 * tA + 0.5 * GRAVITY * tA * tA + p.term * (age - tA);
    }
  } else {
    y = p.y0 + p.term * age;
  }

  // Sideways: the puff, easing off fast, plus the flutter of a
  // falling piece of paper.
  const settle = Math.min(1, age * 0.9);
  const x =
    p.x0 +
    p.vx * age * Math.min(1, 1.1 / Math.max(0.3, age)) +
    Math.sin(age * p.driftFreq + p.phase) * p.driftPx * settle;

  const alpha = Math.min(1, age * 8) * fadeK;
  if (alpha <= 0.01) return null;
  return {
    x,
    y,
    rot: p.rot0 + p.spin * age,
    flip: 0.16 + 0.84 * Math.abs(Math.cos(age * p.flipSpeed + p.phase)),
    alpha,
  };
}

// 1 for most of the burst, ramped to 0 at the end so the last
// pieces do not blink out mid-air.
export function dartBurstFade(elapsedMs, durationMs) {
  const left = (durationMs - elapsedMs) / 1000;
  return Math.min(1, Math.max(0, left / FADE_OUT_S));
}

// Damped rock, in world px. Null outside the first half second,
// which is what lets the engine skip the re-stamp entirely.
export function dartboardShake(elapsedMs) {
  if (!(elapsedMs >= 0) || elapsedMs >= WOBBLE_MS) return null;
  const u = elapsedMs / WOBBLE_MS;
  const damp = (1 - u) * (1 - u);
  return {
    x: Math.sin(u * Math.PI * 6.2) * WOBBLE_PX * damp,
    y: Math.cos(u * Math.PI * 5.1) * WOBBLE_PX * 0.55 * damp,
  };
}

// ---- drawing -----------------------------------------------

// The board is baked into the room's cached background, so the
// shake does not re-paint the art: it wipes that one patch of
// wall and stamps the SAME patch of the cache back down a few
// pixels over. The dartboard keeps exactly one definition, in
// rooms.js, and there is nothing here to keep in sync with it.
export function drawDartWobble(ctx, bg, room, P, burst, nowMs) {
  if (!bg || !bg.width || !room || !burst) return;
  const sh = dartboardShake(nowMs - burst.at);
  if (!sh) return;
  const k = bg.width / room.width;
  const r = DARTBOARD_PATCH;
  ctx.save();
  ctx.fillStyle = P.wall;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.drawImage(bg, r.x * k, r.y * k, r.w * k, r.h * k, r.x + sh.x, r.y + sh.y, r.w, r.h);
  ctx.restore();
}

// The confetti itself, in world space, centred on the board.
export function drawDartBurst(ctx, burst, nowMs) {
  if (!burst) return;
  const elapsed = nowMs - burst.at;
  if (elapsed < 0 || elapsed >= burst.durationMs) return;
  const t = elapsed / 1000;
  const fade = dartBurstFade(elapsed, burst.durationMs);
  if (fade <= 0) return;
  ctx.save();
  for (const p of burst.pieces) {
    const at = dartConfettiAt(p, t, fade);
    if (!at) continue;
    drawConfettiPiece(
      ctx,
      p,
      DARTBOARD.x + at.x,
      DARTBOARD.y + at.y,
      p.wPx,
      p.hPx,
      at.rot,
      at.flip,
      at.alpha
    );
  }
  ctx.restore();
}
