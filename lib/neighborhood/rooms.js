// ============================================================
// HSPNeighborhood — room registry (config-as-data)
// ------------------------------------------------------------
// A room is ONE entry in ROOMS. Everything the engine
// (components/NeighborhoodRoom) and the pathfinder
// (lib/neighborhood/pathing) need hangs off that object:
//
//   id / name / capacity   identity + milestone-4 join cap
//   width / height         world size in px
//   spawn                  where new arrivals stand
//   palette.light/.dark    every color, per site theme
//   walkable               polygon the feet may stand in
//   props[]                { x, y (feet anchor), draw fn,
//                            footprint rect that blocks
//                            walking, optional sortY } —
//                          props are Y-depth-sorted with
//                          players every frame
//   exits[]                door hotspots; walking onto one
//                          takes the player to `roomId`,
//                          appearing at that room's `arrive`
//                          point (roomId null = "opening
//                          soon" nudge)
//   buildings[]            facade data used by the background
//   drawBackground         paints everything that never sorts
//                          against players (sky, ground,
//                          facades) — cached offscreen
//
// Adding a room = one more entry here (milestone 6 did exactly
// that for the three shop interiors below). Draw fns receive a
// ctx but the module itself never touches window/document, so
// server code can import it for spawn/walkable/capacity data.
//
// Art rules (milestone 1): procedural vectors only, flat
// bright fills with a soft darker outline, thick rounded
// shapes, straight-on 3/4 view (lower on screen = closer),
// soft ellipse shadows.
// ============================================================

// ---- paint helpers (same look as lib/neighborhoodAvatar) ----

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
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

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

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
}

function ell(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.closePath();
}

// Flat fill + soft darker outline — the house style.
function paint(ctx, color, lw = 2.5) {
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = shade(color, -0.28);
  ctx.lineWidth = lw;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function softShadow(ctx, x, y, rx, ry) {
  ell(ctx, x, y, rx, ry);
  ctx.fillStyle = "rgba(0,0,0,0.14)";
  ctx.fill();
}

// ---- Town Square palettes ----------------------------------
// Same square, two times of day: daytime for the light theme,
// dusk (lit windows, glowing lamps) for the dark theme.

const TOWN_LIGHT = {
  outside: "#69b657",
  sky: "#a9def7",
  cloud: "#ffffff",
  hill: "#8fd072",
  grass: "#7cc464",
  plaza: "#ecdcba",
  plazaLine: "rgba(120,95,55,0.20)",
  plazaEdge: "#c8ac77",
  ring: "#f4ead0",
  stone: "#ccd1da",
  stoneDark: "#aeb5c2",
  water: "#57c3e8",
  waterHi: "#b5eafa",
  wood: "#a9743c",
  woodDark: "#875a2c",
  leaf: "#4fae52",
  leafDark: "#3f9a47",
  hedge: "#3f9a47",
  lampPost: "#3c4454",
  lampGlass: "#fff6d8",
  lampGlow: null,
  windowGlass: "#bfe6f7",
  doorWood: "#8a5c34",
  ink: "#2b2620",
  cream: "#f7f0dc",
  marker: "rgba(0,87,184,0.7)",
};

const TOWN_DARK = {
  outside: "#2e5b3c",
  sky: "#25315b",
  cloud: "#3a4a77",
  hill: "#3f7c4c",
  grass: "#457f4b",
  plaza: "#a5926f",
  plazaLine: "rgba(30,24,14,0.28)",
  plazaEdge: "#7d6b4c",
  ring: "#b3a17e",
  stone: "#9aa0ad",
  stoneDark: "#7a8190",
  water: "#3e88b8",
  waterHi: "#7cc4e0",
  wood: "#7d5630",
  woodDark: "#5f4023",
  leaf: "#33793f",
  leafDark: "#295f33",
  hedge: "#2f6b39",
  lampPost: "#2c3340",
  lampGlass: "#ffd97a",
  lampGlow: "rgba(255,214,110,0.30)",
  windowGlass: "#ffd97a",
  doorWood: "#6b4527",
  ink: "#241f1a",
  cream: "#e8dfc8",
  marker: "rgba(255,255,255,0.8)",
};

// ---- background: sky, ground, plaza, building facades ------

const PLAZA_TOP = 500; // ground line the facades stand on
const FACADE_TOP = 192;

function drawCloud(ctx, x, y, s, color) {
  ctx.fillStyle = color;
  ell(ctx, x, y, 44 * s, 16 * s);
  ctx.fill();
  ell(ctx, x - 24 * s, y + 4 * s, 26 * s, 12 * s);
  ctx.fill();
  ell(ctx, x + 26 * s, y + 5 * s, 28 * s, 12 * s);
  ctx.fill();
}

function drawCrate(ctx, x, y, fruit, P) {
  rr(ctx, x - 26, y - 32, 52, 32, 5);
  paint(ctx, P.wood, 2.5);
  ctx.strokeStyle = shade(P.wood, -0.28);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 26, y - 22);
  ctx.lineTo(x + 26, y - 22);
  ctx.stroke();
  for (const fx of [-14, 0, 14]) {
    circle(ctx, x + fx, y - 32, 8);
    paint(ctx, fruit, 2);
  }
}

function drawBuilding(ctx, b, P, theme) {
  const dark = theme === "dark";
  const dim = (c) => (dark ? shade(c, -0.38) : c);
  const cx = b.x + b.w / 2;

  // contact shadow where the facade meets the ground
  ell(ctx, cx, PLAZA_TOP + 4, b.w * 0.52, 10);
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fill();

  // facade + parapet roof
  rr(ctx, b.x, FACADE_TOP, b.w, PLAZA_TOP - FACADE_TOP + 3, 10);
  paint(ctx, dim(b.body), 3);
  rr(ctx, b.x - 10, FACADE_TOP - 26, b.w + 20, 36, 9);
  paint(ctx, dim(b.roof), 3);

  // hanging sign
  const signW = Math.min(b.w - 56, 220);
  rr(ctx, cx - signW / 2, FACADE_TOP + 24, signW, 54, 10);
  paint(ctx, dim(b.signBg), 3);
  if (b.style === "sportsbar") {
    // neon-ish rim
    rr(ctx, cx - signW / 2 + 5, FACADE_TOP + 29, signW - 10, 44, 8);
    ctx.strokeStyle = P.waterHi;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.font = "700 27px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = b.signText;
  ctx.fillText(b.sign, cx + (b.style === "fastfood" ? 16 : 0), FACADE_TOP + 53);
  if (b.style === "fastfood") {
    // little burger next to the word
    const bx = cx - signW / 2 + 34;
    const by = FACADE_TOP + 56;
    ctx.beginPath();
    ctx.arc(bx, by - 6, 15, Math.PI, 0);
    ctx.closePath();
    paint(ctx, "#f2c81b", 2);
    rr(ctx, bx - 15, by - 6, 30, 6, 3);
    paint(ctx, "#8a5230", 2);
    rr(ctx, bx - 17, by, 34, 7, 3.5);
    paint(ctx, "#f2c81b", 2);
  }

  // windows (lit after dark)
  const winY = 318;
  const winW = 58;
  const winH = 64;
  for (const wx of b.windows) {
    rr(ctx, wx - winW / 2, winY, winW, winH, 8);
    paint(ctx, dark ? "#ffd97a" : P.windowGlass, 2.5);
    if (b.style === "sportsbar") {
      // TV glow in the window
      rr(ctx, wx - 18, winY + 14, 36, 24, 4);
      paint(ctx, dark ? "#bfe9ff" : "#7cc4e0", 2);
    }
    ctx.strokeStyle = "rgba(43,38,32,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wx, winY + 4);
    ctx.lineTo(wx, winY + winH - 4);
    ctx.moveTo(wx - winW / 2 + 4, winY + winH / 2);
    ctx.lineTo(wx + winW / 2 - 4, winY + winH / 2);
    ctx.stroke();
    rr(ctx, wx - winW / 2 - 5, winY + winH, winW + 10, 8, 3);
    paint(ctx, dim(b.roof), 2);
  }

  // scalloped awning over the door
  const awY = 352;
  const awW = 118;
  rr(ctx, cx - awW / 2, awY, awW, 16, 5);
  paint(ctx, dim(b.awning), 2.5);
  for (let i = 0; i < 4; i++) {
    const sx = cx - awW / 2 + awW / 8 + (i * awW) / 4;
    ctx.beginPath();
    ctx.arc(sx, awY + 15, awW / 8, 0, Math.PI);
    ctx.closePath();
    paint(ctx, i % 2 === 0 ? dim(b.awning) : dim(b.awningAlt), 2.5);
  }

  // the door itself (tappable — walk over to head inside)
  const dW = 66;
  const dTop = 392;
  rr(ctx, cx - dW / 2, dTop, dW, PLAZA_TOP - dTop, 12);
  paint(ctx, P.doorWood, 3);
  rr(ctx, cx - dW / 2 + 10, dTop + 12, dW - 20, 34, 8);
  paint(ctx, dark ? "#ffd97a" : P.windowGlass, 2);
  circle(ctx, cx + dW / 2 - 14, dTop + 60, 4);
  paint(ctx, "#e8c454", 1.5);

  // per-shop flavor
  if (b.style === "grocery") {
    drawCrate(ctx, b.x + 44, PLAZA_TOP, "#e2543f", P);
    drawCrate(ctx, b.x + b.w - 44, PLAZA_TOP, "#f2a41b", P);
  } else if (b.style === "sportsbar") {
    const px = b.x + b.w - 34;
    ctx.strokeStyle = P.lampPost;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(px, FACADE_TOP - 26);
    ctx.lineTo(px, FACADE_TOP - 72);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px, FACADE_TOP - 72);
    ctx.lineTo(px - 52, FACADE_TOP - 62);
    ctx.lineTo(px, FACADE_TOP - 52);
    ctx.closePath();
    paint(ctx, "#e2543f", 2.5);
  }
}

function polyPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

// Fixed star positions so the dusk sky doesn't twinkle-shift
// between background repaints.
const STARS = [
  [60, 48], [150, 92], [255, 40], [352, 110], [420, 58], [520, 96],
  [590, 34], [680, 120], [742, 64], [905, 118], [940, 40], [210, 140],
];

function drawTownBackground(ctx, room, theme) {
  const P = room.palette[theme];
  const W = room.width;
  const H = room.height;

  // sky
  ctx.fillStyle = P.sky;
  ctx.fillRect(0, 0, W, 520);
  if (theme === "dark") {
    ctx.fillStyle = "#dfe6ff";
    for (const [sx, sy] of STARS) ctx.fillRect(sx, sy, 2.5, 2.5);
    circle(ctx, 828, 84, 30);
    paint(ctx, "#f4eecb", 2.5);
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    circle(ctx, 818, 76, 7);
    ctx.fill();
    circle(ctx, 838, 94, 5);
    ctx.fill();
  } else {
    drawCloud(ctx, 150, 86, 1, P.cloud);
    drawCloud(ctx, 700, 58, 0.8, P.cloud);
    drawCloud(ctx, 430, 126, 0.65, P.cloud);
  }

  // rolling hills peeking behind the roofline
  ctx.fillStyle = P.hill;
  ell(ctx, 150, 470, 270, 95);
  ctx.fill();
  ell(ctx, 620, 480, 340, 115);
  ctx.fill();
  ell(ctx, 910, 470, 240, 90);
  ctx.fill();

  // grass everywhere south of the hills; the plaza sits on top
  ctx.fillStyle = P.grass;
  ctx.fillRect(0, 455, W, H - 455);

  // shop fronts
  for (const b of room.buildings) drawBuilding(ctx, b, P, theme);

  // hedges plug the alley gaps between shops
  for (const hx of [338, 622]) {
    ell(ctx, hx, 494, 26, 20);
    paint(ctx, P.hedge, 2.5);
  }

  // plaza slab: curb first, slab over it (stroke fattens +
  // rounds the polygon so corners look poured, not vector-y)
  polyPath(ctx, room.walkable);
  ctx.lineJoin = "round";
  ctx.strokeStyle = P.plazaEdge;
  ctx.lineWidth = 34;
  ctx.stroke();
  polyPath(ctx, room.walkable);
  ctx.fillStyle = P.plaza;
  ctx.fill();
  ctx.strokeStyle = P.plaza;
  ctx.lineWidth = 22;
  ctx.stroke();

  // paver joints (running bond), clipped to the slab
  ctx.save();
  polyPath(ctx, room.walkable);
  ctx.clip();
  ctx.strokeStyle = P.plazaLine;
  ctx.lineWidth = 2;
  let row = 0;
  for (let y = 538; y < H; y += 56, row++) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    const off = row % 2 === 0 ? 22 : 68;
    for (let x = off; x < W; x += 92) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, Math.min(y + 56, H));
      ctx.stroke();
    }
  }
  // lighter paver ring under the fountain
  ell(ctx, 480, 872, 205, 118);
  ctx.fillStyle = P.ring;
  ctx.fill();
  ctx.strokeStyle = P.plazaLine;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // welcome mats at the three doors
  ctx.fillStyle = "rgba(0,0,0,0.10)";
  for (const e of room.exits) {
    ell(ctx, e.approach.x, 514, 46, 10);
    ctx.fill();
  }
}

// ---- props (Y-depth-sorted against players every frame) ----
// Draw signature: (ctx, prop, P, theme, t) with t in seconds
// for ambient animation. All draw with feet at (prop.x, prop.y).

function drawTree(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 46, 11);
  rr(ctx, p.x - 10, p.y - 64, 20, 66, 8);
  paint(ctx, P.wood, 2.5);
  circle(ctx, p.x - 27, p.y - 90, 34);
  paint(ctx, P.leafDark, 3);
  circle(ctx, p.x + 27, p.y - 90, 34);
  paint(ctx, P.leafDark, 3);
  circle(ctx, p.x, p.y - 120, 41);
  paint(ctx, P.leaf, 3);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  circle(ctx, p.x - 12, p.y - 132, 12);
  ctx.fill();
}

function drawBench(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 62, 10);
  for (const s of [-1, 1]) {
    rr(ctx, p.x + s * 48 - 5, p.y - 30, 10, 30, 3);
    paint(ctx, P.woodDark, 2);
  }
  for (const s of [-1, 1]) {
    rr(ctx, p.x + s * 48 - 4, p.y - 70, 8, 34, 3);
    paint(ctx, P.woodDark, 2);
  }
  rr(ctx, p.x - 58, p.y - 78, 116, 12, 6);
  paint(ctx, P.wood, 2.5);
  rr(ctx, p.x - 58, p.y - 42, 116, 13, 6);
  paint(ctx, P.wood, 2.5);
}

function drawLamp(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 20, 7);
  if (P.lampGlow) {
    circle(ctx, p.x, p.y - 120, 46);
    ctx.fillStyle = P.lampGlow;
    ctx.fill();
  }
  ell(ctx, p.x, p.y - 4, 14, 8);
  paint(ctx, P.lampPost, 2);
  rr(ctx, p.x - 4, p.y - 114, 8, 112, 4);
  paint(ctx, P.lampPost, 2);
  circle(ctx, p.x, p.y - 122, 13);
  paint(ctx, P.lampGlass, 2.5);
  rr(ctx, p.x - 9, p.y - 141, 18, 8, 3);
  paint(ctx, P.lampPost, 2);
}

