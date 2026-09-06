// ============================================================
// HSPNeighborhood — the HSPN Downs track view (milestone 24)
// ------------------------------------------------------------
// Procedural canvas, same art rules as the rest of the world:
// flat bright fills, soft darker outlines, thick rounded
// shapes, no image assets. This module DRAWS; it decides
// nothing. Where the horses are comes from
// lib/neighborhood/horses.js — the same pure module the API
// route settles the race with — so two people watching the
// same race cannot see two different races.
//
// LAYOUT. One fluid virtual space, exactly like the blackjack
// felt: the height is fixed at VH and the width follows the
// real aspect ratio, clamped so a wide desktop doesn't strand
// the track and a portrait phone doesn't squash it. Every
// position is a fraction of VW/VH, so phones and desktops run
// the same drawing code.
//
// Trig IS allowed in here (unlike horses.js), because nothing
// in this file decides anything: a leg swing that differs in
// the last bit between two browsers is not a different race.
// ============================================================

import { HORSES, progressAt, effortAt } from "@/lib/neighborhood/horses";

export const VH = 600;
export const MIN_VW = 380;
export const MAX_VW = 4200;

// The virtual width FOLLOWS the real aspect ratio, so the track
// fills whatever box it is given and never letterboxes. The cap
// is deliberately huge: a wider box just means a longer straight
// (the horses are sized off the LANE, so they stay exactly the
// same size on screen), and a dark bar down each side of a
// racetrack looks like a mistake.
export function virtualWidth(w, h) {
  const aspect = h > 0 ? w / h : 1.6;
  return Math.max(MIN_VW, Math.min(MAX_VW, VH * aspect));
}

export const TRACK_LIGHT = {
  sky: "#2f6fb5",
  skyLow: "#79b4e8",
  stand: "#43214f",
  standDark: "#31163b",
  standRoof: "#c8203c",
  crowd: ["#f2c81b", "#e2543f", "#f7f0dc", "#3fae5f", "#2a7de1", "#ff8fc4", "#ffd8a8"],
  rail: "#f7f0dc",
  railPost: "#cdbfa0",
  turf: "#3f9b57",
  turfAlt: "#379050",
  turfLine: "rgba(12,40,22,0.16)",
  dirt: "#b98a52",
  apron: "#2f7d46",
  post: "#c8203c",
  postDark: "#8e1230",
  gate: "#dfe6ea",
  gateDark: "#9fb0bb",
  text: "#f7f0dc",
  ink: "#101a14",
  dim: "rgba(247,240,220,0.68)",
  gold: "#f2c81b",
  panel: "rgba(10,26,16,0.78)",
  shadow: "rgba(8,24,12,0.22)",
  dust: "rgba(247,240,220,0.5)",
};

export const TRACK_DARK = {
  ...TRACK_LIGHT,
  sky: "#151a3a",
  skyLow: "#2b3566",
  stand: "#2c1338",
  standDark: "#1d0c26",
  standRoof: "#8e1230",
  rail: "#e3dcc6",
  railPost: "#9d9179",
  turf: "#2f7a44",
  turfAlt: "#286c3c",
  apron: "#245f36",
  dirt: "#8f6b3f",
  gate: "#b9c3ca",
  gateDark: "#7d8b95",
  panel: "rgba(4,14,9,0.82)",
};

export function trackPalette(theme) {
  return theme === "dark" ? TRACK_DARK : TRACK_LIGHT;
}

// ---- tiny drawing helpers (same shapes as rooms.js) --------

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
}

function ell(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
}

