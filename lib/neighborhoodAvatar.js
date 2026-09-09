// ============================================================
// HSPNeighborhood — avatar model + procedural renderer
// ------------------------------------------------------------
// Single source of truth for what an avatar IS (option catalogs
// + config shape) and what it LOOKS like (drawAvatar). The
// creator screen, the in-world player sprites (milestone 3+),
// and future server-side validation all import from here, so
// the creator preview always matches the game.
//
// The avatar config is one plain JSON object shaped to drop
// straight into the milestone-4 `plaza_players.avatar` jsonb
// column unchanged. normalizeAvatar() is pure (no DOM, no
// window) so gated API routes can sanitize whatever a client
// sends. Keeping model + validation here, out of components,
// is also what makes a later swap to a dedicated socket server
// a backend-only change — the client draw path never moves.
//
// Art rules (approved in milestone 1): all procedural canvas
// primitives, zero image files. Flat bright vectors, thick
// rounded shapes, soft ellipse shadow, straight-on 3/4 view,
// readable at phone size.
// ============================================================

export const AVATAR_VERSION = 1;

// ---- Option catalogs ---------------------------------------
// Every value a config may hold lives in these lists, so the
// server can validate by membership and the creator can render
// its pickers straight from them.

export const SKIN_TONES = [
  "#f9dcc0",
  "#f2c49b",
  "#e2ac74",
  "#c68a52",
  "#a5673d",
  "#8d5524",
  "#6b3f1d",
  "#4a2c14",
];

export const BODY_SHAPES = ["bean", "slim", "broad"];
export const BODY_SIZES = ["short", "medium", "tall"];

export const HAIR_STYLES = [
  "none",
  "buzz",
  "spiky",
  "swoop",
  "bob",
  "curly",
  "ponytail",
  "afro",
];

export const HAIR_COLORS = [
  "#241d18",
  "#4a3220",
  "#7b4a1e",
  "#b0793a",
  "#d9a441",
  "#eede9c",
  "#b9bcc4",
  "#d94f2a",
  "#7e4fd1",
  "#2a9d5c",
  "#2a6bd9",
  "#e05fa0",
];

export const EYE_STYLES = ["normal", "happy", "wide", "sleepy", "wink", "shades"];
export const MOUTH_STYLES = ["smile", "grin", "neutral", "open", "smirk", "tongue"];

export const SHIRT_STYLES = ["tee", "longsleeve", "hoodie", "jersey", "stripes"];
export const SHIRT_COLORS = [
  "#e23b3b",
  "#f28c1b",
  "#f2c81b",
  "#41b649",
  "#2bb3a3",
  "#2a7de1",
  "#6a4fd1",
  "#d94fb0",
  "#f4f4f5",
  "#4b5563",
  "#1f2937",
  "#8b5a2b",
];

export const PANTS_STYLES = ["pants", "shorts", "joggers"];
export const PANTS_COLORS = [
  "#2a4d8f",
  "#1f2937",
  "#4b5563",
  "#6b4a2b",
  "#3e7d3e",
  "#8f2a2a",
  "#d9d9de",
  "#5a3e8f",
];

export const SHOE_STYLES = ["sneakers", "boots", "sandals"];
export const SHOE_COLORS = [
  "#f4f4f5",
  "#241d18",
  "#e23b3b",
  "#2a7de1",
  "#f2c81b",
  "#8b5a2b",
  "#41b649",
  "#d94fb0",
];

// Human-friendly labels for the creator UI.
export const STYLE_LABELS = {
  bean: "Round",
  slim: "Slim",
  broad: "Broad",
  short: "Short",
  medium: "Medium",
  tall: "Tall",
  none: "Bald",
  buzz: "Buzz",
  spiky: "Spiky",
  swoop: "Swoop",
  bob: "Bob",
  curly: "Curly",
  ponytail: "Ponytail",
  afro: "Afro",
  normal: "Normal",
  happy: "Happy",
  wide: "Wide",
  sleepy: "Sleepy",
  wink: "Wink",
  shades: "Shades",
  smile: "Smile",
  grin: "Grin",
  neutral: "Neutral",
  open: "Whoa",
  smirk: "Smirk",
  tongue: "Tongue",
  tee: "Tee",
  longsleeve: "Long Sleeve",
  hoodie: "Hoodie",
  jersey: "Jersey",
  stripes: "Stripes",
  pants: "Pants",
  shorts: "Shorts",
  joggers: "Joggers",
  sneakers: "Sneakers",
  boots: "Boots",
  sandals: "Sandals",
};