function drawFountain(ctx, p, P, theme, t) {
  const x = p.x;
  const y = p.y;
  const wallTop = y - 62;
  const wallBot = y - 26;
  softShadow(ctx, x, y - 24, 132, 44);
  // basin wall as a squat cylinder
  ell(ctx, x, wallBot, 122, 38);
  paint(ctx, P.stoneDark, 3);
  ctx.fillStyle = P.stoneDark;
  ctx.fillRect(x - 122, wallTop, 244, wallBot - wallTop);
  ctx.strokeStyle = shade(P.stoneDark, -0.28);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x - 122, wallTop);
  ctx.lineTo(x - 122, wallBot);
  ctx.moveTo(x + 122, wallTop);
  ctx.lineTo(x + 122, wallBot);
  ctx.stroke();
  // rim + water
  ell(ctx, x, wallTop, 122, 38);
  paint(ctx, P.stone, 3);
  ell(ctx, x, wallTop + 2, 104, 30);
  paint(ctx, P.water, 2.5);
  // expanding ripples
  for (let i = 0; i < 2; i++) {
    const ph = (t * 0.45 + i * 0.5) % 1;
    ctx.globalAlpha = 0.55 * (1 - ph);
    ell(ctx, x, wallTop + 2, 18 + ph * 82, (18 + ph * 82) * 0.28);
    ctx.strokeStyle = P.waterHi;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // pedestal + top bowl
  rr(ctx, x - 13, y - 134, 26, 76, 9);
  paint(ctx, P.stone, 2.5);
  ell(ctx, x, y - 134, 40, 13);
  paint(ctx, P.stone, 2.5);
  ell(ctx, x, y - 136, 30, 9);
  paint(ctx, P.water, 2);
  // center jet, gently pulsing
  const jh = 26 + Math.sin(t * 4) * 4;
  ctx.fillStyle = P.waterHi;
  rr(ctx, x - 3.5, y - 136 - jh, 7, jh, 3.5);
  ctx.fill();
  circle(ctx, x, y - 138 - jh, 6);
  ctx.fill();
  // streams falling from the bowl into the basin
  ctx.strokeStyle = P.waterHi;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + s * 30, y - 132);
    ctx.quadraticCurveTo(
      x + s * 48,
      y - 100,
      x + s * 54,
      wallTop + 4 + Math.sin(t * 6 + s) * 2
    );
    ctx.stroke();
  }
  // stray droplets
  ctx.fillStyle = P.waterHi;
  for (const s of [-1, 1]) {
    const ph = (t * 1.3 + (s + 1) * 0.25) % 1;
    circle(ctx, x + s * (34 + ph * 20), y - 130 + ph * 62, 3);
    ctx.fill();
  }
}

function drawWelcomeSign(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 84, 11);
  for (const s of [-1, 1]) {
    rr(ctx, p.x + s * 62 - 6, p.y - 96, 12, 96, 5);
    paint(ctx, P.woodDark, 2.5);
  }
  rr(ctx, p.x - 88, p.y - 140, 176, 76, 12);
  paint(ctx, P.wood, 3);
  rr(ctx, p.x - 78, p.y - 130, 156, 56, 8);
  paint(ctx, P.cream, 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.ink;
  ctx.font = "600 12px Inter, system-ui, sans-serif";
  ctx.fillText("WELCOME TO THE", p.x, p.y - 115);
  ctx.font = "700 24px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillText("TOWN SQUARE", p.x, p.y - 91);
}

const FLOWER_COLORS = ["#e2543f", "#f2c81b", "#d94fb0", "#f28c1b", "#e2543f"];

function drawFlowerBed(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 36, 8);
  ell(ctx, p.x, p.y - 6, 34, 13);
  paint(ctx, P.leafDark, 2.5);
  FLOWER_COLORS.forEach((c, i) => {
    const fx = p.x - 24 + i * 12;
    circle(ctx, fx, p.y - 14 - (i % 2) * 6, 6);
    paint(ctx, c, 1.5);
  });
}

// ---- the Town Square ---------------------------------------

const TOWN_SQUARE = {
  id: "town-square",
  name: "Town Square",
  capacity: 24, // enforced by the milestone-4 join API
  width: 960,
  height: 1220,
  spawn: { x: 480, y: 1012 },
  palette: { light: TOWN_LIGHT, dark: TOWN_DARK },

  // Feet may stand inside this polygon (minus prop footprints).
  walkable: [
    { x: 30, y: 510 },
    { x: 930, y: 510 },
    { x: 945, y: 568 },
    { x: 945, y: 1152 },
    { x: 892, y: 1186 },
    { x: 68, y: 1186 },
    { x: 15, y: 1152 },
    { x: 15, y: 568 },
  ],

  // Facade data consumed by drawTownBackground.
  buildings: [
    {
      id: "grocery-store",
      style: "grocery",
      x: 36,
      w: 288,
      body: "#f2e9d2",
      roof: "#3fae5f",
      awning: "#3fae5f",
      awningAlt: "#f7f0dc",
      signBg: "#3fae5f",
      signText: "#ffffff",
      sign: "GROCERY",
      windows: [96, 264],
    },
    {
      id: "fast-food",
      style: "fastfood",
      x: 352,
      w: 256,
      body: "#f6d75a",
      roof: "#e2543f",
      awning: "#e2543f",
      awningAlt: "#f7f0dc",
      signBg: "#f7f0dc",
      signText: "#e2543f",
      sign: "BURGERS",
      windows: [400, 560],
    },
    {
      id: "sports-bar",
      style: "sportsbar",
      x: 636,
      w: 288,
      body: "#31415e",
      roof: "#22304a",
      awning: "#2a7de1",
      awningAlt: "#f7f0dc",
      signBg: "#22304a",
      signText: "#7cc4e0",
      sign: "SPORTS BAR",
      windows: [700, 868],
    },
  ],

  // Tapping a hotspot walks the player to `approach`; arriving
  // there steps through the door into `roomId`, appearing at
  // that room's `arrive` point (milestone 6).
  exits: [
    {
      id: "grocery-store",
      label: "Grocery Store",
      roomId: "grocery-store",
      hotspot: { x: 36, y: 166, w: 288, h: 338 },
      approach: { x: 180, y: 548 },
      arrive: { x: 380, y: 800 },
    },
    {
      id: "fast-food",
      label: "Fast Food Place",
      roomId: "fast-food",
      hotspot: { x: 352, y: 166, w: 256, h: 338 },
      approach: { x: 480, y: 548 },
      arrive: { x: 360, y: 742 },
    },
    {
      id: "sports-bar",
      label: "Sports Bar",
      roomId: "sports-bar",
      hotspot: { x: 636, y: 166, w: 288, h: 338 },
      approach: { x: 780, y: 548 },
      arrive: { x: 400, y: 795 },
    },
  ],

  // footprint = floor rect the pathfinder must route around.
  props: [
    { id: "fountain", x: 480, y: 890, draw: drawFountain, footprint: { x: 352, y: 806, w: 256, h: 94 } },
    { id: "bench-l", x: 185, y: 985, draw: drawBench, footprint: { x: 121, y: 953, w: 128, h: 36 } },
    { id: "bench-r", x: 775, y: 985, draw: drawBench, footprint: { x: 711, y: 953, w: 128, h: 36 } },
    { id: "tree-tl", x: 85, y: 592, draw: drawTree, footprint: { x: 63, y: 576, w: 44, h: 18 } },
    { id: "tree-tr", x: 875, y: 592, draw: drawTree, footprint: { x: 853, y: 576, w: 44, h: 18 } },
    { id: "tree-bl", x: 105, y: 1152, draw: drawTree, footprint: { x: 83, y: 1136, w: 44, h: 18 } },
    { id: "tree-br", x: 855, y: 1152, draw: drawTree, footprint: { x: 833, y: 1136, w: 44, h: 18 } },
    { id: "lamp-l", x: 330, y: 690, draw: drawLamp, footprint: { x: 316, y: 678, w: 28, h: 14 } },
    { id: "lamp-r", x: 630, y: 690, draw: drawLamp, footprint: { x: 616, y: 678, w: 28, h: 14 } },
    { id: "sign", x: 480, y: 1146, draw: drawWelcomeSign, footprint: { x: 406, y: 1130, w: 148, h: 18 } },
    { id: "flowers-l", x: 260, y: 556, draw: drawFlowerBed, footprint: { x: 226, y: 544, w: 68, h: 14 } },
    { id: "flowers-r", x: 700, y: 556, draw: drawFlowerBed, footprint: { x: 666, y: 544, w: 68, h: 14 } },
  ],

  drawBackground: drawTownBackground,
};