function shade(hex, f) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (f >= 0) {
    r += (255 - r) * f;
    g += (255 - g) * f;
    b += (255 - b) * f;
  } else {
    r *= 1 + f;
    g *= 1 + f;
    b *= 1 + f;
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

function paint(ctx, color, lw = 2.5) {
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = shade(color, -0.3);
  ctx.lineWidth = lw;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function limb(ctx, x1, y1, x2, y2, x3, y3, color, w) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

// ---- one horse ---------------------------------------------
// Facing right, drawn from (x, y) = the middle of its hooves.
// `gallop` is the cycle phase in radians, `lift` how hard it is
// running (1 = its own average). Chunky and flat, like every
// other thing in this world.
export function drawHorse(ctx, x, y, s, horse, opts) {
  const P = opts.P;
  const gallop = opts.gallop || 0;
  const drive = opts.drive === undefined ? 1 : opts.drive;
  const body = horse.color;
  const dark = shade(body, -0.3);
  const bob = Math.sin(gallop * 2) * 1.6 * s * drive;
  const cy = y - 19 * s + bob;

  // shadow on the turf — stays put while the horse bobs
  ell(ctx, x, y + 1.5 * s, 17 * s, 4.2 * s);
  ctx.fillStyle = P.shadow;
  ctx.fill();

  const sw = Math.sin(gallop);
  const sw2 = Math.sin(gallop + Math.PI * 0.62);
  const reach = 8.2 * s * (0.75 + drive * 0.35);

  // hind legs (behind the body)
  limb(
    ctx,
    x - 10 * s, cy + 4 * s,
    x - 13 * s - sw * reach * 0.5, cy + 11 * s,
    x - 12 * s - sw * reach, y - 0.5 * s,
    dark, 3.1 * s
  );
  limb(
    ctx,
    x - 9 * s, cy + 4 * s,
    x - 12 * s + sw * reach * 0.5, cy + 11 * s,
    x - 11 * s + sw * reach, y - 0.5 * s,
    dark, 3.1 * s
  );
  // tail, streaming
  ctx.beginPath();
  ctx.moveTo(x - 15 * s, cy - 3 * s);
  ctx.quadraticCurveTo(
    x - 24 * s, cy - 6 * s + sw2 * 2 * s,
    x - 29 * s, cy + 3 * s + sw2 * 3 * s
  );
  ctx.strokeStyle = shade(body, 0.22);
  ctx.lineWidth = 4.4 * s;
  ctx.lineCap = "round";
  ctx.stroke();

  // barrel
  ell(ctx, x - 1 * s, cy, 15.5 * s, 8.6 * s);
  paint(ctx, body, 2.2 * s);
  // haunch
  circle(ctx, x - 10 * s, cy - 0.5 * s, 8.4 * s);
  paint(ctx, body, 2.2 * s);

  // saddle blanket in the silk colour, with the lane number
  ctx.save();
  ell(ctx, x - 1 * s, cy, 15.5 * s, 8.6 * s);
  ctx.clip();
  rr(ctx, x - 7 * s, cy - 9 * s, 12 * s, 10 * s, 2 * s);
  ctx.fillStyle = horse.silk;
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = shade(horse.silk, horse.silk === "#f7f0dc" ? -0.75 : 0.75);
  ctx.font = `700 ${Math.round(7.2 * s)}px Oswald, 'Arial Narrow', sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(horse.id + 1), x - 1 * s, cy - 4.6 * s);

  // neck + head
  ctx.beginPath();
  ctx.moveTo(x + 8 * s, cy - 6 * s);
  ctx.lineTo(x + 17 * s, cy - 15 * s);
  ctx.lineTo(x + 22 * s, cy - 12 * s);
  ctx.lineTo(x + 12 * s, cy + 1 * s);
  ctx.closePath();
  paint(ctx, body, 2.2 * s);
  rr(ctx, x + 16 * s, cy - 20 * s, 13 * s, 8 * s, 3.4 * s);
  paint(ctx, body, 2.2 * s);
  // muzzle + ear + eye
  circle(ctx, x + 28 * s, cy - 15 * s, 2.6 * s);
  ctx.fillStyle = dark;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + 18 * s, cy - 20 * s);
  ctx.lineTo(x + 17 * s, cy - 25 * s);
  ctx.lineTo(x + 21 * s, cy - 21 * s);
  ctx.closePath();
  paint(ctx, body, 1.6 * s);
  circle(ctx, x + 22 * s, cy - 17 * s, 1.5 * s);
  ctx.fillStyle = P.ink;
  ctx.fill();
  // mane
  ctx.beginPath();
  ctx.moveTo(x + 17 * s, cy - 18 * s);
  ctx.quadraticCurveTo(x + 11 * s, cy - 17 * s, x + 7 * s, cy - 6 * s);
  ctx.strokeStyle = shade(body, 0.22);
  ctx.lineWidth = 3.6 * s;
  ctx.stroke();

  // jockey — crouched, silks in the horse's colour
  const jy = cy - 12 * s - Math.sin(gallop * 2 + 0.7) * 1.4 * s;
  rr(ctx, x - 6 * s, jy - 7 * s, 13 * s, 10 * s, 4 * s);
  paint(ctx, horse.silk, 1.8 * s);
  circle(ctx, x + 4 * s, jy - 9 * s, 4.1 * s);
  paint(ctx, body, 1.8 * s);
  circle(ctx, x + 5.4 * s, jy - 9.4 * s, 1.9 * s);
  ctx.fillStyle = "#e6b98f";
  ctx.fill();
  limb(
    ctx,
    x + 2 * s, jy - 3 * s,
    x + 8 * s, jy - 2 * s,
    x + 13 * s, cy - 12 * s,
    shade(horse.silk, -0.2), 2.4 * s
  );

  // front legs (in front of the body)
  limb(
    ctx,
    x + 8 * s, cy + 4 * s,
    x + 12 * s + sw2 * reach * 0.5, cy + 11 * s,
    x + 11 * s + sw2 * reach, y - 0.5 * s,
    dark, 3.1 * s
  );
  limb(
    ctx,
    x + 7 * s, cy + 4 * s,
    x + 11 * s - sw2 * reach * 0.5, cy + 11 * s,
    x + 10 * s - sw2 * reach, y - 0.5 * s,
    shade(body, -0.18), 3.1 * s
  );

  // a hard surge kicks turf up behind
  if (drive > 1.12) {
    ctx.fillStyle = P.dust;
    for (let i = 0; i < 3; i += 1) {
      const px = x - 20 * s - i * 7 * s - ((gallop * 9) % 6) * s;
      circle(ctx, px, y - 1 * s - Math.sin(gallop + i) * 2 * s, (2.6 - i * 0.6) * s);
      ctx.fill();
    }
  }
}

// ---- the grandstand ----------------------------------------

function drawStands(ctx, VW, top, h, P, t) {
  const sky = ctx.createLinearGradient(0, 0, 0, top + h);
  sky.addColorStop(0, P.sky);
  sky.addColorStop(1, P.skyLow);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VW, top + h);

  // roof
  ctx.beginPath();
  ctx.moveTo(-4, top - 8);
  ctx.lineTo(VW + 4, top - 14);
  ctx.lineTo(VW + 4, top + 22);
  ctx.lineTo(-4, top + 34);
  ctx.closePath();
  paint(ctx, P.standRoof, 2.5);

  // the stand itself
  ctx.fillStyle = P.stand;
  ctx.fillRect(-4, top + 30, VW + 8, h - 30);
  ctx.fillStyle = P.standDark;
  ctx.fillRect(-4, top + h - 12, VW + 8, 12);

  // the crowd: four tiers of heads, bobbing on their own beat
  const rows = 4;
  for (let r = 0; r < rows; r += 1) {
    const y = top + 44 + r * ((h - 58) / rows);
    ctx.fillStyle = P.standDark;
    ctx.fillRect(-4, y + 7, VW + 8, 3);
    const step = 21;
    for (let x = 8; x < VW; x += step) {
      const k = Math.abs(Math.round(x * 7.3 + r * 31));
      const c = P.crowd[k % P.crowd.length];
      const bob = Math.sin(t * 2.6 + k * 0.7) * 1.5;
      const cx = x + (r % 2) * 10;
      rr(ctx, cx - 3.4, y + bob - 1, 6.8, 8, 3);
      ctx.fillStyle = c;
      ctx.fill();
      circle(ctx, cx, y + bob - 2.6, 3.1);
      ctx.fill();
    }
  }
  // the front rail of the stand
  ctx.fillStyle = P.railPost;
  ctx.fillRect(-4, top + h - 16, VW + 8, 4);
}

function drawRail(ctx, VW, y, P) {
  ctx.strokeStyle = P.rail;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(VW, y);
  ctx.stroke();
  ctx.strokeStyle = P.railPost;
  ctx.lineWidth = 3;
  for (let x = 10; x < VW; x += 46) {
    ctx.beginPath();
    ctx.moveTo(x, y - 2);
    ctx.lineTo(x, y + 9);
    ctx.stroke();
  }
}

// ---- the whole view ----------------------------------------
//
// opts: { w, h, dpr, theme, wire, race, u, phase, now, selfBet }
//   wire  the broadcast state (may be null before the first sync)
//   race  buildRace(seed, winner) or null while betting
//   u     0..1 through the race window
export function drawTrackView(ctx, opts) {
  const {
    w,
    h,
    dpr = 1,
    theme = "light",
    wire = null,
    race = null,
    u = 0,
    now = Date.now(),
    selfBet = null,
  } = opts;
  const P = trackPalette(theme);
  const VW = virtualWidth(w, h);
  const scale = Math.min(w / VW, h / VH);
  const ox = (w - VW * scale) / 2;
  const oy = (h - VH * scale) / 2;
  const t = now / 1000;
  const phase = wire ? wire.phase : "betting";

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = P.standDark;
  ctx.fillRect(0, 0, w * dpr, h * dpr);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);

  const STAND_H = VH * 0.24;
  const TRACK_TOP = VH * 0.3;
  const TRACK_BOT = VH * 0.9;
  const LANE_H = (TRACK_BOT - TRACK_TOP) / 4;
  const startX = Math.max(52, VW * 0.1);
  const finishX = VW * 0.83;
  const runLen = finishX - startX;

  drawStands(ctx, VW, 0, STAND_H, P, t);

  // the strip of dirt between the stand and the turf
  ctx.fillStyle = P.dirt;
  ctx.fillRect(0, STAND_H, VW, TRACK_TOP - STAND_H);
  drawRail(ctx, VW, STAND_H + 8, P);

  // the four lanes
  for (let i = 0; i < 4; i += 1) {
    const y = TRACK_TOP + i * LANE_H;
    ctx.fillStyle = i % 2 === 0 ? P.turf : P.turfAlt;
    ctx.fillRect(0, y, VW, LANE_H);
    ctx.strokeStyle = P.turfLine;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(VW, y + 0.5);
    ctx.stroke();
  }
  // mowing stripes, so the turf reads as turf
  ctx.save();
  ctx.globalAlpha = 0.09;
  ctx.fillStyle = "#ffffff";
  for (let x = 0; x < VW; x += 54) ctx.fillRect(x, TRACK_TOP, 27, TRACK_BOT - TRACK_TOP);
  ctx.restore();

  // furlong poles down the track
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (let k = 1; k <= 3; k += 1) {
    const x = startX + (runLen * k) / 4;
    ctx.fillStyle = P.rail;
    ctx.fillRect(x - 1.5, TRACK_TOP - 12, 3, 12);
    circle(ctx, x, TRACK_TOP - 15, 3.4);
    ctx.fillStyle = k === 2 ? P.gold : P.rail;
    ctx.fill();
  }
  ctx.restore();

  // the finish line: checkers across every lane, then the post
  const cell = LANE_H / 4;
  for (let r = 0; r * cell < TRACK_BOT - TRACK_TOP; r += 1) {
    for (let c = 0; c < 2; c += 1) {
      ctx.fillStyle = (r + c) % 2 === 0 ? "#f7f0dc" : "#22201c";
      ctx.fillRect(finishX - 5 + c * 5, TRACK_TOP + r * cell, 5, Math.min(cell, TRACK_BOT - (TRACK_TOP + r * cell)));
    }
  }
  rr(ctx, finishX - 3, STAND_H + 6, 6, TRACK_TOP - STAND_H - 6, 2);
  paint(ctx, P.post, 2);
  rr(ctx, finishX - 36, STAND_H - 10, 72, 24, 6);
  paint(ctx, P.post, 2.5);
  ctx.fillStyle = P.text;
  ctx.font = "700 15px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("FINISH", finishX, STAND_H + 3);

  // the starting gate
  const gateOpen = phase !== "betting";
  ctx.save();
  ctx.globalAlpha = gateOpen ? 0.3 : 1;
  rr(ctx, startX - 30, TRACK_TOP - 12, 26, TRACK_BOT - TRACK_TOP + 22, 4);
  paint(ctx, P.gate, 2.4);
  for (let i = 0; i <= 4; i += 1) {
    ctx.fillStyle = P.gateDark;
    ctx.fillRect(startX - 30, TRACK_TOP - 12 + i * LANE_H, 26, 4);
  }
  ctx.restore();
  ctx.fillStyle = P.rail;
  ctx.fillRect(startX - 1.5, TRACK_TOP, 3, TRACK_BOT - TRACK_TOP);

  // lane tabs: which colour is running where, readable at speed
  for (let i = 0; i < 4; i += 1) {
    const y = TRACK_TOP + i * LANE_H;
    const hz = HORSES[i];
    rr(ctx, 2, y + 3, 20, LANE_H - 8, 4);
    ctx.fillStyle = hz.color;
    ctx.fill();
    ctx.fillStyle = shade(hz.color, hz.silk === "#f7f0dc" ? 0.8 : -0.72);
    ctx.font = "700 14px Oswald, 'Arial Narrow', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), 12, y + LANE_H / 2 - 2);
    if (selfBet && selfBet.horse === i) {
      rr(ctx, 1, y + 2, 22, LANE_H - 6, 5);
      ctx.strokeStyle = P.gold;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  // ---- the field -------------------------------------------
  const groundOf = (i) => TRACK_TOP + i * LANE_H + LANE_H * 0.82;
  // Size off the LANE, not the width: a portrait phone has the
  // narrowest virtual width and would otherwise get the
  // smallest horses, which is the milestone-16 card mistake.
  const hs = Math.max(0.8, Math.min(1.7, LANE_H / 60));

  if (!race) {
    // Between races: four horses in the gate, fidgeting.
    for (let i = 0; i < 4; i += 1) {
      const idle = t * 1.5 + i * 1.4;
      drawHorse(ctx, startX + 20, groundOf(i), hs, HORSES[i], {
        P,
        gallop: idle,
        drive: 0.25,
      });
    }
  } else {
    const pos = progressAt(race, u);
    // draw the trailing horse first so a leader overlaps it
    const paintOrder = [0, 1, 2, 3].sort((a, b) => pos[a] - pos[b]);
    for (const i of paintOrder) {
      const raw = pos[i];
      const shown = raw <= 1 ? raw : 1 + (raw - 1) * 0.32;
      const drive = Math.max(0.55, Math.min(1.6, effortAt(race, u, i)));
      const x = startX + shown * runLen;
      const gallop = (t * (7.5 + drive * 4.5) + i * 1.7) % (Math.PI * 200);
      drawHorse(ctx, x, groundOf(i), hs, HORSES[i], { P, gallop, drive });
    }
  }

  // ---- the apron in front ----------------------------------
  ctx.fillStyle = P.apron;
  ctx.fillRect(0, TRACK_BOT, VW, VH - TRACK_BOT);
  drawRail(ctx, VW, TRACK_BOT + 5, P);

  // A tiny full-track strip so you can read the whole race at a
  // glance even when the field is bunched.
  const barY = VH - 26;
  rr(ctx, 14, barY, VW - 28, 16, 8);
  ctx.fillStyle = "rgba(247,240,220,0.22)";
  ctx.fill();
  ctx.strokeStyle = "rgba(247,240,220,0.5)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = P.gold;
  ctx.fillRect(VW - 22, barY + 2, 3, 12);
  if (race) {
    const pos = progressAt(race, u);
    const bump = [-4, 0, 0, 4];
    for (let i = 0; i < 4; i += 1) {
      const p = Math.min(1, pos[i]);
      circle(ctx, 22 + p * (VW - 46), barY + 8 + bump[i], 4.6);
      ctx.fillStyle = HORSES[i].color;
      ctx.fill();
      ctx.strokeStyle = "rgba(16,26,20,0.55)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  // ---- the banner ------------------------------------------
  if (phase === "results" && wire && wire.last) {
    const win = HORSES[wire.last.winner] || HORSES[0];
    // A slim ribbon across the dirt strip, NOT a slab over the
    // middle of the track: the finish is the picture, and
    // covering it with a box to announce who won would be a
    // strange thing to do.
    const bw = Math.min(VW - 24, 400);
    rr(ctx, (VW - bw) / 2, STAND_H + 6, bw, 34, 8);
    ctx.fillStyle = P.panel;
    ctx.fill();
    ctx.strokeStyle = P.gold;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const tx = (VW - bw) / 2 + 16;
    ctx.fillStyle = P.gold;
    ctx.font = "700 13px Oswald, 'Arial Narrow', sans-serif";
    ctx.fillText("WINNER", tx, STAND_H + 23);
    circle(ctx, tx + 66, STAND_H + 23, 7);
    paint(ctx, win.color, 1.6);
    ctx.fillStyle = P.text;
    ctx.font = "700 19px Oswald, 'Arial Narrow', sans-serif";
    ctx.fillText(win.name.toUpperCase(), tx + 80, STAND_H + 23);
  }
}

// The one-line status the overlay prints under the track.
export function trackStatus(wire, msLeft, selfBet) {
  if (!wire) return "Walking up to the window…";
  const secs = Math.max(0, Math.ceil(msLeft / 1000));
  if (wire.phase === "betting") {
    if (selfBet) {
      const h = HORSES[selfBet.horse];
      return `You're on ${h ? h.name : "the field"} for $${selfBet.amount} — off in ${secs}s`;
    }
    return `Betting open — ${secs}s to the off`;
  }
  if (wire.phase === "running") return "And they're off!";
  const win = wire.last ? HORSES[wire.last.winner] : null;
  return win ? `${win.name} wins it. Next race in ${secs}s` : `Next race in ${secs}s`;
}