function valid(value, list, fallback) {
  return list.includes(value) ? value : fallback !== undefined ? fallback : list[0];
}

// Coerce anything (bad client data, old versions, null) into a
// complete, legal avatar config. Pure — safe on the server.
export function normalizeAvatar(input) {
  const src = input && typeof input === "object" ? input : {};
  const body = src.body && typeof src.body === "object" ? src.body : {};
  const hair = src.hair && typeof src.hair === "object" ? src.hair : {};
  const shirt = src.shirt && typeof src.shirt === "object" ? src.shirt : {};
  const pants = src.pants && typeof src.pants === "object" ? src.pants : {};
  const shoes = src.shoes && typeof src.shoes === "object" ? src.shoes : {};
  return {
    v: AVATAR_VERSION,
    body: {
      shape: valid(body.shape, BODY_SHAPES, "bean"),
      size: valid(body.size, BODY_SIZES, "medium"),
    },
    skin: valid(src.skin, SKIN_TONES, SKIN_TONES[1]),
    hair: {
      style: valid(hair.style, HAIR_STYLES, "swoop"),
      color: valid(hair.color, HAIR_COLORS, HAIR_COLORS[1]),
    },
    eyes: valid(src.eyes, EYE_STYLES, "normal"),
    mouth: valid(src.mouth, MOUTH_STYLES, "smile"),
    shirt: {
      style: valid(shirt.style, SHIRT_STYLES, "tee"),
      color: valid(shirt.color, SHIRT_COLORS, "#2a7de1"),
    },
    pants: {
      style: valid(pants.style, PANTS_STYLES, "pants"),
      color: valid(pants.color, PANTS_COLORS, "#2a4d8f"),
    },
    shoes: {
      style: valid(shoes.style, SHOE_STYLES, "sneakers"),
      color: valid(shoes.color, SHOE_COLORS, "#f4f4f5"),
    },
  };
}

export const DEFAULT_AVATAR = normalizeAvatar({});

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function randomAvatar() {
  return normalizeAvatar({
    body: { shape: pick(BODY_SHAPES), size: pick(BODY_SIZES) },
    skin: pick(SKIN_TONES),
    hair: { style: pick(HAIR_STYLES), color: pick(HAIR_COLORS) },
    eyes: pick(EYE_STYLES),
    mouth: pick(MOUTH_STYLES),
    shirt: { style: pick(SHIRT_STYLES), color: pick(SHIRT_COLORS) },
    pants: { style: pick(PANTS_STYLES), color: pick(PANTS_COLORS) },
    shoes: { style: pick(SHOE_STYLES), color: pick(SHOE_COLORS) },
  });
}

// ---- Rendering ---------------------------------------------

// Design-space height of a medium avatar (feet to top of head),
// for layout math in the rooms later.
export const AVATAR_HEIGHT = 150;

const OUTLINE_ALPHA = 0.28;
const INK = "#2b2620";

// Darken (f < 0) or lighten (f > 0) a #rrggbb color.
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const t = f < 0 ? 0 : 255;
  const p = Math.abs(f);
  r = Math.round(r + (t - r) * p);
  g = Math.round(g + (t - g) * p);
  b = Math.round(b + (t - b) * p);
  return (
    "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)
  );
}

// Build a rounded-rect path (no reliance on ctx.roundRect).
function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// Fill the current path in a flat color with a soft darker
// outline — the house look: thick, rounded, readable small.
function paint(ctx, color) {
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = shade(color, -OUTLINE_ALPHA);
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
}