// ============================================================
// Interiors (milestone 6) — the three shops off the square.
// Each one is just another ROOMS entry: smaller world, its own
// palette pair, walkable floor, props and a door back out.
// Interiors sit behind a cutaway front wall (the dark rim at
// the bottom edge) with the exit mat standing in for the door
// you came through.
// ============================================================

// ---- shared interior pieces --------------------------------

function drawExitMat(ctx, x, y, P) {
  softShadow(ctx, x, y + 14, 78, 12);
  rr(ctx, x - 74, y - 26, 148, 44, 14);
  paint(ctx, P.mat, 2.5);
  ctx.font = "700 13px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.matText;
  ctx.fillText("TOWN SQUARE", x, y - 7);
  ctx.beginPath();
  ctx.moveTo(x - 7, y + 5);
  ctx.lineTo(x + 7, y + 5);
  ctx.lineTo(x, y + 14);
  ctx.closePath();
  ctx.fillStyle = P.matText;
  ctx.fill();
}

// Cutaway front wall: a dark rim across the bottom edge so the
// room reads as "camera looking in over the fourth wall".
function drawFrontRim(ctx, room) {
  ctx.fillStyle = "rgba(20,14,8,0.30)";
  ctx.fillRect(0, room.height - 16, room.width, 16);
}

function checkerFloor(ctx, room, wallY, a, b, tile = 44) {
  ctx.fillStyle = a;
  ctx.fillRect(0, wallY, room.width, room.height - wallY);
  ctx.fillStyle = b;
  for (let r = 0; r * tile + wallY < room.height; r++) {
    for (let c = 0; c * tile < room.width; c++) {
      if ((r + c) % 2 === 0) {
        ctx.fillRect(c * tile, wallY + r * tile, tile, tile);
      }
    }
  }
}

function plankFloor(ctx, room, wallY, base, line) {
  ctx.fillStyle = base;
  ctx.fillRect(0, wallY, room.width, room.height - wallY);
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  let row = 0;
  for (let y = wallY + 34; y < room.height; y += 34, row++) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(room.width, y);
    ctx.stroke();
    const off = row % 2 === 0 ? 46 : 118;
    for (let x = off; x < room.width; x += 150) {
      ctx.beginPath();
      ctx.moveTo(x, y - 34);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }
}

function wallAndBase(ctx, room, wallY, P) {
  ctx.fillStyle = P.wall;
  ctx.fillRect(0, 0, room.width, wallY);
  rr(ctx, -6, wallY - 14, room.width + 12, 18, 4);
  paint(ctx, P.baseboard, 2);
}

// ---- Grocery Store -----------------------------------------

const GROCERY_LIGHT = {
  outside: "#43604a",
  marker: "rgba(0,87,184,0.7)",
  wall: "#dff0df",
  wallLine: "rgba(63,122,70,0.16)",
  baseboard: "#a9cfa9",
  floorA: "#f2e9d4",
  floorB: "#e3d3ae",
  sign: "#3fae5f",
  signText: "#ffffff",
  wood: "#a9743c",
  woodDark: "#875a2c",
  steel: "#c9d2d8",
  cooler: "#8fd2ec",
  coolerShelf: "#eef6f9",
  mat: "#3fae5f",
  matText: "#f7f0dc",
  ink: "#2b2620",
  cream: "#f7f0dc",
};

const GROCERY_DARK = {
  outside: "#26372b",
  marker: "rgba(255,255,255,0.8)",
  wall: "#a7bfa5",
  wallLine: "rgba(30,50,34,0.25)",
  baseboard: "#7fa07f",
  floorA: "#cfc09c",
  floorB: "#bba87e",
  sign: "#2f8a4c",
  signText: "#f2efe2",
  wood: "#7d5630",
  woodDark: "#5f4023",
  steel: "#9aa4ab",
  cooler: "#5f9cb8",
  coolerShelf: "#b9cdd6",
  mat: "#2f8a4c",
  matText: "#f2efe2",
  ink: "#241f1a",
  cream: "#e8dfc8",
};

const GROCERY_WALL_Y = 330;
const CARTON_CAPS = ["#2a7de1", "#e2543f", "#3fae5f", "#f28c1b"];
const CAN_COLORS = ["#e2543f", "#f2c81b", "#2a7de1", "#3fae5f", "#d94fb0", "#f28c1b"];

function drawGroceryBackground(ctx, room, theme) {
  const P = room.palette[theme];
  wallAndBase(ctx, room, GROCERY_WALL_Y, P);

  // wall panel seams
  ctx.strokeStyle = P.wallLine;
  ctx.lineWidth = 2;
  for (const x of [152, 380, 608]) {
    ctx.beginPath();
    ctx.moveTo(x, 20);
    ctx.lineTo(x, GROCERY_WALL_Y - 14);
    ctx.stroke();
  }

  // dairy cooler on the back wall
  rr(ctx, 60, 100, 250, 218, 10);
  paint(ctx, P.steel, 3);
  rr(ctx, 60, 100, 250, 30, 10);
  paint(ctx, P.sign, 2.5);
  ctx.font = "700 15px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.cream;
  ctx.fillText("DAIRY", 185, 116);
  rr(ctx, 74, 138, 222, 166, 6);
  paint(ctx, P.coolerShelf, 2);
  // two shelves of cartons and bottles
  for (const [row, sy] of [[0, 196], [1, 258]]) {
    ctx.strokeStyle = shade(P.steel, -0.28);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(78, sy + 6);
    ctx.lineTo(292, sy + 6);
    ctx.stroke();
    for (let i = 0; i < 7; i++) {
      const bx = 88 + i * 28;
      if (row === 0) {
        rr(ctx, bx, sy - 34, 20, 38, 3);
        paint(ctx, P.cream, 1.5);
        rr(ctx, bx, sy - 34, 20, 10, 3);
        paint(ctx, CARTON_CAPS[i % CARTON_CAPS.length], 1.5);
      } else {
        rr(ctx, bx + 2, sy - 28, 16, 32, 5);
        paint(ctx, CARTON_CAPS[(i + 2) % CARTON_CAPS.length], 1.5);
        rr(ctx, bx + 6, sy - 34, 8, 8, 2);
        paint(ctx, P.cream, 1.2);
      }
    }
  }
  // glass shine
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(102, 292);
  ctx.lineTo(210, 150);
  ctx.moveTo(130, 296);
  ctx.lineTo(238, 154);
  ctx.stroke();
  if (theme === "dark") {
    rr(ctx, 74, 138, 222, 166, 6);
    ctx.fillStyle = "rgba(140,210,240,0.14)";
    ctx.fill();
  }

  // pantry shelf on the back wall
  rr(ctx, 460, 110, 240, 208, 8);
  paint(ctx, P.wood, 3);
  for (const sy of [176, 240, 304]) {
    rr(ctx, 468, sy, 224, 10, 4);
    paint(ctx, P.woodDark, 2);
    for (let i = 0; i < 6; i++) {
      const bx = 484 + i * 34;
      if (sy === 176) {
        circle(ctx, bx + 10, sy - 12, 11);
        paint(ctx, CAN_COLORS[i % CAN_COLORS.length], 1.5);
      } else if (sy === 240) {
        rr(ctx, bx, sy - 30, 22, 28, 3);
        paint(ctx, CAN_COLORS[(i + 3) % CAN_COLORS.length], 1.5);
      } else {
        rr(ctx, bx + 2, sy - 26, 18, 24, 8);
        paint(ctx, CAN_COLORS[(i + 1) % CAN_COLORS.length], 1.5);
      }
    }
  }

  // hanging shop sign
  rr(ctx, 250, 24, 260, 56, 12);
  paint(ctx, P.sign, 3);
  ctx.font = "700 30px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.signText;
  ctx.fillText("GROCERY", 380, 54);

  checkerFloor(ctx, room, GROCERY_WALL_Y, P.floorA, P.floorB);
  drawExitMat(ctx, 380, 840, P);
  drawFrontRim(ctx, room);
}

function drawProduceTable(ctx, p, P, fruitA, fruitB) {
  softShadow(ctx, p.x, p.y, 74, 11);
  for (const s of [-1, 1]) {
    rr(ctx, p.x + s * 56 - 6, p.y - 40, 12, 40, 4);
    paint(ctx, P.woodDark, 2);
  }
  rr(ctx, p.x - 70, p.y - 52, 140, 16, 6);
  paint(ctx, P.wood, 2.5);
  drawCrate(ctx, p.x - 35, p.y - 52, fruitA, P);
  drawCrate(ctx, p.x + 35, p.y - 52, fruitB, P);
}

function drawGondola(ctx, p, P) {
  const w = 220;
  softShadow(ctx, p.x, p.y, w / 2 + 8, 11);
  rr(ctx, p.x - w / 2, p.y - 18, w, 18, 4);
  paint(ctx, shade(P.steel, -0.18), 2);
  rr(ctx, p.x - w / 2, p.y - 100, w, 84, 6);
  paint(ctx, P.steel, 2.5);
  for (const rowY of [p.y - 62, p.y - 26]) {
    ctx.strokeStyle = shade(P.steel, -0.28);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - w / 2 + 4, rowY);
    ctx.lineTo(p.x + w / 2 - 4, rowY);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const bx = p.x - w / 2 + 12 + i * 26;
      rr(ctx, bx, rowY - 24, 20, 22, 3);
      paint(ctx, CAN_COLORS[(i + (rowY > p.y - 40 ? 2 : 0)) % CAN_COLORS.length], 1.5);
    }
  }
  rr(ctx, p.x - w / 2 - 5, p.y - 108, w + 10, 12, 5);
  paint(ctx, shade(P.steel, -0.1), 2);
}

function drawCheckout(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 80, 11);
  rr(ctx, p.x - 70, p.y - 54, 140, 46, 6);
  paint(ctx, P.wood, 2.5);
  rr(ctx, p.x - 78, p.y - 66, 156, 16, 6);
  paint(ctx, P.cream, 2.5);
  // register
  rr(ctx, p.x + 14, p.y - 98, 44, 34, 5);
  paint(ctx, P.ink, 2);
  rr(ctx, p.x + 20, p.y - 92, 20, 14, 3);
  paint(ctx, P.cooler, 1.5);
  // lane light
  rr(ctx, p.x - 56, p.y - 122, 7, 58, 3);
  paint(ctx, P.steel, 2);
  rr(ctx, p.x - 68, p.y - 140, 32, 24, 5);
  paint(ctx, P.sign, 2);
  ctx.font = "700 14px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.cream;
  ctx.fillText("1", p.x - 52, p.y - 127);
}

const GROCERY_STORE = {
  id: "grocery-store",
  name: "Grocery Store",
  capacity: 12,
  width: 760,
  height: 880,
  spawn: { x: 380, y: 800 },
  palette: { light: GROCERY_LIGHT, dark: GROCERY_DARK },

  walkable: [
    { x: 40, y: 358 },
    { x: 720, y: 358 },
    { x: 728, y: 848 },
    { x: 32, y: 848 },
  ],

  exits: [
    {
      id: "town-square",
      label: "Town Square",
      roomId: "town-square",
      hotspot: { x: 286, y: 776, w: 188, h: 104 },
      approach: { x: 380, y: 826 },
      arrive: { x: 180, y: 560 },
    },
  ],

  props: [
    {
      id: "produce-1",
      x: 140,
      y: 470,
      draw: (ctx, p, P) => drawProduceTable(ctx, p, P, "#e2543f", "#f2a41b"),
      footprint: { x: 70, y: 438, w: 140, h: 34 },
    },
    {
      id: "produce-2",
      x: 140,
      y: 640,
      draw: (ctx, p, P) => drawProduceTable(ctx, p, P, "#f2c81b", "#3fae5f"),
      footprint: { x: 70, y: 608, w: 140, h: 34 },
    },
    { id: "aisle-1", x: 370, y: 556, draw: drawGondola, footprint: { x: 250, y: 516, w: 240, h: 42 } },
    { id: "aisle-2", x: 430, y: 700, draw: drawGondola, footprint: { x: 310, y: 660, w: 240, h: 42 } },
    { id: "checkout", x: 620, y: 470, draw: drawCheckout, footprint: { x: 550, y: 424, w: 140, h: 48 } },
  ],

  drawBackground: drawGroceryBackground,
};

// ---- Fast Food Place ---------------------------------------

const FASTFOOD_LIGHT = {
  outside: "#5c4a33",
  marker: "rgba(0,87,184,0.7)",
  wall: "#fbeecf",
  stripe: "#e2543f",
  baseboard: "#e0c896",
  board: "#3a2f28",
  boardText: "#f7f0dc",
  counter: "#e2543f",
  counterTop: "#f7f0dc",
  floorA: "#f5ecd8",
  floorB: "#e8d6ac",
  booth: "#e2543f",
  table: "#f7f0dc",
  metal: "#c9d2d8",
  mat: "#e2543f",
  matText: "#f7f0dc",
  ink: "#2b2620",
  cream: "#f7f0dc",
  lampGlow: null,
};

const FASTFOOD_DARK = {
  outside: "#2b2118",
  marker: "rgba(255,255,255,0.8)",
  wall: "#c8b48d",
  stripe: "#b5432f",
  baseboard: "#a98f62",
  board: "#2b231e",
  boardText: "#e8dfc8",
  counter: "#b5432f",
  counterTop: "#e8dfc8",
  floorA: "#c9b891",
  floorB: "#b5a075",
  booth: "#b5432f",
  table: "#e8dfc8",
  metal: "#98a1a8",
  mat: "#b5432f",
  matText: "#e8dfc8",
  ink: "#241f1a",
  cream: "#e8dfc8",
  lampGlow: "rgba(255,214,110,0.28)",
};

const FASTFOOD_WALL_Y = 310;

function drawMiniBurger(ctx, x, y, s) {
  ctx.beginPath();
  ctx.arc(x, y - 6 * s, 15 * s, Math.PI, 0);
  ctx.closePath();
  paint(ctx, "#f2c81b", 2);
  rr(ctx, x - 15 * s, y - 6 * s, 30 * s, 6 * s, 3 * s);
  paint(ctx, "#8a5230", 2);
  rr(ctx, x - 17 * s, y, 34 * s, 7 * s, 3.5 * s);
  paint(ctx, "#f2c81b", 2);
}