// ---- the dance (milestone 26) ------------------------------
// Austin's ask: *"Add a dance button too that will make your
// avatar do a little dance for a few seconds."*
//
// The whole routine is a PURE FUNCTION of one number: how long
// ago the dance started. Nothing accumulates and nothing is
// stored, so a tab that was hidden for ten minutes cannot come
// back mid-move — it comes back to a dance that is simply over.
// And because every browser in the room is handed the same
// start timestamp off one server broadcast, four phones
// watching the same dancer hit the same pose on the same frame.
//
// Four beats, then it puts itself away:
//
//   0.00-0.30  bop       two bounces, arms pumping alternately
//   0.30-0.54  step      two side-steps, both arms pointing
//   0.54-0.72  spin      one full turn (scaleX 1 -> -1 -> 1)
//   0.72-0.96  hands up  three quick hops, arms overhead
//   0.96-1.00  settle    the amp ramp puts everything back
//
// `style` (0, 1 or 2) is derived from the dance id on every
// client, so one dance is one routine everywhere, while two
// dances in a row are not quite the same dance.

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Local 0..1 progress inside [a, b) of the overall 0..1 clock,
// or null when this beat is not the one playing.
function beat(u, a, b) {
  return u >= a && u < b ? (u - a) / (b - a) : null;
}

// Everything the dance does to a body, for one instant.
// Angles are radians; a POSITIVE arm angle swings that arm
// toward the left of the screen (canvas y grows downward), so
// "both arms out" is +/- and "both arms pointing that way" is
// the same sign on both.
function danceRig(t, dur, style) {
  const u = clamp01(t / dur);
  // In fast, out gently: nobody pops into a pose, and a dance
  // cut short still leaves the body standing up straight.
  const amp = clamp01(Math.min(t / 0.18, (dur - t) / 0.3));
  const st = (((style | 0) % 3) + 3) % 3;
  const dir = st === 1 ? -1 : 1; // style 1 mirrors the whole routine
  const r = {
    bob: 0,
    lean: 0,
    shiftX: 0,
    squash: 1,
    spinX: 1,
    armL: 0,
    armR: 0,
    legL: 0,
    legR: 0,
  };

  const b1 = beat(u, 0, 0.3);
  const b2 = beat(u, 0.3, 0.54);
  const b3 = beat(u, 0.54, 0.72);
  const b4 = beat(u, 0.72, 0.96);

  if (b1 !== null) {
    const w = b1 * Math.PI * 4; // two bounces
    r.bob = 6 * (0.5 - 0.5 * Math.cos(w));
    r.squash = 1 + 0.05 * Math.cos(w);
    r.lean = 0.06 * Math.sin(b1 * Math.PI * 2) * dir;
    r.armL = 0.6 * (0.5 + 0.5 * Math.sin(w));
    r.armR = -0.6 * (0.5 + 0.5 * Math.sin(w + Math.PI));
    r.legL = -3 * (0.5 + 0.5 * Math.sin(w + Math.PI));
    r.legR = -3 * (0.5 + 0.5 * Math.sin(w));
  } else if (b2 !== null) {
    const k = Math.sin(b2 * Math.PI * 2) * dir; // over and back
    r.shiftX = 10 * k;
    r.lean = 0.11 * k;
    r.bob = 3 * (0.5 - 0.5 * Math.cos(b2 * Math.PI * 4));
    r.armL = 0.8 * k + 0.25;
    r.armR = 0.8 * k - 0.25;
    // the trailing foot comes off the floor
    r.legL = k > 0 ? -5 * k : 0;
    r.legR = k < 0 ? 5 * k : 0;
  } else if (b3 !== null) {
    // The spin is the oldest trick in the sprite book: squash
    // the body flat and out the other side. Cheap, chunky,
    // reads as a turn at phone size.
    r.spinX = Math.cos(b3 * Math.PI * 2 * dir);
    r.bob = 9 * Math.sin(b3 * Math.PI);
    r.squash = 1 + 0.04 * Math.sin(b3 * Math.PI * 2);
    r.armL = 1.2;
    r.armR = -1.2;
  } else if (b4 !== null) {
    const w = b4 * Math.PI * 6; // three quick hops
    r.bob = 5 * (0.5 - 0.5 * Math.cos(w));
    r.lean = 0.07 * Math.sin(w / 3) * dir;
    r.armL = 2.45 + 0.3 * Math.sin(w);
    r.armR = -(2.45 + 0.3 * Math.sin(w + Math.PI));
    r.legL = -2 * (0.5 + 0.5 * Math.sin(w));
    r.legR = -2 * (0.5 + 0.5 * Math.sin(w + Math.PI));
  }

  // The ramp scales the MOVES, never the identity: a scale
  // eases back toward 1, an offset toward 0.
  r.bob *= amp;
  r.lean *= amp;
  r.shiftX *= amp;
  r.armL *= amp;
  r.armR *= amp;
  r.legL *= amp;
  r.legR *= amp;
  r.squash = 1 + (r.squash - 1) * amp;
  r.spinX = 1 + (r.spinX - 1) * amp;
  return r;
}