function drawFastFoodBackground(ctx, room, theme) {
  const P = room.palette[theme];
  wallAndBase(ctx, room, FASTFOOD_WALL_Y, P);

  // stripe band along the top of the wall
  ctx.fillStyle = P.stripe;
  ctx.fillRect(0, 16, room.width, 22);
  ctx.strokeStyle = shade(P.stripe, -0.28);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 38);
  ctx.lineTo(room.width, 38);
  ctx.stroke();

  // the menu board
  rr(ctx, 180, 62, 360, 184, 12);
  paint(ctx, P.board, 3);
  ctx.font = "700 22px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.boardText;
  ctx.fillText("MENU", 360, 88);
  ctx.strokeStyle = "rgba(247,240,220,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(206, 104);
  ctx.lineTo(514, 104);
  ctx.stroke();
  // burger / fries / soda with prices
  drawMiniBurger(ctx, 250, 150, 1);
  rr(ctx, 332, 138, 34, 28, 4);
  paint(ctx, P.stripe, 2);
  for (const fx of [338, 346, 354]) {
    rr(ctx, fx, 122, 7, 20, 3);
    paint(ctx, "#f2c81b", 1.5);
  }
  rr(ctx, 456, 126, 26, 38, 5);
  paint(ctx, P.stripe, 2);
  rr(ctx, 456, 138, 26, 8, 2);
  paint(ctx, P.cream, 1.5);
  ctx.strokeStyle = P.cream;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(469, 126);
  ctx.lineTo(476, 108);
  ctx.stroke();
  ctx.font = "700 16px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillStyle = P.boardText;
  ctx.fillText("$5", 250, 196);
  ctx.fillText("$3", 349, 196);
  ctx.fillText("$2", 469, 196);
  ctx.font = "600 11px Inter, system-ui, sans-serif";
  ctx.fillText("BURGER", 250, 218);
  ctx.fillText("FRIES", 349, 218);
  ctx.fillText("SODA", 469, 218);

  // milkshake machine + fryer against the wall, stage right
  rr(ctx, 566, 196, 56, 108, 6);
  paint(ctx, P.metal, 2.5);
  for (const nx of [578, 594, 610]) {
    rr(ctx, nx - 4, 232, 8, 12, 2);
    paint(ctx, P.ink, 1.5);
  }
  rr(ctx, 574, 206, 40, 16, 4);
  paint(ctx, P.stripe, 1.5);
  rr(ctx, 630, 216, 54, 88, 6);
  paint(ctx, shade(P.metal, -0.12), 2.5);
  rr(ctx, 638, 228, 38, 22, 3);
  paint(ctx, P.ink, 1.5);

  // hanging pendant lamps
  for (const lx of [130, 590]) {
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, 74);
    ctx.stroke();
    if (P.lampGlow) {
      circle(ctx, lx, 96, 34);
      ctx.fillStyle = P.lampGlow;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(lx - 22, 96);
    ctx.lineTo(lx + 22, 96);
    ctx.lineTo(lx + 8, 72);
    ctx.lineTo(lx - 8, 72);
    ctx.closePath();
    paint(ctx, P.stripe, 2.5);
    ell(ctx, lx, 96, 14, 5);
    paint(ctx, "#f6d75a", 1.5);
  }

  checkerFloor(ctx, room, FASTFOOD_WALL_Y, P.floorA, P.floorB, 40);
  drawExitMat(ctx, 360, 780, P);
  drawFrontRim(ctx, room);
}

function drawServiceCounter(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 190, 13);
  rr(ctx, p.x - 180, p.y - 64, 360, 56, 8);
  paint(ctx, P.counter, 3);
  ctx.strokeStyle = shade(P.counter, -0.28);
  ctx.lineWidth = 2;
  for (const lx of [-90, 0, 90]) {
    ctx.beginPath();
    ctx.moveTo(p.x + lx, p.y - 56);
    ctx.lineTo(p.x + lx, p.y - 16);
    ctx.stroke();
  }
  rr(ctx, p.x - 188, p.y - 80, 376, 20, 8);
  paint(ctx, P.counterTop, 2.5);
  // register
  rr(ctx, p.x - 130, p.y - 112, 46, 34, 5);
  paint(ctx, P.board, 2);
  rr(ctx, p.x - 124, p.y - 106, 20, 14, 3);
  paint(ctx, "#7cc4e0", 1.5);
  // soda cup + tray with a burger
  rr(ctx, p.x + 24, p.y - 108, 22, 30, 4);
  paint(ctx, P.cream, 2);
  rr(ctx, p.x + 24, p.y - 99, 22, 7, 2);
  paint(ctx, P.counter, 1.5);
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x + 35, p.y - 108);
  ctx.lineTo(p.x + 41, p.y - 124);
  ctx.stroke();
  ell(ctx, p.x + 120, p.y - 82, 34, 9);
  paint(ctx, shade(P.counterTop, -0.12), 2);
  drawMiniBurger(ctx, p.x + 120, p.y - 92, 0.9);
}

function drawBooth(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 78, 11);
  for (const s of [-1, 1]) {
    rr(ctx, p.x + s * 61 - 11, p.y - 74, 22, 70, 7);
    paint(ctx, P.booth, 2.5);
    rr(ctx, p.x + s * 42 - 13, p.y - 32, 26, 14, 5);
    paint(ctx, P.booth, 2);
  }
  rr(ctx, p.x - 6, p.y - 36, 12, 32, 4);
  paint(ctx, P.metal, 2);
  rr(ctx, p.x - 44, p.y - 48, 88, 16, 7);
  paint(ctx, P.table, 2.5);
  // ketchup bottle
  rr(ctx, p.x - 5, p.y - 66, 10, 18, 4);
  paint(ctx, "#e2543f", 1.5);
  rr(ctx, p.x - 2, p.y - 71, 4, 6, 1.5);
  paint(ctx, "#8a5230", 1);
}

function drawTrashBin(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 26, 8);
  rr(ctx, p.x - 20, p.y - 48, 40, 44, 6);
  paint(ctx, P.counter, 2.5);
  rr(ctx, p.x - 23, p.y - 58, 46, 12, 5);
  paint(ctx, P.board, 2);
  rr(ctx, p.x - 11, p.y - 52, 22, 12, 3);
  paint(ctx, shade(P.board, 0.18), 1.5);
  ctx.font = "600 9px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.cream;
  ctx.fillText("THANKS", p.x, p.y - 26);
}

const FAST_FOOD = {
  id: "fast-food",
  name: "Fast Food Place",
  capacity: 12,
  width: 720,
  height: 820,
  spawn: { x: 360, y: 742 },
  palette: { light: FASTFOOD_LIGHT, dark: FASTFOOD_DARK },

  walkable: [
    { x: 36, y: 338 },
    { x: 684, y: 338 },
    { x: 692, y: 790 },
    { x: 28, y: 790 },
  ],

  exits: [
    {
      id: "town-square",
      label: "Town Square",
      roomId: "town-square",
      hotspot: { x: 266, y: 716, w: 188, h: 104 },
      approach: { x: 360, y: 766 },
      arrive: { x: 480, y: 560 },
    },
  ],

  props: [
    { id: "counter", x: 360, y: 430, draw: drawServiceCounter, footprint: { x: 180, y: 384, w: 360, h: 46 } },
    { id: "booth-l1", x: 118, y: 545, draw: drawBooth, footprint: { x: 46, y: 498, w: 145, h: 47 } },
    { id: "booth-l2", x: 118, y: 700, draw: drawBooth, footprint: { x: 46, y: 653, w: 145, h: 47 } },
    { id: "booth-r1", x: 602, y: 545, draw: drawBooth, footprint: { x: 529, y: 498, w: 145, h: 47 } },
    { id: "booth-r2", x: 602, y: 700, draw: drawBooth, footprint: { x: 529, y: 653, w: 145, h: 47 } },
    { id: "trash", x: 658, y: 415, draw: drawTrashBin, footprint: { x: 636, y: 392, w: 44, h: 24 } },
  ],

  drawBackground: drawFastFoodBackground,
};

// ---- Sports Bar --------------------------------------------

const SPORTSBAR_LIGHT = {
  outside: "#243044",
  marker: "rgba(0,87,184,0.7)",
  wall: "#33445f",
  wainscot: "#6b4a2c",
  wainLine: "rgba(30,20,10,0.30)",
  baseboard: "#54371f",
  floorA: "#b07b44",
  floorLine: "rgba(70,45,20,0.35)",
  bar: "#7a5230",
  barTop: "#c89058",
  brass: "#e8c454",
  shelf: "#4a3423",
  neon: "#7cc4e0",
  neonGlow: null,
  field: "#3fae5f",
  frame: "#1b2330",
  stool: "#e2543f",
  steel: "#c9d2d8",
  juke: "#d94fb0",
  mat: "#2a7de1",
  matText: "#f7f0dc",
  ink: "#2b2620",
  cream: "#f7f0dc",
};

const SPORTSBAR_DARK = {
  outside: "#131a27",
  marker: "rgba(255,255,255,0.8)",
  wall: "#243349",
  wainscot: "#54371f",
  wainLine: "rgba(0,0,0,0.35)",
  baseboard: "#432c18",
  floorA: "#8f6234",
  floorLine: "rgba(40,25,10,0.40)",
  bar: "#5f4023",
  barTop: "#a06f3e",
  brass: "#e8c454",
  shelf: "#392818",
  neon: "#9fd8f2",
  neonGlow: "rgba(124,196,224,0.35)",
  field: "#2f8a4c",
  frame: "#141a24",
  stool: "#c34733",
  steel: "#9aa4ab",
  juke: "#b53f92",
  mat: "#2a6dc4",
  matText: "#e8dfc8",
  ink: "#241f1a",
  cream: "#e8dfc8",
};

const SPORTSBAR_WALL_Y = 340;
const PENNANT_COLORS = ["#e2543f", "#f2c81b", "#2a7de1", "#3fae5f"];
const PENNANT_LETTERS = { 2: "H", 3: "S", 4: "P", 5: "N" };
const BOTTLE_COLORS = ["#e2543f", "#f2c81b", "#3fae5f", "#2a7de1", "#d94fb0", "#f28c1b"];

function drawSportsBarBackground(ctx, room, theme) {
  const P = room.palette[theme];
  ctx.fillStyle = P.wall;
  ctx.fillRect(0, 0, room.width, SPORTSBAR_WALL_Y);

  // wood wainscot along the lower wall
  ctx.fillStyle = P.wainscot;
  ctx.fillRect(0, 252, room.width, SPORTSBAR_WALL_Y - 252);
  ctx.strokeStyle = P.wainLine;
  ctx.lineWidth = 2;
  for (let x = 40; x < room.width; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 258);
    ctx.lineTo(x, SPORTSBAR_WALL_Y - 12);
    ctx.stroke();
  }
  ctx.strokeStyle = shade(P.wainscot, 0.18);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 254);
  ctx.lineTo(room.width, 254);
  ctx.stroke();
  rr(ctx, -6, SPORTSBAR_WALL_Y - 14, room.width + 12, 18, 4);
  paint(ctx, P.baseboard, 2);

  // pennant string across the top
  ctx.strokeStyle = "rgba(247,240,220,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, 30);
  ctx.quadraticCurveTo(400, 62, 780, 30);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const px = 76 + i * 92;
    const py = 32 + 24 * Math.sin((Math.PI * (px - 20)) / 760);
    ctx.beginPath();
    ctx.moveTo(px - 16, py);
    ctx.lineTo(px + 16, py);
    ctx.lineTo(px, py + 36);
    ctx.closePath();
    paint(ctx, PENNANT_COLORS[i % PENNANT_COLORS.length], 2);
    if (PENNANT_LETTERS[i]) {
      ctx.font = "700 13px Oswald, 'Arial Narrow', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = P.cream;
      ctx.fillText(PENNANT_LETTERS[i], px, py + 12);
    }
  }

  // back bar: shelves of bottles behind where the counter sits
  rr(ctx, 250, 78, 300, 220, 10);
  paint(ctx, P.shelf, 3);
  // neon house sign mounted on it
  rr(ctx, 275, 92, 250, 44, 10);
  paint(ctx, P.frame, 2.5);
  if (P.neonGlow) {
    rr(ctx, 275, 92, 250, 44, 10);
    ctx.fillStyle = P.neonGlow;
    ctx.fill();
  }
  ctx.strokeStyle = P.neon;
  ctx.lineWidth = 2.5;
  rr(ctx, 281, 98, 238, 32, 8);
  ctx.stroke();
  ctx.font = "700 24px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.neon;
  ctx.fillText("HSPN SPORTS", 400, 115);
  // mirror + two bottle shelves
  rr(ctx, 262, 146, 276, 142, 6);
  paint(ctx, shade(P.wall, 0.16), 2);
  for (const sy of [216, 282]) {
    rr(ctx, 262, sy, 276, 9, 4);
    paint(ctx, shade(P.shelf, 0.14), 2);
    for (let i = 0; i < 9; i++) {
      const bx = 276 + i * 29;
      rr(ctx, bx, sy - 32, 13, 32, 4);
      paint(ctx, BOTTLE_COLORS[(i + (sy === 216 ? 0 : 3)) % BOTTLE_COLORS.length], 1.5);
      rr(ctx, bx + 4, sy - 42, 5, 10, 2);
      paint(ctx, P.ink, 1);
    }
  }

  // framed league jersey, stage left
  rr(ctx, 80, 120, 104, 122, 8);
  paint(ctx, P.cream, 2.5);
  rr(ctx, 88, 128, 88, 106, 5);
  paint(ctx, shade(P.wall, -0.14), 2);
  rr(ctx, 106, 148, 52, 66, 8);
  paint(ctx, "#2a7de1", 2);
  rr(ctx, 96, 148, 14, 24, 4);
  paint(ctx, "#2a7de1", 1.5);
  rr(ctx, 154, 148, 14, 24, 4);
  paint(ctx, "#2a7de1", 1.5);
  ctx.font = "700 22px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.cream;
  ctx.fillText("88", 132, 184);

  // dartboard, stage right
  circle(ctx, 690, 170, 38);
  paint(ctx, P.frame, 2.5);
  circle(ctx, 690, 170, 30);
  paint(ctx, P.cream, 2);
  ctx.strokeStyle = "rgba(43,38,32,0.5)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(690, 170);
    ctx.lineTo(690 + Math.cos(a) * 30, 170 + Math.sin(a) * 30);
    ctx.stroke();
  }
  circle(ctx, 690, 170, 12);
  paint(ctx, "#3fae5f", 1.5);
  circle(ctx, 690, 170, 5);
  paint(ctx, "#e2543f", 1.5);

  plankFloor(ctx, room, SPORTSBAR_WALL_Y, P.floorA, P.floorLine);
  drawExitMat(ctx, 400, 838, P);
  drawFrontRim(ctx, room);
}