// Little notes floating off a dancer, so the joke still reads
// on a phone where the footwork is four pixels tall. Drawn
// OUTSIDE the dance transform, or they would spin with the
// body and land back-to-front.
const NOTE_COLORS = [
  ["#f2c81b", "#e23b3b", "#2a7de1"],
  ["#41b649", "#f28c1b", "#d94fb0"],
  ["#6a4fd1", "#2bb3a3", "#f2c81b"],
];

function drawNotes(ctx, t, dur, style, topY, spread) {
  const cols = NOTE_COLORS[(((style | 0) % 3) + 3) % 3];
  const fade = clamp01((dur - t) / 0.45);
  for (let i = 0; i < 3; i++) {
    if (t < 0.25 + i * 0.2) continue; // let the first bounce land first
    const k = (t * 0.85 + i * 0.34) % 1; // 0 at the shoulder, 1 gone
    const alpha = Math.min(1, k * 4) * (1 - k) * fade;
    if (alpha <= 0.02) continue;
    const side = i === 1 ? -1 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(
      side * (spread + 5 * i) + Math.sin(k * Math.PI * 2 + i) * 5,
      topY - 6 - k * 46
    );
    ctx.rotate(Math.sin(k * Math.PI * 3 + i) * 0.25);
    ctx.fillStyle = cols[i];
    ctx.strokeStyle = shade(cols[i], -OUTLINE_ALPHA);
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath(); // stem + flag
    ctx.moveTo(2.5, 3);
    ctx.lineTo(2.5, -9);
    ctx.lineTo(9, -12);
    ctx.lineTo(9, -8.5);
    ctx.lineTo(5.5, -6);
    ctx.lineTo(5.5, 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath(); // the head of the note
    ctx.ellipse(0, 3.5, 4.6, 3.6, -0.3, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Draw an avatar with its feet anchored at (x, y).
 *
 * THE game renderer: rooms in milestone 3+ call this exact
 * function for every player on screen, so the creator preview
 * is always truthful.
 *
 * opts:
 *   shadow  — draw the soft ground ellipse (default true)
 *   frame   — walk-cycle time in seconds; legs/arms swing when
 *             opts.walking is true (wired up in milestone 3,
 *             harmless no-op today)
 *   walking — boolean, see above
 *   dance   — { t, durationMs, style } (milestone 26): t is
 *             seconds since the dance started. Present = this
 *             body is dancing; absent = it is not, which is
 *             also how a dance gets cancelled.
 */
export function drawAvatar(ctx, config, x, y, scale = 1, opts = {}) {
  const a = normalizeAvatar(config);
  const sf = { short: 0.86, medium: 1, tall: 1.14 }[a.body.size];
  const wf = { slim: 0.85, bean: 1, broad: 1.2 }[a.body.shape];

  const legH = 26 * sf;
  const legW = 13;
  const hipHalf = 11 * wf;
  const torsoW = 54 * wf;
  const torsoH = 46 * sf;
  const torsoTop = -(legH + torsoH - 6);
  const headR = 30;
  const headY = torsoTop - headR + 10;
  const skin = a.skin;
  const hairC = a.hair.color;
  const shirtC = a.shirt.color;
  const pantsC = a.pants.color;
  const shoeC = a.shoes.color;

  // milestone 26. Dancing beats walking on the rare frame that
  // claims both (the room drops the dance when you take a step,
  // so this is belt and braces).
  const danceDur =
    opts.dance && Number(opts.dance.durationMs) > 400
      ? Number(opts.dance.durationMs) / 1000
      : 3.6;
  const d =
    opts.dance &&
    typeof opts.dance.t === "number" &&
    opts.dance.t >= 0 &&
    opts.dance.t < danceDur
      ? danceRig(opts.dance.t, danceDur, opts.dance.style || 0)
      : null;

  const swing =
    !d && opts.walking && typeof opts.frame === "number"
      ? Math.sin(opts.frame * 10) * 3
      : 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // Ground shadow
  if (opts.shadow !== false) {
    ctx.beginPath();
    ctx.ellipse(0, 2, torsoW * 0.62, 9, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fill();
  }

  // Everything above the floor rides the dance transform, so a
  // spin spins the whole body and the ground shadow stays where
  // the feet are. Closed at the bottom of this function.
  if (d) {
    ctx.save();
    ctx.translate(d.shiftX, -d.bob);
    ctx.rotate(d.lean);
    ctx.scale(d.spinX, d.squash);
  }

  // Ponytail hangs behind the body.
  if (a.hair.style === "ponytail") {
    rr(ctx, torsoW / 2 - 6, headY + 6, 13, 46, 6.5);
    paint(ctx, hairC);
  }

  // ---- Legs + shoes ----
  const legTop = -legH - 4;
  for (const side of [-1, 1]) {
    const lx = side * hipHalf - legW / 2;
    const lift = side * swing + (d ? (side === -1 ? d.legL : d.legR) : 0);
    const shortsLine = legTop + legH * 0.55;

    if (a.pants.style === "shorts") {
      // Skin lower leg, pants upper leg.
      rr(ctx, lx, shortsLine - 4, legW, -shortsLine + 4 + lift, 5);
      paint(ctx, skin);
      rr(ctx, lx - 1, legTop, legW + 2, legH * 0.55 + 4, 6);
      paint(ctx, pantsC);
    } else {
      rr(ctx, lx, legTop, legW, legH + 4 + lift, 6);
      paint(ctx, pantsC);
      if (a.pants.style === "joggers") {
        // Cuff band above the shoe.
        rr(ctx, lx - 1, -9 + lift, legW + 2, 6, 3);
        paint(ctx, shade(pantsC, 0.35));
      }
    }

    // Shoe
    const sy = lift * 0.6;
    if (a.shoes.style === "boots") {
      rr(ctx, lx - 2, -16 + sy, legW + 6, 17, 6);
      paint(ctx, shoeC);
    } else if (a.shoes.style === "sandals") {
      rr(ctx, lx - 2, -6 + sy, legW + 6, 8, 4);
      paint(ctx, shoeC);
    } else {
      rr(ctx, lx - 2, -12 + sy, legW + 6, 13, 6);
      paint(ctx, shoeC);
      rr(ctx, lx - 2, -5 + sy, legW + 6, 6, 3);
      paint(ctx, "#ffffff");
    }
  }

  // ---- Torso ----
  const torsoR = a.body.shape === "bean" ? 20 : 14;
  rr(ctx, -torsoW / 2, torsoTop, torsoW, torsoH + 2, torsoR);
  paint(ctx, shirtC);

  // Shirt decoration
  if (a.shirt.style === "stripes") {
    ctx.save();
    rr(ctx, -torsoW / 2, torsoTop, torsoW, torsoH + 2, torsoR);
    ctx.clip();
    ctx.fillStyle = shade(shirtC, 0.45);
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(-torsoW / 2, torsoTop + 8 + i * 14, torsoW, 6);
    }
    ctx.restore();
  } else if (a.shirt.style === "jersey") {
    ctx.save();
    rr(ctx, -torsoW / 2, torsoTop, torsoW, torsoH + 2, torsoR);
    ctx.clip();
    ctx.fillStyle = shade(shirtC, 0.55);
    ctx.fillRect(-torsoW / 2, torsoTop, 8, torsoH + 2);
    ctx.fillRect(torsoW / 2 - 8, torsoTop, 8, torsoH + 2);
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = shade(shirtC, 0.75);
    ctx.fillText("1", 0, torsoTop + torsoH / 2 + 1);
    ctx.restore();
  } else if (a.shirt.style === "hoodie") {
    // Pocket + drawstrings + hood bump behind the neck.
    rr(ctx, -14, torsoTop + torsoH - 20, 28, 14, 6);
    paint(ctx, shade(shirtC, -0.14));
    ctx.fillStyle = shade(shirtC, 0.6);
    circle(ctx, -6, torsoTop + 10, 2.2);
    ctx.fill();
    circle(ctx, 6, torsoTop + 10, 2.2);
    ctx.fill();
    rr(ctx, -16, torsoTop - 5, 32, 10, 5);
    paint(ctx, shade(shirtC, -0.12));
  }

  // ---- Arms ----
  const armX = torsoW / 2 + 3;
  const armLen = torsoH * 0.8;
  const armW = 12;
  const sleeve =
    a.shirt.style === "tee" || a.shirt.style === "jersey"
      ? 0.45
      : a.shirt.style === "stripes"
        ? 0.45
        : 0.85;
  for (const side of [-1, 1]) {
    const ax = side * armX - armW / 2 + side * 2;
    const armLift = -side * swing * 0.8;
    // Walking slides an arm; dancing swings the whole thing
    // about its shoulder, which is what buys the wave and the
    // hands-in-the-air finish (milestone 26).
    const armRot = d ? (side === -1 ? d.armL : d.armR) : 0;
    const shoulder = { x: ax + armW / 2, y: torsoTop + 8 };
    if (armRot) {
      ctx.save();
      ctx.translate(shoulder.x, shoulder.y);
      ctx.rotate(armRot);
      ctx.translate(-shoulder.x, -shoulder.y);
    }
    // Skin part first (peeks out below the sleeve)
    rr(ctx, ax, torsoTop + 6 + armLift, armW, armLen, 6);
    paint(ctx, skin);
    // Sleeve over the top
    rr(ctx, ax - 1, torsoTop + 4 + armLift, armW + 2, armLen * sleeve, 6);
    paint(ctx, shirtC);
    if (armRot) ctx.restore();
  }

  // ---- Head + hair + face ----
  const wrap = a.hair.style === "bob" || a.hair.style === "afro";

  if (wrap) {
    if (a.hair.style === "afro") {
      circle(ctx, 0, headY - 6, headR + 9);
      paint(ctx, hairC);
    } else {
      // Bob: big rounded mass, flat-ish bottom at the jaw.
      rr(ctx, -headR - 6, headY - headR - 7, headR * 2 + 12, headR * 2 + 8, 26);
      paint(ctx, hairC);
    }
    // Face window
    circle(ctx, 0, headY + 4, headR - 5);
    paint(ctx, skin);
  } else {
    circle(ctx, 0, headY, headR);
    paint(ctx, skin);

    const capTop = headY - headR;
    if (a.hair.style === "buzz" || a.hair.style === "spiky" || a.hair.style === "swoop" || a.hair.style === "curly" || a.hair.style === "ponytail") {
      // Base cap with a flat hairline above the eyes.
      ctx.beginPath();
      ctx.arc(0, headY, headR + 1.5, Math.PI * 1.09, Math.PI * 1.91);
      ctx.closePath();
      paint(ctx, hairC);
    }
    if (a.hair.style === "spiky") {
      ctx.beginPath();
      for (let i = -2; i <= 2; i++) {
        const sx = i * 11;
        ctx.moveTo(sx - 6, capTop + 7);
        ctx.lineTo(sx, capTop - 9 - (i === 0 ? 3 : 0));
        ctx.lineTo(sx + 6, capTop + 7);
      }
      ctx.closePath();
      paint(ctx, hairC);
    } else if (a.hair.style === "swoop") {
      // Fringe swooping across the forehead.
      ctx.beginPath();
      ctx.moveTo(-headR - 1, headY - 7);
      ctx.quadraticCurveTo(-headR + 8, headY + 6, -2, headY - 4);
      ctx.quadraticCurveTo(headR - 4, headY - 14, headR - 2, headY - 9);
      ctx.arc(0, headY, headR + 1.5, -0.3, Math.PI + 0.25, true);
      ctx.closePath();
      paint(ctx, hairC);
    } else if (a.hair.style === "curly") {
      for (let i = -2; i <= 2; i++) {
        const t = (i / 2) * 1.15;
        circle(ctx, Math.sin(t) * (headR - 2), headY - Math.cos(t) * (headR - 2) - 3, 10);
        paint(ctx, hairC);
      }
    } else if (a.hair.style === "ponytail") {
      // Topknot base the tail hangs from.
      circle(ctx, headR * 0.62, capTop + 6, 9);
      paint(ctx, hairC);
    } else if (a.hair.style === "none") {
      // A little shine on the dome.
      ctx.beginPath();
      ctx.arc(-9, headY - headR + 12, 8, Math.PI * 1.05, Math.PI * 1.6);
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }

  // Blush
  ctx.fillStyle = "rgba(255,110,110,0.22)";
  circle(ctx, -16, headY + 9, 5);
  ctx.fill();
  circle(ctx, 16, headY + 9, 5);
  ctx.fill();

  // Eyes (kept below the hairline)
  const eyeY = headY + 1;
  ctx.lineCap = "round";
  if (a.eyes === "shades") {
    rr(ctx, -22, eyeY - 7, 19, 13, 5);
    paint(ctx, INK);
    rr(ctx, 3, eyeY - 7, 19, 13, 5);
    paint(ctx, INK);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-3, eyeY - 2);
    ctx.lineTo(3, eyeY - 2);
    ctx.stroke();
  } else {
    for (const side of [-1, 1]) {
      const ex = side * 11;
      const styleHere =
        a.eyes === "wink" ? (side === 1 ? "closed" : "normal") : a.eyes;
      if (styleHere === "happy") {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(ex, eyeY + 2, 5, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      } else if (styleHere === "sleepy") {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(ex, eyeY - 3, 5, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      } else if (styleHere === "closed") {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(ex - 5, eyeY);
        ctx.lineTo(ex + 5, eyeY);
        ctx.stroke();
      } else {
        const r = styleHere === "wide" ? 5 : 3.6;
        circle(ctx, ex, eyeY, r);
        ctx.fillStyle = INK;
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        circle(ctx, ex - r * 0.3, eyeY - r * 0.35, r * 0.32);
        ctx.fill();
      }
    }
  }

  // Mouth
  const mouthY = headY + 14;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  if (a.mouth === "smile") {
    ctx.beginPath();
    ctx.arc(0, mouthY - 3, 8, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  } else if (a.mouth === "grin") {
    ctx.beginPath();
    ctx.arc(0, mouthY - 2, 9, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.rect(-7, mouthY - 2, 14, 3.5);
    ctx.fill();
  } else if (a.mouth === "neutral") {
    ctx.beginPath();
    ctx.moveTo(-6, mouthY);
    ctx.lineTo(6, mouthY);
    ctx.stroke();
  } else if (a.mouth === "open") {
    ctx.beginPath();
    ctx.ellipse(0, mouthY, 5.5, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  } else if (a.mouth === "smirk") {
    ctx.beginPath();
    ctx.moveTo(-4, mouthY + 1);
    ctx.quadraticCurveTo(4, mouthY + 2, 9, mouthY - 4);
    ctx.stroke();
  } else if (a.mouth === "tongue") {
    ctx.beginPath();
    ctx.arc(0, mouthY - 3, 8, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(3, mouthY + 3, 4.5, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = "#f2739b";
    ctx.fill();
    ctx.strokeStyle = shade("#f2739b", -OUTLINE_ALPHA);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (d) {
    ctx.restore(); // out of the dance transform
    drawNotes(ctx, opts.dance.t, danceDur, opts.dance.style || 0, headY - headR, torsoW * 0.55);
  }

  ctx.restore();
}