// Wall-mounted TV playing the game — a prop (not background)
// so the ball, clock dot and score bug stay animated.
function drawWallTV(ctx, p, P, theme, t) {
  const dir = p.dir || 1;
  if (theme === "dark") {
    ell(ctx, p.x, p.y - 60, 110, 80);
    ctx.fillStyle = "rgba(124,196,224,0.16)";
    ctx.fill();
  }
  rr(ctx, p.x - 85, p.y - 118, 170, 112, 10);
  paint(ctx, P.frame, 3);
  // field
  rr(ctx, p.x - 77, p.y - 110, 154, 82, 5);
  paint(ctx, P.field, 2);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.5;
  for (let i = 1; i < 7; i++) {
    const lx = p.x - 77 + i * 22;
    ctx.beginPath();
    ctx.moveTo(lx, p.y - 108);
    ctx.lineTo(lx, p.y - 30);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(p.x - 77, p.y - 110, 18, 82);
  ctx.fillRect(p.x + 59, p.y - 110, 18, 82);
  // two tiny players chasing the ball
  const ph = ((t * 0.35 * dir + (dir > 0 ? 0 : 0.5)) % 1 + 1) % 1;
  const bx = p.x - 58 + ph * 116;
  const by = p.y - 66 + Math.sin(t * 3 + dir) * 10;
  circle(ctx, bx - 14 * dir, by + 6, 5);
  paint(ctx, "#e2543f", 1.5);
  circle(ctx, bx + 10 * dir, by - 5, 5);
  paint(ctx, "#2a7de1", 1.5);
  ell(ctx, bx, by, 5, 3.5);
  paint(ctx, "#8a5230", 1.2);
  // score bug
  rr(ctx, p.x - 77, p.y - 26, 154, 18, 4);
  paint(ctx, P.frame, 1.5);
  ctx.font = "700 11px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.cream;
  ctx.fillText(p.score || "HSPN 21 - 17", p.x + 6, p.y - 17);
  if (Math.floor(t * 1.6) % 2 === 0) {
    circle(ctx, p.x - 66, p.y - 17, 3.5);
    ctx.fillStyle = "#e2543f";
    ctx.fill();
  }
}

function drawBarCounter(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 210, 13);
  rr(ctx, p.x - 200, p.y - 58, 400, 50, 8);
  paint(ctx, P.bar, 3);
  ctx.strokeStyle = shade(P.bar, -0.28);
  ctx.lineWidth = 2;
  for (const lx of [-120, -40, 40, 120]) {
    ctx.beginPath();
    ctx.moveTo(p.x + lx, p.y - 50);
    ctx.lineTo(p.x + lx, p.y - 16);
    ctx.stroke();
  }
  // brass foot rail
  ctx.strokeStyle = P.brass;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(p.x - 186, p.y - 6);
  ctx.lineTo(p.x + 186, p.y - 6);
  ctx.stroke();
  rr(ctx, p.x - 208, p.y - 76, 416, 22, 9);
  paint(ctx, P.barTop, 2.5);
  // taps
  for (const tx of [-60, 0, 60]) {
    rr(ctx, p.x + tx - 4, p.y - 96, 8, 22, 3);
    paint(ctx, P.brass, 1.5);
    circle(ctx, p.x + tx, p.y - 100, 5);
    paint(ctx, ["#e2543f", "#2a7de1", "#3fae5f"][(tx + 60) / 60], 1.5);
  }
  // two full mugs on the bar
  for (const mx of [-140, 140]) {
    rr(ctx, p.x + mx - 9, p.y - 94, 18, 22, 3);
    paint(ctx, "#f2a41b", 1.5);
    rr(ctx, p.x + mx - 9, p.y - 98, 18, 7, 3);
    paint(ctx, P.cream, 1.2);
  }
}

function drawBarStool(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 17, 6);
  rr(ctx, p.x - 3, p.y - 34, 6, 34, 3);
  paint(ctx, P.steel, 1.5);
  ell(ctx, p.x, p.y - 6, 12, 4);
  paint(ctx, P.steel, 1.5);
  ell(ctx, p.x, p.y - 36, 16, 8);
  paint(ctx, P.stool, 2);
}

function drawPubTable(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 66, 11);
  for (const s of [-1, 1]) {
    rr(ctx, p.x + s * 52 - 3, p.y - 26, 6, 26, 3);
    paint(ctx, P.steel, 1.5);
    ell(ctx, p.x + s * 52, p.y - 28, 14, 7);
    paint(ctx, P.stool, 2);
  }
  ell(ctx, p.x, p.y - 2, 20, 8);
  paint(ctx, P.steel, 2);
  rr(ctx, p.x - 5, p.y - 52, 10, 50, 4);
  paint(ctx, P.steel, 2);
  ell(ctx, p.x, p.y - 56, 42, 15);
  paint(ctx, P.barTop, 2.5);
  rr(ctx, p.x - 20, p.y - 74, 12, 16, 3);
  paint(ctx, "#f2a41b", 1.5);
  circle(ctx, p.x + 14, p.y - 64, 7);
  paint(ctx, P.cream, 1.5);
}

function drawJukebox(ctx, p, P, theme, t) {
  softShadow(ctx, p.x, p.y, 34, 9);
  if (theme === "dark") {
    ell(ctx, p.x, p.y - 46, 52 + Math.sin(t * 2.2) * 4, 62);
    ctx.fillStyle = "rgba(217,79,176,0.16)";
    ctx.fill();
  }
  rr(ctx, p.x - 32, p.y - 90, 64, 90, 18);
  paint(ctx, P.juke, 2.5);
  rr(ctx, p.x - 21, p.y - 79, 42, 38, 12);
  paint(ctx, P.cream, 2);
  ctx.strokeStyle = P.brass;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y - 58, 13, Math.PI, 0);
  ctx.stroke();
  for (const gy of [-30, -22, -14]) {
    ctx.strokeStyle = shade(P.juke, -0.3);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(p.x - 20, p.y + gy);
    ctx.lineTo(p.x + 20, p.y + gy);
    ctx.stroke();
  }
}

const SPORTS_BAR = {
  id: "sports-bar",
  name: "Sports Bar",
  capacity: 16,
  width: 800,
  height: 880,
  spawn: { x: 400, y: 795 },
  palette: { light: SPORTSBAR_LIGHT, dark: SPORTSBAR_DARK },

  walkable: [
    { x: 40, y: 368 },
    { x: 760, y: 368 },
    { x: 768, y: 848 },
    { x: 32, y: 848 },
  ],

  exits: [
    {
      id: "town-square",
      label: "Town Square",
      roomId: "town-square",
      hotspot: { x: 306, y: 774, w: 188, h: 106 },
      approach: { x: 400, y: 824 },
      arrive: { x: 780, y: 560 },
    },
  ],

  props: [
    { id: "tv-l", x: 210, y: 242, dir: 1, draw: drawWallTV },
    { id: "tv-r", x: 590, y: 242, dir: -1, score: "2ND QTR 0:48", draw: drawWallTV },
    { id: "bar", x: 400, y: 470, draw: drawBarCounter, footprint: { x: 200, y: 424, w: 400, h: 46 } },
    { id: "stool-1", x: 250, y: 520, draw: drawBarStool, footprint: { x: 235, y: 504, w: 30, h: 18 } },
    { id: "stool-2", x: 350, y: 520, draw: drawBarStool, footprint: { x: 335, y: 504, w: 30, h: 18 } },
    { id: "stool-3", x: 450, y: 520, draw: drawBarStool, footprint: { x: 435, y: 504, w: 30, h: 18 } },
    { id: "stool-4", x: 550, y: 520, draw: drawBarStool, footprint: { x: 535, y: 504, w: 30, h: 18 } },
    { id: "table-l", x: 150, y: 680, draw: drawPubTable, footprint: { x: 86, y: 640, w: 128, h: 42 } },
    { id: "table-r", x: 650, y: 680, draw: drawPubTable, footprint: { x: 586, y: 640, w: 128, h: 42 } },
    { id: "jukebox", x: 78, y: 565, draw: drawJukebox, footprint: { x: 44, y: 542, w: 68, h: 24 } },
  ],

  drawBackground: drawSportsBarBackground,
};

// ---- registry ----------------------------------------------

export const ROOMS = {
  [TOWN_SQUARE.id]: TOWN_SQUARE,
  [GROCERY_STORE.id]: GROCERY_STORE,
  [FAST_FOOD.id]: FAST_FOOD,
  [SPORTS_BAR.id]: SPORTS_BAR,
};
export const DEFAULT_ROOM_ID = TOWN_SQUARE.id;

export function getRoom(id) {
  return ROOMS[id] || ROOMS[DEFAULT_ROOM_ID];
}
