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
  // casino arrow sign (milestone 14)
  signPost: "#3c4454",
  signBoard: "#c8203c",
  signInner: "#8e1230",
  signText: "#ffe9a8",
  signGlow: "rgba(255,200,60,0.30)",
  bulbOn: "#fff3c4",
  bulbOff: "#c2b48a",
  bulbGlow: "rgba(255,214,110,0.30)",
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
  // casino arrow sign (milestone 14) — after dark the bulbs
  // and the lettering actually glow
  signPost: "#2c3340",
  signBoard: "#a8172f",
  signInner: "#6f0d24",
  signText: "#ffe9a8",
  signGlow: "rgba(255,214,110,0.70)",
  bulbOn: "#fff3c4",
  bulbOff: "#6a5f45",
  bulbGlow: "rgba(255,225,150,0.50)",
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
  ell(ctx, 1090, 478, 190, 80); // east of the path (milestone 14)
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
    if (e.noMat) continue; // the casino path is not a shop door
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
  // 1120, not 960, since milestone 14: the extra 160px on the
  // east is the casino path. Nothing else moved — every prop,
  // building and exit here is positioned absolutely — and the
  // zoom is unchanged in practice because this room's HEIGHT
  // is the binding axis at every viewport we support.
  width: 1120,
  height: 1220,
  spawn: { x: 480, y: 1012 },
  palette: { light: TOWN_LIGHT, dark: TOWN_DARK },

  // Feet may stand inside this polygon (minus prop footprints).
  walkable: [
    { x: 30, y: 510 },
    { x: 930, y: 510 },
    { x: 945, y: 568 },
    // ---- the casino path (milestone 14) ----
    { x: 945, y: 632 },
    { x: 1104, y: 640 },
    { x: 1104, y: 772 },
    { x: 945, y: 764 },
    // ---- back to the plaza ----
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
      arrive: { x: 400, y: 945 },
    },
    {
      // Not a storefront: the far end of the path east. `noMat`
      // keeps it out of the welcome-mat loop in
      // drawTownBackground, which paints mats at the shop
      // doors along y 514.
      id: "casino-strip",
      label: "Casino",
      roomId: "casino-strip",
      noMat: true,
      hotspot: { x: 1020, y: 628, w: 100, h: 156 },
      approach: { x: 1064, y: 702 },
      arrive: { x: 150, y: 700 },
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
    // Milestone 14: the big blinking arrow pointing east down
    // the path. Feet sit just north of the spur so the board
    // and its bulbs hang over the entrance to it.
    { id: "casino-arrow", x: 968, y: 624, draw: drawCasinoArrow, footprint: { x: 926, y: 610, w: 84, h: 18 } },
  ],

  drawBackground: drawTownBackground,
  music: "town", // background loop id — see lib/neighborhood/music.js; no key = silent room
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
  music: "grocery",
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

// Milestone 17 — the arcade machine. A house-style upright
// cabinet: navy body, chasing marquee bulbs over a DEEP
// THREAT header, and an attract-mode football looping on the
// little screen. The cabinet is scenery — the GAME is the
// real DeepThreatGame component, mounted full-screen by
// NeighborhoodRoom when you tap the machine and your avatar
// reaches it (see the arcade config in the room below).
function drawArcadeCabinet(ctx, p, P, theme, t) {
  const time = t || 0;
  softShadow(ctx, p.x, p.y, 46, 10);
  // upright body with darker side rails
  rr(ctx, p.x - 40, p.y - 150, 80, 150, 7);
  paint(ctx, "#22335c", 3);
  rr(ctx, p.x - 40, p.y - 150, 10, 150, 5);
  paint(ctx, "#1a2747", 2);
  rr(ctx, p.x + 30, p.y - 150, 10, 150, 5);
  paint(ctx, "#1a2747", 2);
  // marquee
  rr(ctx, p.x - 46, p.y - 178, 92, 32, 6);
  paint(ctx, "#0057B8", 3);
  ctx.font = "700 13px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f7f0dc";
  ctx.fillText("DEEP THREAT", p.x, p.y - 161);
  const step = Math.floor(time * 3);
  [-36, -12, 12, 36].forEach((bx, i) => {
    const lit = (i + step) % 2 === 0;
    circle(ctx, p.x + bx, p.y - 182, 3.4);
    ctx.fillStyle = lit ? "#f6d75a" : "#3a4c74";
    ctx.fill();
    ctx.strokeStyle = "rgba(60,40,10,0.35)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });
  // screen: night sky, a strip of turf, a ball on a loop
  rr(ctx, p.x - 32, p.y - 140, 64, 48, 4);
  paint(ctx, P.ink, 2.5);
  rr(ctx, p.x - 27, p.y - 135, 54, 38, 3);
  paint(ctx, "#0b1a2e", 1.5);
  ctx.save();
  rr(ctx, p.x - 27, p.y - 135, 54, 38, 3);
  ctx.clip();
  ctx.fillStyle = "#1f6b3a";
  ctx.fillRect(p.x - 27, p.y - 106, 54, 9);
  const u = (time * 0.8) % 1;
  ell(ctx, p.x - 20 + 40 * u, p.y - 106 - Math.sin(Math.PI * u) * 22, 4, 2.6);
  ctx.fillStyle = "#d98c3f";
  ctx.fill();
  ctx.restore();
  // control deck, joystick and two buttons
  ctx.beginPath();
  ctx.moveTo(p.x - 36, p.y - 92);
  ctx.lineTo(p.x + 36, p.y - 92);
  ctx.lineTo(p.x + 40, p.y - 76);
  ctx.lineTo(p.x - 40, p.y - 76);
  ctx.closePath();
  paint(ctx, "#c8102e", 2.5);
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(p.x - 16, p.y - 80);
  ctx.lineTo(p.x - 16, p.y - 88);
  ctx.stroke();
  circle(ctx, p.x - 16, p.y - 90, 4);
  paint(ctx, "#f2c81b", 1.5);
  circle(ctx, p.x + 8, p.y - 83, 4);
  paint(ctx, "#f7f0dc", 1.5);
  circle(ctx, p.x + 22, p.y - 83, 4);
  paint(ctx, "#f2c81b", 1.5);
  // coin door
  rr(ctx, p.x - 26, p.y - 66, 52, 40, 4);
  paint(ctx, "#1a2747", 2);
  ctx.font = "700 11px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillStyle = "#f2c81b";
  ctx.fillText("25¢", p.x, p.y - 54);
  rr(ctx, p.x - 12, p.y - 42, 9, 12, 2);
  paint(ctx, P.metal, 1.5);
  rr(ctx, p.x + 3, p.y - 42, 9, 12, 2);
  paint(ctx, P.metal, 1.5);
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

  // Milestone 17 — the arcade cabinet. Tap it and your avatar
  // walks over; on arrival NeighborhoodRoom mounts the REAL
  // Deep Threat game full-screen (same component, same
  // leaderboard as /deep-threat). Same walk-then-act shape as
  // chairs and doors: hotspot to tap, approach to stand on.
  arcade: {
    id: "deep-threat",
    label: "Deep Threat",
    hotspot: { x: 52, y: 240, w: 96, h: 188 },
    approach: { x: 100, y: 470 },
  },

  props: [
    { id: "arcade-cabinet", x: 100, y: 420, draw: drawArcadeCabinet, footprint: { x: 60, y: 396, w: 80, h: 26 } },
    { id: "counter", x: 360, y: 430, draw: drawServiceCounter, footprint: { x: 180, y: 384, w: 360, h: 46 } },
    { id: "booth-l1", x: 118, y: 545, draw: drawBooth, footprint: { x: 46, y: 498, w: 145, h: 47 } },
    { id: "booth-l2", x: 118, y: 700, draw: drawBooth, footprint: { x: 46, y: 653, w: 145, h: 47 } },
    { id: "booth-r1", x: 602, y: 545, draw: drawBooth, footprint: { x: 529, y: 498, w: 145, h: 47 } },
    { id: "booth-r2", x: 602, y: 700, draw: drawBooth, footprint: { x: 529, y: 653, w: 145, h: 47 } },
    { id: "trash", x: 658, y: 415, draw: drawTrashBin, footprint: { x: 636, y: 392, w: 44, h: 24 } },
  ],

  drawBackground: drawFastFoodBackground,
  music: "fastfood",
};

// ---- Sports Bar --------------------------------------------

// ---- the shared screen feed state --------------------------
// Milestone 12: TWO rooms have a screen now — the Mission
// Control big board and the Sports Bar's screen over the
// counter — and ONE broadcast lights up both. A client only
// ever renders the room it is standing in, so a single
// module-level state is all either panel needs: it says what
// the wall this player is looking at should be showing.
// "connecting" is the beat between a broadcast starting and
// the first frame arriving; while it is "live" the real
// picture is a DOM <video> pinned over the rect, so the canvas
// art underneath just stops advertising an empty channel.
// Module-level on purpose: prop draw functions are pure
// (ctx, prop, palette, theme, time) and this is scene
// dressing, not player state.
let screenFeed = "standby"; // standby | connecting | live
export function setScreenFeedState(state) {
  screenFeed = state === "live" || state === "connecting" ? state : "standby";
}
export function getScreenFeedState() {
  return screenFeed;
}

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
  frame: "#1b2330",
  screen: "#101a2b",
  scan: "rgba(124,196,224,0.06)",
  glow: "rgba(124,196,224,0.12)",
  red: "#e2543f",
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
  frame: "#141a24",
  screen: "#0a111e",
  scan: "rgba(124,196,224,0.08)",
  glow: "rgba(124,196,224,0.20)",
  red: "#e2543f",
  stool: "#c34733",
  steel: "#9aa4ab",
  juke: "#b53f92",
  mat: "#2a6dc4",
  matText: "#e8dfc8",
  ink: "#241f1a",
  cream: "#e8dfc8",
};

// The bar's back wall is tall on purpose: the big screen hangs
// on it (BAR_SCREEN below) the way Mission Control's board
// hangs on its wall, so the wall line sits well above the
// counter and the wainscot runs underneath the screen.
const SPORTSBAR_WALL_Y = 560;
const PENNANT_COLORS = ["#e2543f", "#f2c81b", "#2a7de1", "#3fae5f"];
const PENNANT_LETTERS = { 2: "H", 3: "S", 4: "P", 5: "N" };
const BOTTLE_COLORS = ["#e2543f", "#f2c81b", "#3fae5f", "#2a7de1", "#d94fb0", "#f28c1b"];

// The bar's big screen, mounted over the counter — EXACTLY the
// same 16:9 surface as MISSION_SCREEN (608 x 342), because it
// is the same feed: the room engine pins one DOM <video> to
// whichever of the two rects belongs to the room you are
// standing in. See SCREENS at the bottom of this file.
export const BAR_SCREEN = { x: 96, y: 100, w: 608, h: 342 };

function drawSportsBarBackground(ctx, room, theme) {
  const P = room.palette[theme];
  ctx.fillStyle = P.wall;
  ctx.fillRect(0, 0, room.width, SPORTSBAR_WALL_Y);

  // wood wainscot along the lower wall
  ctx.fillStyle = P.wainscot;
  ctx.fillRect(0, 472, room.width, SPORTSBAR_WALL_Y - 472);
  ctx.strokeStyle = P.wainLine;
  ctx.lineWidth = 2;
  for (let x = 40; x < room.width; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 478);
    ctx.lineTo(x, SPORTSBAR_WALL_Y - 12);
    ctx.stroke();
  }
  ctx.strokeStyle = shade(P.wainscot, 0.18);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 474);
  ctx.lineTo(room.width, 474);
  ctx.stroke();
  rr(ctx, -6, SPORTSBAR_WALL_Y - 14, room.width + 12, 18, 4);
  paint(ctx, P.baseboard, 2);

  // pennant string across the top, above the screen
  ctx.strokeStyle = "rgba(247,240,220,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, 24);
  ctx.quadraticCurveTo(400, 50, 780, 24);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const px = 76 + i * 92;
    const py = 26 + 18 * Math.sin((Math.PI * (px - 20)) / 760);
    ctx.beginPath();
    ctx.moveTo(px - 15, py);
    ctx.lineTo(px + 15, py);
    ctx.lineTo(px, py + 28);
    ctx.closePath();
    paint(ctx, PENNANT_COLORS[i % PENNANT_COLORS.length], 2);
    if (PENNANT_LETTERS[i]) {
      ctx.font = "700 12px Oswald, 'Arial Narrow', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = P.cream;
      ctx.fillText(PENNANT_LETTERS[i], px, py + 10);
    }
  }

  // neon house sign on the wainscot, directly under the screen
  rr(ctx, 275, 482, 250, 44, 10);
  paint(ctx, P.frame, 2.5);
  if (P.neonGlow) {
    rr(ctx, 275, 482, 250, 44, 10);
    ctx.fillStyle = P.neonGlow;
    ctx.fill();
  }
  ctx.strokeStyle = P.neon;
  ctx.lineWidth = 2.5;
  rr(ctx, 281, 488, 238, 32, 8);
  ctx.stroke();
  ctx.font = "700 24px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.neon;
  ctx.fillText("HSPN SPORTS", 400, 505);

  // framed league jersey, stage left of the screen
  rr(ctx, 4, 150, 70, 96, 7);
  paint(ctx, P.cream, 2.5);
  rr(ctx, 10, 156, 58, 84, 5);
  paint(ctx, shade(P.wall, -0.14), 2);
  rr(ctx, 26, 172, 26, 48, 7);
  paint(ctx, "#2a7de1", 2);
  rr(ctx, 18, 172, 9, 18, 3);
  paint(ctx, "#2a7de1", 1.5);
  rr(ctx, 51, 172, 9, 18, 3);
  paint(ctx, "#2a7de1", 1.5);
  ctx.font = "700 16px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.cream;
  ctx.fillText("27", 39, 200);

  // second framed jersey, hung under the first
  rr(ctx, 4, 254, 70, 96, 7);
  paint(ctx, P.cream, 2.5);
  rr(ctx, 10, 260, 58, 84, 5);
  paint(ctx, shade(P.wall, -0.14), 2);
  rr(ctx, 26, 276, 26, 48, 7);
  paint(ctx, "#2a7de1", 2);
  rr(ctx, 18, 276, 9, 18, 3);
  paint(ctx, "#2a7de1", 1.5);
  rr(ctx, 51, 276, 9, 18, 3);
  paint(ctx, "#2a7de1", 1.5);
  ctx.font = "700 16px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.cream;
  ctx.fillText("23", 39, 304);

  // dartboard, below the jerseys
  circle(ctx, 39, 414, 30);
  paint(ctx, P.frame, 2.5);
  circle(ctx, 39, 414, 24);
  paint(ctx, P.cream, 2);
  ctx.strokeStyle = "rgba(43,38,32,0.5)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(39, 414);
    ctx.lineTo(39 + Math.cos(a) * 24, 414 + Math.sin(a) * 24);
    ctx.stroke();
  }
  circle(ctx, 39, 414, 10);
  paint(ctx, "#3fae5f", 1.5);
  circle(ctx, 39, 414, 4);
  paint(ctx, "#e2543f", 1.5);

  // restroom door + sign, back-right corner (milestone 8 —
  // the secret chain starts through here)
  rr(ctx, 724, 318, 70, SPORTSBAR_WALL_Y - 318, 8);
  paint(ctx, shade(P.wainscot, -0.14), 3);
  rr(ctx, 734, 330, 50, 96, 5);
  paint(ctx, shade(P.wainscot, 0.1), 2);
  rr(ctx, 734, 434, 50, 62, 5);
  paint(ctx, shade(P.wainscot, 0.1), 2);
  circle(ctx, 782, 420, 4);
  paint(ctx, P.brass, 1.5);
  rr(ctx, 720, 284, 78, 22, 6);
  paint(ctx, P.cream, 2);
  ctx.font = "700 11px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.ink;
  ctx.fillText("RESTROOM", 759, 296);

  plankFloor(ctx, room, SPORTSBAR_WALL_Y, P.floorA, P.floorLine);
  drawExitMat(ctx, 400, 988, P);
  drawFrontRim(ctx, room);
}

// The big screen over the bar (a prop, so the standby art can
// breathe). Its inner surface IS BAR_SCREEN — the same 16:9
// rect the screen-share <video> is pinned to in Mission
// Control, because a broadcast lights up both rooms at once.
// The two wall TVs that used to hang here (a looping fake
// game) are gone: this is the one screen in the bar now.
function drawBarScreen(ctx, p, P, theme, t) {
  const S = BAR_SCREEN;
  if (theme === "dark") {
    ell(ctx, S.x + S.w / 2, S.y + S.h / 2, S.w * 0.62, S.h * 0.72);
    ctx.fillStyle = P.glow;
    ctx.fill();
  }
  // bezel
  rr(ctx, S.x - 18, S.y - 18, S.w + 36, S.h + 36, 14);
  paint(ctx, P.frame, 3.5);
  // the 16:9 panel
  rr(ctx, S.x, S.y, S.w, S.h, 6);
  ctx.fillStyle = P.screen;
  ctx.fill();
  ctx.strokeStyle = shade(P.frame, 0.18);
  ctx.lineWidth = 2;
  ctx.stroke();
  // scanlines
  ctx.fillStyle = P.scan;
  for (let y = S.y + 8; y < S.y + S.h - 6; y += 14) {
    ctx.fillRect(S.x + 6, y, S.w - 12, 4);
  }
  // Panel art. While a feed is up the real picture is a DOM
  // <video> pinned over this exact rect, so the canvas gets out
  // of its way and only keeps the bezel and the tally light.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (screenFeed !== "live") {
    ctx.font = "700 56px Oswald, 'Arial Narrow', sans-serif";
    ctx.fillStyle = "rgba(247,240,220,0.85)";
    ctx.fillText("HSPN", S.x + S.w / 2, S.y + S.h / 2 - 34);
    const a = 0.35 + 0.22 * Math.sin(t * 2.1);
    ctx.font = "700 18px Oswald, 'Arial Narrow', sans-serif";
    ctx.fillStyle = "rgba(124,196,224," + a.toFixed(3) + ")";
    ctx.fillText(
      screenFeed === "connecting"
        ? "I N C O M I N G   F E E D"
        : "A W A I T I N G   F E E D",
      S.x + S.w / 2,
      S.y + S.h / 2 + 14
    );
    // house bug along the bottom, so an idle screen still
    // looks like a sports bar and not a dead panel
    rr(ctx, S.x + 26, S.y + S.h - 60, S.w - 52, 32, 7);
    paint(ctx, P.frame, 2);
    ctx.font = "700 13px Oswald, 'Arial Narrow', sans-serif";
    ctx.fillStyle = P.cream;
    ctx.fillText(
      "HSPN SPORTS BAR   ·   GAME OF THE WEEK",
      S.x + S.w / 2,
      S.y + S.h - 44
    );
  }
  // Tally light: blinks on standby, holds solid red on air.
  const on = screenFeed === "live" ? true : Math.floor(t * 1.2) % 2 === 0;
  circle(ctx, S.x + S.w - 22, S.y + 22, 6);
  paint(ctx, on ? P.red : shade(P.red, -0.45), 1.5);
}

// The back bar: bottles against the wall behind the counter.
// It used to be painted into the background up on the wall —
// the big screen has that wall now, so the bottles stand where
// a real back bar stands.
function drawBackBar(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 212, 12);
  rr(ctx, p.x - 210, p.y - 96, 420, 96, 8);
  paint(ctx, P.shelf, 3);
  // recessed back panel the bottles stand against
  rr(ctx, p.x - 198, p.y - 88, 396, 50, 5);
  paint(ctx, shade(P.shelf, -0.22), 2);
  // bottle shelf
  rr(ctx, p.x - 198, p.y - 44, 396, 9, 4);
  paint(ctx, shade(P.shelf, 0.16), 2);
  for (let i = 0; i < 13; i++) {
    const bx = p.x - 186 + i * 30;
    rr(ctx, bx, p.y - 76, 13, 32, 4);
    paint(ctx, BOTTLE_COLORS[i % BOTTLE_COLORS.length], 1.5);
    rr(ctx, bx + 4, p.y - 84, 5, 10, 2);
    paint(ctx, shade(BOTTLE_COLORS[i % BOTTLE_COLORS.length], -0.3), 1);
  }
  // cabinet doors under the shelf
  for (const dx of [-153, -51, 51, 153]) {
    rr(ctx, p.x + dx - 46, p.y - 30, 92, 24, 5);
    paint(ctx, shade(P.shelf, 0.1), 2);
    circle(ctx, p.x + dx + 34, p.y - 18, 3);
    paint(ctx, P.brass, 1.2);
  }
  ctx.strokeStyle = P.brass;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(p.x - 204, p.y - 92);
  ctx.lineTo(p.x + 204, p.y - 92);
  ctx.stroke();
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
  height: 1030,
  // Same reason as Mission Control: the big screen is mounted
  // ABOVE the floor (BAR_SCREEN sits at y 100-442; the walkable
  // floor starts at y 586) and the camera follows your feet, so
  // the room has to be fitted to the viewport instead of just
  // width-fitted or the screen is cropped. 800 wide is not an
  // accident either — it keeps the whole 608px screen inside a
  // phone-width viewport at the fit floor.
  fitRoom: true,
  spawn: { x: 400, y: 945 },
  palette: { light: SPORTSBAR_LIGHT, dark: SPORTSBAR_DARK },

  walkable: [
    { x: 40, y: 586 },
    { x: 760, y: 586 },
    { x: 768, y: 1000 },
    { x: 32, y: 1000 },
  ],

  exits: [
    {
      id: "town-square",
      label: "Town Square",
      roomId: "town-square",
      hotspot: { x: 306, y: 924, w: 188, h: 106 },
      approach: { x: 400, y: 976 },
      arrive: { x: 780, y: 560 },
    },
    {
      id: "restroom",
      label: "Restroom",
      roomId: "restroom",
      hotspot: { x: 716, y: 284, w: 86, h: 276 },
      approach: { x: 740, y: 604 },
      arrive: { x: 200, y: 680 },
    },
  ],

  props: [
    { id: "barscreen", x: 400, y: 104, sortY: 2, draw: drawBarScreen },
    // The footprint runs up to the walkable polygon's top edge
    // so nobody can stand in the sliver BEHIND the back bar and
    // vanish behind it. The gap between it and the counter is
    // walkable on purpose — that is the bartender's spot.
    { id: "backbar", x: 400, y: 624, draw: drawBackBar, footprint: { x: 190, y: 580, w: 420, h: 46 } },
    { id: "bar", x: 400, y: 720, draw: drawBarCounter, footprint: { x: 200, y: 674, w: 400, h: 46 } },
    { id: "stool-1", x: 250, y: 770, draw: drawBarStool, footprint: { x: 235, y: 754, w: 30, h: 18 } },
    { id: "stool-2", x: 350, y: 770, draw: drawBarStool, footprint: { x: 335, y: 754, w: 30, h: 18 } },
    { id: "stool-3", x: 450, y: 770, draw: drawBarStool, footprint: { x: 435, y: 754, w: 30, h: 18 } },
    { id: "stool-4", x: 550, y: 770, draw: drawBarStool, footprint: { x: 535, y: 754, w: 30, h: 18 } },
    { id: "table-l", x: 150, y: 890, draw: drawPubTable, footprint: { x: 86, y: 850, w: 128, h: 42 } },
    { id: "table-r", x: 650, y: 890, draw: drawPubTable, footprint: { x: 586, y: 850, w: 128, h: 42 } },
    { id: "jukebox", x: 78, y: 810, draw: drawJukebox, footprint: { x: 44, y: 787, w: 68, h: 24 } },
  ],

  drawBackground: drawSportsBarBackground,
};

// ============================================================
// Milestone 8 — the secret room chain (Sports Bar easter egg)
// ------------------------------------------------------------
// Restroom → (tap the toilet; the wall it's mounted on spins
// 180° into a tunnel mouth) → Hidden Hallway → (steel blast
// door + number pad, code-locked) → Mission Control, a bunker
// for watching football with ONE big 16:9 wall screen.
//
// Two config keys are new here, both read by the room engine:
//   interact[]   tappable hotspots that flip a per-visit
//                CLIENT flag — `type: "reveal"` flips it
//                instantly (the prop animates off the flag's
//                trigger time), `type: "keypad"` opens the
//                full-screen keypad and flips it on the right
//                code
//   exits[].requiresFlag   the exit only answers once that
//                flag is set
//
// Flags are client-side only: every player discovers the chain
// for themselves, peers don't see your wall move, and a reload
// closes everything again. The keypad code lives right here in
// client code — theater for a friendly-league easter egg, not
// security. The rooms themselves are ordinary registry rooms:
// multiplayer, chat, capacity and moderation all just work.
// ============================================================

// Exit mat with a custom label (the Town Square one predates
// door mats needing to say anything else).
function drawMat(ctx, x, y, P, label) {
  softShadow(ctx, x, y + 14, 78, 12);
  rr(ctx, x - 74, y - 26, 148, 44, 14);
  paint(ctx, P.mat, 2.5);
  ctx.font = "700 13px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.matText;
  ctx.fillText(label, x, y - 7);
  ctx.beginPath();
  ctx.moveTo(x - 7, y + 5);
  ctx.lineTo(x + 7, y + 5);
  ctx.lineTo(x, y + 14);
  ctx.closePath();
  ctx.fillStyle = P.matText;
  ctx.fill();
}

// A flat-bottomed brick arch with a dark throat — used for the
// cavity behind the restroom's secret panel, the back face of
// the spun panel, and the hallway's mouth back out.
function drawTunnelMouth(ctx, P, cx, top, bottom, halfW) {
  rr(ctx, cx - halfW, top, halfW * 2, bottom - top, 8);
  paint(ctx, P.brick, 3);
  const r = halfW - 14;
  const cy = top + r + 12;
  ctx.beginPath();
  ctx.moveTo(cx - r, bottom);
  ctx.lineTo(cx - r, cy);
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.lineTo(cx + r, bottom);
  ctx.closePath();
  ctx.fillStyle = P.tunnel;
  ctx.fill();
  // deeper arch → the tunnel recedes
  const r2 = Math.round(r * 0.6);
  ctx.beginPath();
  ctx.moveTo(cx - r2, bottom - 14);
  ctx.lineTo(cx - r2, cy + 8);
  ctx.arc(cx, cy + 8, r2, Math.PI, 0);
  ctx.lineTo(cx + r2, bottom - 14);
  ctx.closePath();
  ctx.fillStyle = P.tunnelDeep;
  ctx.fill();
  // radial brick joints on the rim
  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + ((i + 0.5) * Math.PI) / 7;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r, Math.min(cy + Math.sin(a) * r, bottom));
    ctx.lineTo(
      cx + Math.cos(a) * (halfW - 2),
      Math.min(cy + Math.sin(a) * (halfW - 2), bottom)
    );
    ctx.stroke();
  }
}

// ---- Restroom ----------------------------------------------

const RESTROOM_LIGHT = {
  outside: "#1d2735",
  marker: "rgba(0,87,184,0.7)",
  wall: "#d7e9e7",
  tile: "rgba(70,120,115,0.20)",
  band: "#5fa8a0",
  baseboard: "#9cc4bf",
  floorA: "#eef1ee",
  floorB: "#d3dcd8",
  stall: "#7f94ad",
  porcelain: "#f6f9fa",
  chrome: "#aab6bf",
  tunnel: "#1a1f2a",
  tunnelDeep: "#0a0d13",
  brick: "#4a5364",
  glass: "#bfe6f7",
  mat: "#2a7de1",
  matText: "#f7f0dc",
  ink: "#2b2620",
  cream: "#f7f0dc",
};

const RESTROOM_DARK = {
  outside: "#10161f",
  marker: "rgba(255,255,255,0.8)",
  wall: "#9fb4b2",
  tile: "rgba(20,45,42,0.30)",
  band: "#417b74",
  baseboard: "#6e8f8a",
  floorA: "#b9bfb9",
  floorB: "#9aa39e",
  stall: "#5f7085",
  porcelain: "#dde4e7",
  chrome: "#88949c",
  tunnel: "#12161e",
  tunnelDeep: "#06080c",
  brick: "#3a4351",
  glass: "#8fc4dd",
  mat: "#2a6dc4",
  matText: "#e8dfc8",
  ink: "#241f1a",
  cream: "#e8dfc8",
};

const RESTROOM_WALL_Y = 330;
// The spinning wall segment — the tunnel cavity behind it is
// painted in the background layer; the panel prop covers it
// exactly until the toilet is tapped.
const PANEL = { cx: 515, top: 122, bottom: 352, halfW: 82 };

function drawRestroomBackground(ctx, room, theme) {
  const P = room.palette[theme];
  // tiled wall + accent band
  ctx.fillStyle = P.wall;
  ctx.fillRect(0, 0, room.width, RESTROOM_WALL_Y);
  ctx.strokeStyle = P.tile;
  ctx.lineWidth = 2;
  for (let x = 40; x < room.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, RESTROOM_WALL_Y - 10);
    ctx.stroke();
  }
  for (let y = 40; y < RESTROOM_WALL_Y - 8; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(room.width, y);
    ctx.stroke();
  }
  ctx.fillStyle = P.band;
  ctx.fillRect(0, 56, room.width, 12);

  // the cavity the secret panel hides
  drawTunnelMouth(ctx, P, PANEL.cx, PANEL.top, PANEL.bottom, PANEL.halfW);

  rr(ctx, -6, RESTROOM_WALL_Y - 14, room.width + 12, 18, 4);
  paint(ctx, P.baseboard, 2);

  // mirrors + pedestal sinks
  for (const sx of [120, 265]) {
    rr(ctx, sx - 44, 88, 88, 100, 10);
    paint(ctx, P.chrome, 2.5);
    rr(ctx, sx - 36, 96, 72, 84, 6);
    paint(ctx, P.glass, 2);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx - 20, 168);
    ctx.lineTo(sx + 8, 108);
    ctx.stroke();
    rr(ctx, sx - 42, 232, 84, 30, 12);
    paint(ctx, P.porcelain, 2.5);
    rr(ctx, sx - 13, 262, 26, 58, 7);
    paint(ctx, P.porcelain, 2);
    rr(ctx, sx - 4, 212, 8, 24, 3);
    paint(ctx, P.chrome, 1.5);
  }
  // hand dryer
  rr(ctx, 352, 210, 44, 52, 8);
  paint(ctx, P.chrome, 2.5);
  rr(ctx, 362, 252, 24, 8, 3);
  paint(ctx, shade(P.chrome, -0.2), 1.5);

  checkerFloor(ctx, room, RESTROOM_WALL_Y, P.floorA, P.floorB, 40);
  drawMat(ctx, 200, 688, P, "SPORTS BAR");
  drawFrontRim(ctx, room);
}

// One chest-high stall-front segment (two of these flank the
// doorway gap; `door: true` hangs the open door off its edge).
function drawStallSeg(ctx, p, P) {
  const top = p.y - 132;
  const x0 = p.x - p.w / 2;
  softShadow(ctx, p.x, p.y, p.w * 0.62, 8);
  rr(ctx, x0, top, p.w, 126, 7);
  paint(ctx, P.stall, 2.5);
  rr(ctx, x0 + 7, top + 8, p.w - 14, 110, 5);
  ctx.fillStyle = shade(P.stall, 0.1);
  ctx.fill();
  for (const lx of [x0 + 6, x0 + p.w - 13]) {
    rr(ctx, lx, p.y - 10, 7, 10, 2);
    paint(ctx, P.chrome, 1.2);
  }
  if (p.door) {
    rr(ctx, x0 - 13, top - 4, 12, 130, 5);
    paint(ctx, shade(P.stall, -0.1), 2);
  }
}

function drawWetCone(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 18, 6);
  ctx.beginPath();
  ctx.moveTo(p.x - 16, p.y);
  ctx.lineTo(p.x - 4, p.y - 34);
  ctx.lineTo(p.x + 4, p.y - 34);
  ctx.lineTo(p.x + 16, p.y);
  ctx.closePath();
  paint(ctx, "#f2a41b", 2);
  rr(ctx, p.x - 20, p.y - 6, 40, 8, 3);
  paint(ctx, "#f2a41b", 2);
  rr(ctx, p.x - 9, p.y - 24, 18, 7, 3);
  ctx.fillStyle = P.cream;
  ctx.fill();
}

// The star of the show: the wall segment the toilet hangs on.
// Closed, it's indistinguishable from the rest of the wall.
// Tap the toilet (engine flips `tunnelOpen`) and it spins 180°
// about its vertical axis — the horizontal scale runs through
// cos(angle), the toilet rides the front face away, and the
// back face turns out to be a brick arch framing the tunnel.
function drawSecretWall(ctx, p, P, theme, t, fx) {
  const { cx, top, bottom, halfW } = PANEL;
  const open = !!(fx && fx.flags && fx.flags.tunnelOpen);
  const t0 = open && fx.times && fx.times.tunnelOpen ? fx.times.tunnelOpen : 0;
  const FLIP_S = 1.6;
  const raw = open ? Math.min(1, Math.max(0, (t - t0) / FLIP_S)) : 0;
  const e = raw * raw * (3 - 2 * raw); // smoothstep
  const c = Math.cos(e * Math.PI);
  const spinning = open && raw < 1;

  if (spinning) {
    // rumble dust kicked up along the floor line
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let i = 0; i < 6; i++) {
      const ph = (t * 2 + i * 0.37) % 1;
      ell(
        ctx,
        cx + Math.sin(i * 51.7) * (halfW - 10),
        bottom + 4 - ph * 26,
        9 * (1 - ph) + 2,
        4 * (1 - ph) + 1
      );
      ctx.fill();
    }
  }

  const wScale = Math.max(Math.abs(c), 0.05);
  const shake = spinning ? Math.sin(t * 42) * 1.5 : 0;
  ctx.save();
  ctx.translate(cx + shake, 0);
  ctx.scale(wScale, 1);
  ctx.translate(-cx, 0);
  if (c >= 0) {
    // FRONT face: tiles + the toilet, mounted on the panel
    rr(ctx, cx - halfW, top, halfW * 2, bottom - top, 6);
    paint(ctx, P.wall, 3);
    ctx.strokeStyle = P.tile;
    ctx.lineWidth = 2;
    for (let gx = cx - halfW + 40; gx < cx + halfW; gx += 40) {
      ctx.beginPath();
      ctx.moveTo(gx, top + 6);
      ctx.lineTo(gx, bottom - 6);
      ctx.stroke();
    }
    for (let gy = top + 38; gy < bottom - 6; gy += 40) {
      ctx.beginPath();
      ctx.moveTo(cx - halfW + 6, gy);
      ctx.lineTo(cx + halfW - 6, gy);
      ctx.stroke();
    }
    // toilet: tank, flush button, bowl, seat, pedestal
    rr(ctx, cx - 34, bottom - 128, 68, 46, 9);
    paint(ctx, P.porcelain, 2.5);
    rr(ctx, cx - 12, bottom - 120, 24, 9, 3);
    paint(ctx, P.chrome, 1.5);
    rr(ctx, cx - 26, bottom - 82, 52, 30, 10);
    paint(ctx, P.porcelain, 2.5);
    ell(ctx, cx, bottom - 46, 36, 17);
    paint(ctx, P.porcelain, 2.5);
    ell(ctx, cx, bottom - 46, 23, 10);
    ctx.fillStyle = shade(P.porcelain, -0.14);
    ctx.fill();
    rr(ctx, cx - 15, bottom - 30, 30, 24, 8);
    paint(ctx, P.porcelain, 2);
    // TP roll on the panel edge
    circle(ctx, cx - halfW + 18, bottom - 92, 10);
    paint(ctx, P.porcelain, 2);
    circle(ctx, cx - halfW + 18, bottom - 92, 4);
    ctx.fillStyle = shade(P.porcelain, -0.2);
    ctx.fill();
  } else {
    // BACK face: brick arch framing the tunnel
    drawTunnelMouth(ctx, P, cx, top, bottom, halfW);
    if (!spinning) {
      const a = 0.1 + 0.05 * Math.sin(t * 2);
      ctx.fillStyle = "rgba(242,200,27," + a.toFixed(3) + ")";
      const r = halfW - 14;
      const cy = top + r + 12;
      ctx.beginPath();
      ctx.moveTo(cx - r, bottom);
      ctx.lineTo(cx - r, cy);
      ctx.arc(cx, cy, r, Math.PI, 0);
      ctx.lineTo(cx + r, bottom);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

const RESTROOM = {
  id: "restroom",
  name: "Restroom",
  capacity: 8,
  width: 640,
  height: 760,
  spawn: { x: 200, y: 680 },
  palette: { light: RESTROOM_LIGHT, dark: RESTROOM_DARK },

  walkable: [
    { x: 40, y: 362 },
    { x: 600, y: 362 },
    { x: 608, y: 730 },
    { x: 32, y: 730 },
  ],

  exits: [
    {
      id: "sports-bar",
      label: "Sports Bar",
      roomId: "sports-bar",
      hotspot: { x: 120, y: 636, w: 160, h: 100 },
      approach: { x: 200, y: 692 },
      arrive: { x: 740, y: 610 },
    },
    {
      id: "hidden-hallway",
      label: "Tunnel",
      roomId: "hidden-hallway",
      requiresFlag: "tunnelOpen",
      hotspot: { x: 433, y: 118, w: 164, h: 238 },
      approach: { x: 515, y: 420 },
      arrive: { x: 130, y: 420 },
    },
  ],

  interact: [
    {
      id: "toilet",
      type: "reveal",
      flag: "tunnelOpen",
      hotspot: { x: 455, y: 218, w: 120, h: 140 },
    },
  ],

  props: [
    { id: "secret-wall", x: 515, y: 356, sortY: 356, draw: drawSecretWall },
    { id: "stall-l", x: 440, y: 505, w: 52, draw: drawStallSeg, footprint: { x: 414, y: 489, w: 52, h: 18 } },
    { id: "stall-r", x: 582, y: 505, w: 66, door: true, draw: drawStallSeg, footprint: { x: 549, y: 489, w: 66, h: 18 } },
    { id: "cone", x: 320, y: 470, draw: drawWetCone, footprint: { x: 306, y: 462, w: 28, h: 14 } },
  ],

  drawBackground: drawRestroomBackground,
};

// ---- Hidden Hallway ----------------------------------------

const HALLWAY_LIGHT = {
  outside: "#0d1016",
  marker: "rgba(255,255,255,0.8)",
  wall: "#555c6b",
  wallLine: "rgba(0,0,0,0.20)",
  floorA: "#666e7c",
  floorLine: "rgba(0,0,0,0.28)",
  pipe: "#79828f",
  pipeDark: "#5b636f",
  steel: "#b6c0ca",
  steelDark: "#7f8a95",
  plate: "#98a3ad",
  tunnel: "#1a1f2a",
  tunnelDeep: "#0a0d13",
  brick: "#4a5364",
  lamp: "#ffd97a",
  lampGlow: "rgba(255,214,110,0.20)",
  ledBad: "#e2543f",
  ledOk: "#3fae5f",
  mat: "#2a7de1",
  matText: "#f7f0dc",
  ink: "#2b2620",
  cream: "#f7f0dc",
};

const HALLWAY_DARK = {
  outside: "#080a0f",
  marker: "rgba(255,255,255,0.8)",
  wall: "#3a4150",
  wallLine: "rgba(0,0,0,0.30)",
  floorA: "#454c59",
  floorLine: "rgba(0,0,0,0.35)",
  pipe: "#59626f",
  pipeDark: "#454d59",
  steel: "#9aa4ae",
  steelDark: "#6a747f",
  plate: "#7f8a94",
  tunnel: "#12161e",
  tunnelDeep: "#06080c",
  brick: "#333b48",
  lamp: "#ffd97a",
  lampGlow: "rgba(255,214,110,0.30)",
  ledBad: "#e2543f",
  ledOk: "#3fae5f",
  mat: "#2a6dc4",
  matText: "#e8dfc8",
  ink: "#241f1a",
  cream: "#e8dfc8",
};

const HALLWAY_WALL_Y = 300;
// The blast door (and the cavity it slides away from).
const VAULT = { cx: 745, top: 92, bottom: 322, halfW: 76 };

function drawHallwayBackground(ctx, room, theme) {
  const P = room.palette[theme];
  ctx.fillStyle = P.wall;
  ctx.fillRect(0, 0, room.width, HALLWAY_WALL_Y);
  // concrete block joints
  ctx.strokeStyle = P.wallLine;
  ctx.lineWidth = 2;
  let row = 0;
  for (let y = 44; y < HALLWAY_WALL_Y; y += 44, row++) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(room.width, y);
    ctx.stroke();
    const off = row % 2 === 0 ? 30 : 74;
    for (let x = off; x < room.width; x += 88) {
      ctx.beginPath();
      ctx.moveTo(x, y - 44);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }
  // pipes along the ceiling line
  rr(ctx, -6, 14, room.width + 12, 14, 7);
  paint(ctx, P.pipe, 2.5);
  rr(ctx, -6, 34, room.width + 12, 9, 5);
  paint(ctx, P.pipeDark, 2);
  for (let x = 60; x < room.width; x += 160) {
    rr(ctx, x, 10, 8, 38, 3);
    paint(ctx, P.steelDark, 1.5);
  }

  // stenciled warning
  ctx.font = "700 19px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(247,240,220,0.38)";
  ctx.fillText("SUB-LEVEL  •  AUTHORIZED PERSONNEL ONLY", 440, 70);

  // tunnel mouth back to the restroom, left end
  drawTunnelMouth(ctx, P, 124, 96, 322, 76);

  // caged work lamps
  for (const lx of [340, 560]) {
    if (P.lampGlow) {
      ell(ctx, lx, 130, 54, 44);
      ctx.fillStyle = P.lampGlow;
      ctx.fill();
    }
    rr(ctx, lx - 16, 96, 32, 18, 8);
    paint(ctx, P.steelDark, 2);
    circle(ctx, lx, 124, 11);
    paint(ctx, P.lamp, 2);
    ctx.strokeStyle = P.steelDark;
    ctx.lineWidth = 1.5;
    for (const dx of [-7, 0, 7]) {
      ctx.beginPath();
      ctx.moveTo(lx + dx, 114);
      ctx.lineTo(lx + dx * 1.2, 134);
      ctx.stroke();
    }
    if (P.lampGlow) {
      ell(ctx, lx, 336, 88, 22);
      ctx.fillStyle = P.lampGlow;
      ctx.fill();
    }
  }

  // baseboard + worn concrete floor
  rr(ctx, -6, HALLWAY_WALL_Y - 12, room.width + 12, 16, 4);
  paint(ctx, shade(P.wall, -0.22), 2);
  ctx.fillStyle = P.floorA;
  ctx.fillRect(0, HALLWAY_WALL_Y, room.width, room.height - HALLWAY_WALL_Y);
  ctx.strokeStyle = P.floorLine;
  ctx.lineWidth = 2;
  for (let y = HALLWAY_WALL_Y + 52; y < room.height; y += 62) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(room.width, y);
    ctx.stroke();
  }
  // a couple of cracks
  ctx.beginPath();
  ctx.moveTo(240, 380);
  ctx.lineTo(280, 412);
  ctx.lineTo(268, 448);
  ctx.moveTo(620, 470);
  ctx.lineTo(668, 452);
  ctx.lineTo(700, 470);
  ctx.stroke();
  drawFrontRim(ctx, room);
}

function drawBarrel(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 26, 8);
  rr(ctx, p.x - 22, p.y - 56, 44, 56, 10);
  paint(ctx, P.steelDark, 2.5);
  for (const by of [-44, -18]) {
    rr(ctx, p.x - 23, p.y + by, 46, 7, 3);
    paint(ctx, P.plate, 1.5);
  }
  ell(ctx, p.x, p.y - 56, 22, 7);
  paint(ctx, P.plate, 2);
}

// The steel blast door. Closed: riveted slab, blinking red LED
// on the keypad box. The right code flips `vaultOpen` and the
// slab rolls sideways into the jamb (clipped), spilling a red
// ops glow from the doorway.
function drawVaultDoor(ctx, p, P, theme, t, fx) {
  const { cx, top, bottom, halfW } = VAULT;
  const open = !!(fx && fx.flags && fx.flags.vaultOpen);
  const t0 = open && fx.times && fx.times.vaultOpen ? fx.times.vaultOpen : 0;
  const SLIDE_S = 1.4;
  const raw = open ? Math.min(1, Math.max(0, (t - t0) / SLIDE_S)) : 0;
  const e = raw * raw * (3 - 2 * raw);

  // jamb + dark cavity
  rr(ctx, cx - halfW - 14, top - 14, halfW * 2 + 28, bottom - top + 20, 10);
  paint(ctx, P.steelDark, 3);
  ctx.fillStyle = P.tunnelDeep;
  ctx.fillRect(cx - halfW, top, halfW * 2, bottom - top);
  if (open) {
    const a = 0.08 + 0.12 * e + (raw >= 1 ? 0.05 * Math.sin(t * 2) : 0);
    ctx.fillStyle = "rgba(226,84,63," + a.toFixed(3) + ")";
    ctx.fillRect(cx - halfW, top, halfW * 2, bottom - top);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(cx - halfW + 16 + i * 6, bottom - i * 16);
      ctx.lineTo(cx + halfW - 16 - i * 6, bottom - i * 16);
      ctx.stroke();
    }
  }

  // the sliding slab, clipped to the doorway
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - halfW, top, halfW * 2, bottom - top);
  ctx.clip();
  ctx.translate(-e * (halfW * 2 - 4), 0);
  rr(ctx, cx - halfW + 2, top + 2, halfW * 2 - 4, bottom - top - 4, 6);
  paint(ctx, P.steel, 3);
  ctx.strokeStyle = shade(P.steel, -0.12);
  ctx.lineWidth = 1.5;
  for (const ly of [top + 40, (top + bottom) / 2 + 44]) {
    ctx.beginPath();
    ctx.moveTo(cx - halfW + 10, ly);
    ctx.lineTo(cx + halfW - 10, ly);
    ctx.stroke();
  }
  for (const rx of [cx - halfW + 14, cx + halfW - 14]) {
    for (let ry = top + 18; ry < bottom - 10; ry += 34) {
      circle(ctx, rx, ry, 3.5);
      paint(ctx, P.plate, 1);
    }
  }
  ctx.font = "700 14px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(43,38,32,0.6)";
  ctx.fillText("RESTRICTED", cx, top + 26);
  // wheel
  const wy = (top + bottom) / 2 + 4;
  circle(ctx, cx, wy, 26);
  paint(ctx, P.plate, 2.5);
  ctx.strokeStyle = P.steelDark;
  ctx.lineWidth = 4;
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, wy);
    ctx.lineTo(cx + Math.cos(a) * 24, wy + Math.sin(a) * 24);
    ctx.stroke();
  }
  circle(ctx, cx, wy, 7);
  paint(ctx, P.steelDark, 1.5);
  // hazard stripes along the base of the slab
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - halfW + 4, bottom - 26, halfW * 2 - 8, 22);
  ctx.clip();
  for (let x = cx - halfW - 20; x < cx + halfW + 20; x += 24) {
    ctx.fillStyle = (x / 24) % 2 ? "#f2c81b" : "#2b2620";
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x + 12, bottom - 26);
    ctx.lineTo(x + 24, bottom - 26);
    ctx.lineTo(x + 12, bottom);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();

  // keypad box on the jamb
  const kx = cx + halfW + 40;
  rr(ctx, kx - 16, 172, 32, 50, 5);
  paint(ctx, P.plate, 2);
  rr(ctx, kx - 11, 178, 22, 10, 2);
  ctx.fillStyle = P.ink;
  ctx.fill();
  for (let r2 = 0; r2 < 3; r2++) {
    for (let c2 = 0; c2 < 3; c2++) {
      circle(ctx, kx - 6 + c2 * 6, 196 + r2 * 7, 1.9);
      ctx.fillStyle = shade(P.plate, -0.3);
      ctx.fill();
    }
  }
  const blink = Math.floor(t * 1.6) % 2 === 0;
  circle(ctx, kx, 230, 3.5);
  paint(ctx, open ? P.ledOk : blink ? P.ledBad : shade(P.ledBad, -0.45), 1.2);
}

const HIDDEN_HALLWAY = {
  id: "hidden-hallway",
  name: "Hidden Hallway",
  capacity: 8,
  width: 900,
  height: 560,
  spawn: { x: 130, y: 430 },
  palette: { light: HALLWAY_LIGHT, dark: HALLWAY_DARK },

  walkable: [
    { x: 40, y: 332 },
    { x: 860, y: 332 },
    { x: 868, y: 530 },
    { x: 32, y: 530 },
  ],

  exits: [
    {
      id: "restroom",
      label: "Restroom",
      roomId: "restroom",
      hotspot: { x: 46, y: 96, w: 156, h: 234 },
      approach: { x: 124, y: 366 },
      arrive: { x: 515, y: 430 },
    },
    {
      id: "mission-control",
      label: "Mission Control",
      roomId: "mission-control",
      requiresFlag: "vaultOpen",
      hotspot: { x: 669, y: 92, w: 152, h: 238 },
      approach: { x: 745, y: 366 },
      arrive: { x: 480, y: 760 },
    },
  ],

  interact: [
    {
      id: "vault",
      type: "keypad",
      flag: "vaultOpen",
      code: "2723",
      hotspot: { x: 655, y: 78, w: 215, h: 256 },
      title: "Blast Door",
      subtitle: "Enter access code",
    },
  ],

  props: [
    { id: "vault-door", x: 745, y: 330, sortY: 300, draw: drawVaultDoor },
    { id: "barrel-1", x: 420, y: 466, draw: drawBarrel, footprint: { x: 396, y: 450, w: 48, h: 18 } },
    { id: "barrel-2", x: 470, y: 452, draw: drawBarrel, footprint: { x: 446, y: 436, w: 48, h: 18 } },
  ],

  drawBackground: drawHallwayBackground,
};

// ---- Mission Control ---------------------------------------

// The big board's inner surface — EXACTLY 16:9 (608 × 342).
// Future milestones draw the football feed inside this rect;
// the frame + standby art live in drawBigBoard below.
export const MISSION_SCREEN = { x: 176, y: 36, w: 608, h: 342 };

const MISSION_LIGHT = {
  outside: "#0a0e16",
  marker: "rgba(255,255,255,0.8)",
  wall: "#28324a",
  wallLine: "rgba(0,0,0,0.25)",
  trim: "#e2543f",
  floorA: "#2e3549",
  floorB: "#272d3f",
  desk: "#38445f",
  deskTop: "#495779",
  frame: "#141a26",
  screen: "#0b1322",
  scan: "rgba(124,196,224,0.06)",
  blue: "#7cc4e0",
  green: "#3fae5f",
  amber: "#f2c81b",
  red: "#e2543f",
  steel: "#9aa4ab",
  glow: "rgba(124,196,224,0.10)",
  glass: "#bfe6f7",
  mat: "#2a7de1",
  matText: "#f7f0dc",
  ink: "#0e1218",
  cream: "#f7f0dc",
};

const MISSION_DARK = {
  outside: "#06080d",
  marker: "rgba(255,255,255,0.8)",
  wall: "#1c2436",
  wallLine: "rgba(0,0,0,0.30)",
  trim: "#c34733",
  floorA: "#232837",
  floorB: "#1d2230",
  desk: "#2c374e",
  deskTop: "#3a4763",
  frame: "#10151f",
  screen: "#0a111e",
  scan: "rgba(124,196,224,0.08)",
  blue: "#7cc4e0",
  green: "#3fae5f",
  amber: "#f2c81b",
  red: "#e2543f",
  steel: "#8a949b",
  glow: "rgba(124,196,224,0.16)",
  glass: "#8fc4dd",
  mat: "#2a6dc4",
  matText: "#e8dfc8",
  ink: "#0e1218",
  cream: "#e8dfc8",
};

const MISSION_WALL_Y = 420;

function drawMissionBackground(ctx, room, theme) {
  const P = room.palette[theme];
  ctx.fillStyle = P.wall;
  ctx.fillRect(0, 0, room.width, MISSION_WALL_Y);

  // side pillars with light strips
  for (const px of [28, 932]) {
    rr(ctx, px - 12, 24, 24, 380, 8);
    paint(ctx, shade(P.wall, -0.18), 2.5);
    rr(ctx, px - 4, 40, 8, 348, 4);
    ctx.fillStyle = P.blue;
    ctx.fill();
  }

  // system status board, left of the screen
  rr(ctx, 60, 92, 88, 148, 8);
  paint(ctx, shade(P.wall, -0.2), 2.5);
  ctx.font = "700 11px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.cream;
  ctx.fillText("SYS", 72, 108);
  const barCols = [P.green, P.amber, P.green, P.blue, P.green, P.amber];
  const barWs = [56, 40, 64, 34, 50, 44];
  for (let i = 0; i < 6; i++) {
    rr(ctx, 72, 120 + i * 18, barWs[i], 8, 4);
    paint(ctx, barCols[i], 1.2);
  }

  // world clocks, right of the screen
  rr(ctx, 824, 92, 88, 148, 8);
  paint(ctx, shade(P.wall, -0.2), 2.5);
  const zones = [
    ["EAST", 1.1],
    ["CENT", 2.2],
    ["WEST", 3.9],
  ];
  for (let i = 0; i < zones.length; i++) {
    const cy = 124 + i * 44;
    circle(ctx, 850, cy, 13);
    paint(ctx, P.cream, 1.5);
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(850, cy);
    ctx.lineTo(850, cy - 8);
    ctx.moveTo(850, cy);
    ctx.lineTo(850 + 7 * Math.cos(zones[i][1]), cy + 7 * Math.sin(zones[i][1]));
    ctx.stroke();
    ctx.font = "700 11px Oswald, 'Arial Narrow', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = P.cream;
    ctx.fillText(zones[i][0], 870, cy);
  }

  // red trim stripe + baseboard
  ctx.fillStyle = P.trim;
  ctx.fillRect(0, MISSION_WALL_Y - 26, room.width, 10);
  rr(ctx, -6, MISSION_WALL_Y - 14, room.width + 12, 18, 4);
  paint(ctx, shade(P.wall, -0.25), 2);

  checkerFloor(ctx, room, MISSION_WALL_Y, P.floorA, P.floorB, 48);
  drawMat(ctx, 480, 812, P, "HALLWAY");
  drawFrontRim(ctx, room);
}

// The big board (a prop so the standby art can breathe). ONE
// wall screen, front and center, inner surface = MISSION_SCREEN
// and exactly 16:9 — the rect the screen-share <video> is
// pinned to (milestone 9).
function drawBigBoard(ctx, p, P, theme, t) {
  const S = MISSION_SCREEN;
  if (theme === "dark") {
    ell(ctx, S.x + S.w / 2, S.y + S.h / 2, S.w * 0.62, S.h * 0.72);
    ctx.fillStyle = P.glow;
    ctx.fill();
  }
  rr(ctx, S.x - 18, S.y - 18, S.w + 36, S.h + 36, 14);
  paint(ctx, P.frame, 3.5);
  // the 16:9 panel
  rr(ctx, S.x, S.y, S.w, S.h, 6);
  ctx.fillStyle = P.screen;
  ctx.fill();
  ctx.strokeStyle = shade(P.frame, 0.18);
  ctx.lineWidth = 2;
  ctx.stroke();
  // scanlines
  ctx.fillStyle = P.scan;
  for (let y = S.y + 8; y < S.y + S.h - 6; y += 14) {
    ctx.fillRect(S.x + 6, y, S.w - 12, 4);
  }
  // viewfinder corner brackets
  ctx.strokeStyle = "rgba(124,196,224,0.35)";
  ctx.lineWidth = 3;
  const M = 14;
  const B = 26;
  for (const [sx, sy, dx, dy] of [
    [S.x + M, S.y + M, 1, 1],
    [S.x + S.w - M, S.y + M, -1, 1],
    [S.x + M, S.y + S.h - M, 1, -1],
    [S.x + S.w - M, S.y + S.h - M, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(sx + dx * B, sy);
    ctx.lineTo(sx, sy);
    ctx.lineTo(sx, sy + dy * B);
    ctx.stroke();
  }
  // Panel art. While a feed is up the real picture is a DOM
  // <video> pinned over this exact rect, so the canvas gets out
  // of its way and only keeps the bezel and the tally light.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (screenFeed !== "live") {
    ctx.font = "700 56px Oswald, 'Arial Narrow', sans-serif";
    ctx.fillStyle = "rgba(247,240,220,0.85)";
    ctx.fillText("HSPN", S.x + S.w / 2, S.y + S.h / 2 - 26);
    const a = 0.35 + 0.22 * Math.sin(t * 2.1);
    ctx.font = "700 18px Oswald, 'Arial Narrow', sans-serif";
    ctx.fillStyle = "rgba(124,196,224," + a.toFixed(3) + ")";
    ctx.fillText(
      screenFeed === "connecting"
        ? "I N C O M I N G   F E E D"
        : "A W A I T I N G   F E E D",
      S.x + S.w / 2,
      S.y + S.h / 2 + 22
    );
  }
  // Tally light: blinks on standby, holds solid red on air.
  const on = screenFeed === "live" ? true : Math.floor(t * 1.2) % 2 === 0;
  circle(ctx, S.x + S.w - 24, S.y + S.h - 20, 6);
  paint(ctx, on ? P.red : shade(P.red, -0.45), 1.5);
  // nameplate under the board
  rr(ctx, S.x + S.w / 2 - 78, S.y + S.h + 22, 156, 20, 6);
  paint(ctx, P.frame, 2);
  ctx.font = "700 12px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillStyle = P.cream;
  ctx.fillText("MISSION CONTROL", S.x + S.w / 2, S.y + S.h + 32);
}

// Operator consoles face the big board, so the camera sees
// monitor backs with screen-glow spilling around the edges.
function drawConsole(ctx, p, P, theme, t) {
  softShadow(ctx, p.x, p.y, 88, 11);
  rr(ctx, p.x - 82, p.y - 44, 164, 38, 8);
  paint(ctx, P.desk, 2.5);
  rr(ctx, p.x - 90, p.y - 58, 180, 20, 9);
  paint(ctx, P.deskTop, 2.5);
  const seed = p.seed || 0;
  for (let i = 0; i < 2; i++) {
    const mx = p.x - 46 + i * 50;
    const col = [P.green, P.amber, P.blue, P.red][(seed + i) % 4];
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.45 + 0.2 * Math.sin(t * 1.7 + i * 2 + seed);
    ctx.lineWidth = 3;
    rr(ctx, mx - 2, p.y - 102, 46, 40, 6);
    ctx.stroke();
    ctx.globalAlpha = 1;
    rr(ctx, mx, p.y - 100, 42, 36, 5);
    paint(ctx, P.frame, 2);
    rr(ctx, mx + 17, p.y - 66, 8, 10, 2);
    paint(ctx, shade(P.frame, 0.15), 1.5);
  }
  for (let i = 0; i < 5; i++) {
    const on = Math.floor(t * 2 + i + seed) % 3 !== 0;
    circle(ctx, p.x - 56 + i * 28, p.y - 50, 2.6);
    ctx.fillStyle = on ? [P.green, P.amber, P.blue][i % 3] : shade(P.desk, -0.2);
    ctx.fill();
  }
}

function drawServerRack(ctx, p, P, theme, t) {
  softShadow(ctx, p.x, p.y, 34, 9);
  rr(ctx, p.x - 30, p.y - 118, 60, 118, 8);
  paint(ctx, P.frame, 2.5);
  for (let r2 = 0; r2 < 5; r2++) {
    rr(ctx, p.x - 23, p.y - 108 + r2 * 21, 46, 15, 3);
    paint(ctx, shade(P.frame, 0.14), 1.5);
    for (let i = 0; i < 3; i++) {
      const on = Math.floor(t * 3 + r2 * 2 + i) % 4 !== 0;
      circle(ctx, p.x + 6 + i * 8, p.y - 100 + r2 * 21, 2);
      ctx.fillStyle = on ? [P.green, P.amber, P.blue][i] : "#333a46";
      ctx.fill();
    }
  }
}

function drawWaterCooler(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 20, 7);
  rr(ctx, p.x - 16, p.y - 74, 32, 74, 7);
  paint(ctx, P.steel, 2);
  rr(ctx, p.x - 13, p.y - 104, 26, 32, 8);
  paint(ctx, P.glass, 2);
  rr(ctx, p.x - 8, p.y - 46, 16, 7, 3);
  paint(ctx, P.frame, 1.5);
}

const MISSION_CONTROL = {
  id: "mission-control",
  name: "Mission Control",
  capacity: 12,
  width: 960,
  height: 880,
  // The big board is mounted ABOVE the floor (MISSION_SCREEN
  // sits at y 36-378; the walkable floor starts at y 452), and
  // the camera follows your feet — so a width-fitted zoom can
  // leave the top of the screen permanently out of reach on a
  // wide, short desktop window. fitRoom tells the engine to
  // zoom out until the whole room fits the viewport. Set it on
  // any room whose art must be seen but cannot be walked to.
  fitRoom: true,
  spawn: { x: 480, y: 760 },
  palette: { light: MISSION_LIGHT, dark: MISSION_DARK },

  walkable: [
    { x: 48, y: 452 },
    { x: 912, y: 452 },
    { x: 920, y: 848 },
    { x: 40, y: 848 },
  ],

  exits: [
    {
      id: "hidden-hallway",
      label: "Hidden Hallway",
      roomId: "hidden-hallway",
      hotspot: { x: 396, y: 780, w: 168, h: 68 },
      approach: { x: 480, y: 806 },
      arrive: { x: 745, y: 380 },
    },
  ],

  props: [
    { id: "bigboard", x: 480, y: 40, sortY: 2, draw: drawBigBoard },
    { id: "console-1", x: 260, y: 570, seed: 0, draw: drawConsole, footprint: { x: 180, y: 550, w: 160, h: 22 } },
    { id: "console-2", x: 480, y: 570, seed: 1, draw: drawConsole, footprint: { x: 400, y: 550, w: 160, h: 22 } },
    { id: "console-3", x: 700, y: 570, seed: 2, draw: drawConsole, footprint: { x: 620, y: 550, w: 160, h: 22 } },
    { id: "console-4", x: 370, y: 700, seed: 3, draw: drawConsole, footprint: { x: 290, y: 680, w: 160, h: 22 } },
    { id: "console-5", x: 590, y: 700, seed: 4, draw: drawConsole, footprint: { x: 510, y: 680, w: 160, h: 22 } },
    { id: "rack", x: 96, y: 560, draw: drawServerRack, footprint: { x: 66, y: 540, w: 60, h: 22 } },
    { id: "cooler", x: 872, y: 560, draw: drawWaterCooler, footprint: { x: 852, y: 544, w: 40, h: 18 } },
  ],

  drawBackground: drawMissionBackground,
};

// ---- registry ----------------------------------------------

// ============================================================
// Milestone 14 — the Casino
// ------------------------------------------------------------
// Town Square grew a paved spur east (see TOWN_SQUARE.walkable
// above: the polygon itself is the path, so the plaza slab
// code paves and curbs it for free) with a bulb-lit arrow sign
// pointing down it. The spur's far end is a door like any
// other, into:
//
//   casino-strip   outdoor plaza, one building: the casino,
//                  under a marquee that never stops blinking
//   casino-floor   the floor itself — patterned carpet, slot
//                  machines along the walls (decorative), and
//                  a BLACKJACK TABLE in the middle
//
// Both are ordinary registry rooms: multiplayer, chat,
// tomatoes, moderation and capacity all just work, because
// nothing about them is special-cased anywhere.
//
// The one new config key is `seats` on casino-floor — tappable
// chairs, handled by the room engine the same way `exits` are
// (tap → walk to `approach` → ask the server for the seat).
// Where a seated player's avatar is PAINTED is `anchor`, and
// that is the only thing the world view needs to know about a
// game of blackjack.
// ============================================================

// Marquee bulbs: n lamps evenly spaced around a rounded rect,
// chasing at `speed` cycles/sec. The one flourish this whole
// wing of the world is built on, so it lives in one function.
function marqueeBulbs(ctx, x, y, w, h, n, t, P, speed = 2.2, phase = 0) {
  const per = Math.max(8, Math.round(n / 4));
  const pts = [];
  for (let i = 0; i < per; i += 1) {
    const f = i / per;
    pts.push([x + w * f, y]);
    pts.push([x + w - w * f, y + h]);
  }
  for (let i = 0; i < Math.max(3, Math.round(per * (h / Math.max(w, 1)) * 2)); i += 1) {
    const f = i / Math.max(3, Math.round(per * (h / Math.max(w, 1)) * 2));
    pts.push([x + w, y + h * f]);
    pts.push([x, y + h - h * f]);
  }
  const step = Math.floor(t * speed * 3 + phase);
  pts.forEach((pt, i) => {
    const on = (i + step) % 3 === 0;
    if (on && P.bulbGlow) {
      circle(ctx, pt[0], pt[1], 8.5);
      ctx.fillStyle = P.bulbGlow;
      ctx.fill();
    }
    circle(ctx, pt[0], pt[1], 3.6);
    ctx.fillStyle = on ? P.bulbOn : P.bulbOff;
    ctx.fill();
    ctx.strokeStyle = "rgba(60,40,10,0.35)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });
}

// ---- Town Square: the arrow that points down the path ------
// A proper roadside arrow sign — two posts, a fat rounded
// board with a chevron nose on the right, CASINO across it,
// and bulbs chasing around the whole perimeter toward the tip.

function drawCasinoArrow(ctx, p, P, theme, t) {
  const time = t || 0;
  softShadow(ctx, p.x, p.y, 66, 13);
  // posts
  for (const dx of [-34, 34]) {
    rr(ctx, p.x + dx - 7, p.y - 104, 14, 106, 6);
    paint(ctx, P.signPost, 2.5);
  }
  const w = 176;
  const h = 92;
  const x = p.x - w / 2 - 10;
  const y = p.y - 210;
  const nose = 46;

  // board: rounded slab + chevron nose pointing east
  ctx.beginPath();
  ctx.moveTo(x + 14, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w + nose, y + h / 2);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + 14, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - 14);
  ctx.lineTo(x, y + 14);
  ctx.quadraticCurveTo(x, y, x + 14, y);
  ctx.closePath();
  paint(ctx, P.signBoard, 3);

  // inner panel
  rr(ctx, x + 12, y + 12, w - 24, h - 24, 10);
  paint(ctx, P.signInner, 2);

  // CASINO
  ctx.save();
  ctx.font = "700 34px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (P.signGlow) {
    ctx.shadowColor = P.signGlow;
    ctx.shadowBlur = 16;
  }
  ctx.fillStyle = P.signText;
  ctx.fillText("CASINO", x + w / 2 - 4, y + h / 2 + 1);
  ctx.restore();

  // chasing bulbs around the slab, plus three up the nose so
  // the chase visibly runs INTO the point
  marqueeBulbs(ctx, x + 6, y + 6, w - 12, h - 12, 26, time, P, 2.4);
  for (let i = 0; i < 3; i += 1) {
    const f = i / 3;
    const bx = x + w + nose * (0.25 + f * 0.55);
    const by = y + h / 2 + (i === 1 ? 0 : 0);
    const on = (Math.floor(time * 7) + i) % 3 === 0;
    if (on && P.bulbGlow) {
      circle(ctx, bx, by, 8);
      ctx.fillStyle = P.bulbGlow;
      ctx.fill();
    }
    circle(ctx, bx, by, 3.6);
    ctx.fillStyle = on ? P.bulbOn : P.bulbOff;
    ctx.fill();
  }
  // little "this way" plate under the board
  rr(ctx, p.x - 52, p.y - 112, 96, 24, 7);
  paint(ctx, P.signPost, 2);
  ctx.font = "700 12px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.cream;
  ctx.fillText("THIS WAY", p.x - 4, p.y - 99);
}

// ============================================================
// casino-strip — outdoors, one building
// ============================================================

const STRIP_LIGHT = {
  outside: "#2b3350",
  marker: "rgba(255,255,255,0.75)",
  sky: "#4a5486",
  skyLow: "#8d7ea8",
  star: "#f2eeff",
  hill: "#39406a",
  ground: "#4a4a58",
  groundLine: "rgba(255,255,255,0.10)",
  walk: "#b9b3c4",
  walkLine: "rgba(60,50,70,0.22)",
  curb: "#8e879c",
  body: "#5b2f6e",
  bodyDark: "#43214f",
  trim: "#f2c81b",
  glass: "#2a3550",
  glassLit: "#ffd97a",
  door: "#f2c81b",
  doorGlass: "#ffe9a8",
  signBoard: "#c8203c",
  signInner: "#8e1230",
  signText: "#ffe9a8",
  signGlow: "rgba(255,214,110,0.55)",
  signPost: "#3a3350",
  bulbOn: "#fff3c4",
  bulbOff: "#8b7f5e",
  bulbGlow: "rgba(255,225,150,0.35)",
  neon: "#ff5fa2",
  neonAlt: "#5fe3ff",
  planter: "#3f5f45",
  leaf: "#4fae52",
  leafDark: "#3f9a47",
  mat: "#c8203c",
  matText: "#ffe9a8",
  ink: "#2b2620",
  cream: "#f7f0dc",
};

const STRIP_DARK = {
  ...STRIP_LIGHT,
  outside: "#141a2e",
  sky: "#141c38",
  skyLow: "#3a2f57",
  hill: "#1d2440",
  ground: "#2b2b36",
  groundLine: "rgba(255,255,255,0.08)",
  walk: "#7d778a",
  walkLine: "rgba(20,16,26,0.35)",
  curb: "#5d5769",
  body: "#421f52",
  bodyDark: "#2d1338",
  glass: "#161f36",
  bulbOff: "#6a5f45",
  bulbGlow: "rgba(255,225,150,0.5)",
  signGlow: "rgba(255,214,110,0.7)",
  cream: "#e8dfc8",
  matText: "#ffe9a8",
};

const STRIP_GROUND_Y = 520; // where the building meets the lot
const STRIP_STARS = [
  [60, 60], [140, 120], [232, 48], [318, 96], [402, 40], [498, 112],
  [566, 62], [660, 122], [742, 44], [830, 100], [900, 58], [50, 176],
  [286, 168], [610, 178], [878, 166],
];

function drawStripBackground(ctx, room, theme) {
  const P = room.palette[theme];
  const W = room.width;
  const H = room.height;

  // sky: a dusk gradient, because a casino is always at night
  const g = ctx.createLinearGradient(0, 0, 0, STRIP_GROUND_Y);
  g.addColorStop(0, P.sky);
  g.addColorStop(1, P.skyLow);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, STRIP_GROUND_Y);
  ctx.fillStyle = P.star;
  for (const [sx, sy] of STRIP_STARS) ctx.fillRect(sx, sy, 2.5, 2.5);

  // low hills on the horizon
  ctx.fillStyle = P.hill;
  ell(ctx, 120, 512, 240, 78);
  ctx.fill();
  ell(ctx, 520, 520, 320, 92);
  ctx.fill();
  ell(ctx, 880, 508, 220, 70);
  ctx.fill();

  // ---- the casino itself --------------------------------
  const bx = 148;
  const bw = 664;
  const top = 128;
  // main block
  rr(ctx, bx, top, bw, STRIP_GROUND_Y - top + 8, 16);
  paint(ctx, P.body, 3);
  // darker plinth
  rr(ctx, bx + 10, STRIP_GROUND_Y - 92, bw - 20, 96, 10);
  paint(ctx, P.bodyDark, 2.5);
  // gold cornice
  rr(ctx, bx - 8, top - 16, bw + 16, 26, 9);
  paint(ctx, P.trim, 2.5);

  // windows: two rows, some lit
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 9; c += 1) {
      const wx = bx + 40 + c * 68;
      const wy = top + 40 + r * 78;
      rr(ctx, wx, wy, 44, 54, 7);
      paint(ctx, (r * 9 + c) % 3 === 0 ? P.glassLit : P.glass, 2);
    }
  }

  // entrance: a lit portal under an awning
  const ex = 400;
  rr(ctx, ex, STRIP_GROUND_Y - 150, 160, 152, 12);
  paint(ctx, P.bodyDark, 2.5);
  rr(ctx, ex + 14, STRIP_GROUND_Y - 132, 132, 134, 10);
  paint(ctx, P.doorGlass, 2.5);
  // door mullions
  ctx.strokeStyle = P.door;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(ex + 80, STRIP_GROUND_Y - 132);
  ctx.lineTo(ex + 80, STRIP_GROUND_Y + 2);
  ctx.stroke();
  // awning over the doors
  ctx.beginPath();
  ctx.moveTo(ex - 16, STRIP_GROUND_Y - 152);
  ctx.lineTo(ex + 176, STRIP_GROUND_Y - 152);
  ctx.lineTo(ex + 150, STRIP_GROUND_Y - 190);
  ctx.lineTo(ex + 10, STRIP_GROUND_Y - 190);
  ctx.closePath();
  paint(ctx, P.signBoard, 2.5);

  // neon pin-stripes up the corners
  for (const nx of [bx + 16, bx + bw - 16]) {
    ctx.strokeStyle = P.neon;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(nx, top + 12);
    ctx.lineTo(nx, STRIP_GROUND_Y - 100);
    ctx.stroke();
    ctx.strokeStyle = P.neonAlt;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ---- the lot ------------------------------------------
  ctx.fillStyle = P.ground;
  ctx.fillRect(0, STRIP_GROUND_Y, W, H - STRIP_GROUND_Y);

  // sidewalk slab = the walkable polygon, same trick the
  // Town Square plaza uses (curb stroke, then slab)
  polyPath(ctx, room.walkable);
  ctx.lineJoin = "round";
  ctx.strokeStyle = P.curb;
  ctx.lineWidth = 30;
  ctx.stroke();
  polyPath(ctx, room.walkable);
  ctx.fillStyle = P.walk;
  ctx.fill();
  ctx.strokeStyle = P.walk;
  ctx.lineWidth = 20;
  ctx.stroke();

  ctx.save();
  polyPath(ctx, room.walkable);
  ctx.clip();
  ctx.strokeStyle = P.walkLine;
  ctx.lineWidth = 2;
  for (let y = STRIP_GROUND_Y + 40; y < H; y += 58) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  for (let x = 40; x < W; x += 86) {
    ctx.beginPath();
    ctx.moveTo(x, STRIP_GROUND_Y);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.restore();

  // red carpet from the doors to the kerb
  rr(ctx, 452, STRIP_GROUND_Y - 4, 96, 120, 8);
  paint(ctx, P.signBoard, 2.5);
}

// The big blinking marquee over the doors. A prop, not
// background, because it animates every frame.
function drawStripMarquee(ctx, p, P, theme, t) {
  const time = t || 0;
  const w = 336;
  const h = 128;
  const x = p.x - w / 2;
  const y = p.y - h;

  rr(ctx, x - 10, y - 10, w + 20, h + 20, 16);
  paint(ctx, P.signPost, 3);
  rr(ctx, x, y, w, h, 12);
  paint(ctx, P.signBoard, 3);
  rr(ctx, x + 12, y + 12, w - 24, h - 24, 9);
  paint(ctx, P.signInner, 2);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (P.signGlow) {
    ctx.shadowColor = P.signGlow;
    ctx.shadowBlur = 18;
  }
  ctx.fillStyle = P.signText;
  ctx.font = "700 26px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillText("HSPN", p.x, y + 40);
  ctx.font = "700 52px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillText("CASINO", p.x, y + 84);
  ctx.restore();

  ctx.font = "700 13px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = P.trim;
  ctx.fillText("BLACKJACK · LOOSE SLOTS · NO CLOCKS", p.x, y + 112);

  marqueeBulbs(ctx, x + 6, y + 6, w - 12, h - 12, 40, time, P, 2.0);
}

function drawStripLamp(ctx, p, P, theme, t) {
  softShadow(ctx, p.x, p.y, 20, 7);
  rr(ctx, p.x - 5, p.y - 118, 10, 120, 5);
  paint(ctx, P.signPost, 2.5);
  const glow = 0.55 + 0.45 * Math.sin((t || 0) * 1.6 + p.x);
  if (P.bulbGlow) {
    circle(ctx, p.x, p.y - 128, 26);
    ctx.fillStyle = `rgba(255,225,150,${0.16 * glow})`;
    ctx.fill();
  }
  circle(ctx, p.x, p.y - 128, 13);
  paint(ctx, P.bulbOn, 2.5);
}

function drawPlanter(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 34, 10);
  rr(ctx, p.x - 30, p.y - 34, 60, 36, 8);
  paint(ctx, P.planter, 2.5);
  circle(ctx, p.x - 14, p.y - 56, 22);
  paint(ctx, P.leafDark, 2.5);
  circle(ctx, p.x + 14, p.y - 58, 20);
  paint(ctx, P.leaf, 2.5);
  circle(ctx, p.x, p.y - 76, 19);
  paint(ctx, P.leaf, 2.5);
}

function drawValetSign(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 22, 7);
  rr(ctx, p.x - 4, p.y - 74, 8, 76, 4);
  paint(ctx, P.signPost, 2.5);
  rr(ctx, p.x - 44, p.y - 112, 88, 42, 8);
  paint(ctx, P.trim, 2.5);
  ctx.font = "700 15px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.ink;
  ctx.fillText("VALET", p.x, p.y - 99);
  ctx.font = "700 10px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillText("(HONOR SYSTEM)", p.x, p.y - 82);
}

const CASINO_STRIP = {
  id: "casino-strip",
  name: "Casino Strip",
  capacity: 20,
  width: 960,
  height: 900,
  // The marquee hangs at y 236-364, well above the walkable
  // floor (y 596+), and the camera follows your feet — same
  // reason Mission Control and the Sports Bar set this.
  fitRoom: true,
  spawn: { x: 150, y: 700 },
  palette: { light: STRIP_LIGHT, dark: STRIP_DARK },

  walkable: [
    { x: 40, y: 596 },
    { x: 920, y: 596 },
    { x: 936, y: 660 },
    { x: 936, y: 856 },
    { x: 24, y: 856 },
    { x: 24, y: 660 },
  ],

  exits: [
    {
      id: "casino-floor",
      label: "Casino",
      roomId: "casino-floor",
      hotspot: { x: 400, y: 330, w: 160, h: 262 },
      approach: { x: 480, y: 622 },
      arrive: { x: 450, y: 906 },
    },
    {
      id: "town-square",
      label: "Town Square",
      roomId: "town-square",
      hotspot: { x: 24, y: 640, w: 92, h: 216 },
      approach: { x: 62, y: 748 },
      arrive: { x: 1060, y: 702 },
    },
  ],

  props: [
    { id: "marquee", x: 480, y: 364, sortY: 2, draw: drawStripMarquee },
    { id: "lamp-l", x: 236, y: 646, draw: drawStripLamp, footprint: { x: 222, y: 636, w: 28, h: 14 } },
    { id: "lamp-r", x: 724, y: 646, draw: drawStripLamp, footprint: { x: 710, y: 636, w: 28, h: 14 } },
    { id: "planter-l", x: 356, y: 664, draw: drawPlanter, footprint: { x: 322, y: 634, w: 68, h: 32 } },
    { id: "planter-r", x: 604, y: 664, draw: drawPlanter, footprint: { x: 570, y: 634, w: 68, h: 32 } },
    { id: "valet", x: 830, y: 700, draw: drawValetSign, footprint: { x: 812, y: 690, w: 36, h: 16 } },
    { id: "exitmat", x: 62, y: 800, draw: (ctx, p, P) => drawMat(ctx, p.x, p.y, P, "TOWN SQUARE") },
  ],

  drawBackground: drawStripBackground,
};

// ============================================================
// casino-floor — carpet, slots, and the blackjack table
// ============================================================

const FLOOR_LIGHT = {
  outside: "#241733",
  marker: "rgba(255,255,255,0.75)",
  wall: "#5b2f6e",
  wallDark: "#43214f",
  crown: "#f2c81b",
  carpetA: "#7d1533",
  carpetB: "#6a1029",
  carpetC: "#f2c81b",
  carpetD: "#2a7de1",
  baseboard: "#3a1a45",
  felt: "#1f7a4d",
  feltDark: "#17603c",
  feltLine: "#f2e9d2",
  rail: "#7a4a2c",
  railHi: "#a06a3e",
  chipR: "#e2543f",
  chipG: "#3fae5f",
  chipB: "#2a7de1",
  chipK: "#2b2620",
  chipW: "#f7f0dc",
  slotBody: "#c8203c",
  slotBody2: "#2a7de1",
  slotBody3: "#f28c1b",
  slotTrim: "#f2c81b",
  slotGlass: "#1b2330",
  slotReel: "#f7f0dc",
  neon: "#ff5fa2",
  neonAlt: "#5fe3ff",
  bulbOn: "#fff3c4",
  bulbOff: "#8b7f5e",
  bulbGlow: "rgba(255,225,150,0.35)",
  cage: "#c9a227",
  cageBar: "#8a6f16",
  dealerShirt: "#f7f0dc",
  dealerVest: "#2b2620",
  dealerSkin: "#e6b98f",
  seat: "#8e1230",
  seatHi: "#c8203c",
  mat: "#c8203c",
  matText: "#ffe9a8",
  ink: "#2b2620",
  cream: "#f7f0dc",
};

const FLOOR_DARK = {
  ...FLOOR_LIGHT,
  outside: "#150e1f",
  wall: "#3f1f50",
  wallDark: "#2c1338",
  carpetA: "#5e0f26",
  carpetB: "#4c0a1d",
  baseboard: "#26102e",
  felt: "#186040",
  feltDark: "#114a30",
  rail: "#5f3822",
  railHi: "#7d4c2e",
  slotGlass: "#141a24",
  bulbOff: "#6a5f45",
  bulbGlow: "rgba(255,225,150,0.5)",
  cream: "#e8dfc8",
};

const FLOOR_WALL_Y = 300;

// The carpet: a loud repeating diamond-and-swirl pattern, the
// most casino thing there is. Drawn once into the cached
// background layer, so the cost is a one-off.
function drawCarpet(ctx, room, P) {
  const W = room.width;
  const H = room.height;
  ctx.fillStyle = P.carpetA;
  ctx.fillRect(0, FLOOR_WALL_Y, W, H - FLOOR_WALL_Y);

  const tile = 84;
  for (let y = FLOOR_WALL_Y; y < H; y += tile) {
    for (let x = 0; x < W; x += tile) {
      const cx = x + tile / 2;
      const cy = y + tile / 2;
      // dark diamond
      ctx.beginPath();
      ctx.moveTo(cx, y + 6);
      ctx.lineTo(x + tile - 6, cy);
      ctx.lineTo(cx, y + tile - 6);
      ctx.lineTo(x + 6, cy);
      ctx.closePath();
      ctx.fillStyle = P.carpetB;
      ctx.fill();
      // gold swirl
      ctx.strokeStyle = P.carpetC;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(cx, cy, 15, 0.5, 4.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 3.4, 6.6);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // blue pips at the corners
      ctx.fillStyle = P.carpetD;
      ctx.globalAlpha = 0.5;
      circle(ctx, x, y, 3.2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

function drawFloorBackground(ctx, room, theme) {
  const P = room.palette[theme];
  const W = room.width;

  // wall + crown moulding
  ctx.fillStyle = P.wall;
  ctx.fillRect(0, 0, W, FLOOR_WALL_Y);
  ctx.fillStyle = P.wallDark;
  ctx.fillRect(0, 0, W, 46);
  ctx.fillStyle = P.crown;
  ctx.fillRect(0, 46, W, 8);

  // ceiling downlights washing the wall
  for (let x = 70; x < W; x += 116) {
    const g = ctx.createRadialGradient(x, 54, 4, x, 54, 92);
    g.addColorStop(0, "rgba(255,225,150,0.34)");
    g.addColorStop(1, "rgba(255,225,150,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - 92, 54, 184, 150);
    circle(ctx, x, 54, 9);
    paint(ctx, P.bulbOn, 2);
  }

  // neon strip along the wall
  ctx.strokeStyle = P.neon;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(24, 214);
  ctx.lineTo(W - 24, 214);
  ctx.stroke();
  ctx.strokeStyle = P.neonAlt;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // cashier cage, back left
  const cx = 96;
  rr(ctx, cx - 76, 96, 200, 168, 10);
  paint(ctx, P.wallDark, 2.5);
  rr(ctx, cx - 62, 112, 172, 104, 8);
  paint(ctx, P.cage, 2.5);
  ctx.strokeStyle = P.cageBar;
  ctx.lineWidth = 3;
  for (let i = 0; i < 7; i += 1) {
    ctx.beginPath();
    ctx.moveTo(cx - 54 + i * 26, 116);
    ctx.lineTo(cx - 54 + i * 26, 212);
    ctx.stroke();
  }
  ctx.font = "700 17px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.cream;
  ctx.fillText("CASHIER", cx + 24, 240);

  // baseboard + carpet
  ctx.fillStyle = P.baseboard;
  ctx.fillRect(0, FLOOR_WALL_Y - 20, W, 20);
  drawCarpet(ctx, room, P);
  drawFrontRim(ctx, room);
}

// Decorative slot machine. Reels spin, the topper blinks.
// Nothing to play — deliberately: the one game on this floor
// is the one at the table.
function drawSlot(ctx, p, P, theme, t) {
  const time = t || 0;
  const tone = [P.slotBody, P.slotBody2, P.slotBody3][Math.abs(Math.round(p.x / 97)) % 3];
  softShadow(ctx, p.x, p.y, 40, 11);
  // cabinet
  rr(ctx, p.x - 36, p.y - 128, 72, 130, 10);
  paint(ctx, tone, 2.5);
  // topper
  rr(ctx, p.x - 28, p.y - 168, 56, 44, 8);
  paint(ctx, P.slotTrim, 2.5);
  const blink = (Math.floor(time * 2.4) + Math.round(p.x)) % 2 === 0;
  circle(ctx, p.x, p.y - 146, 9);
  paint(ctx, blink ? P.bulbOn : P.bulbOff, 2);
  if (blink && P.bulbGlow) {
    circle(ctx, p.x, p.y - 146, 17);
    ctx.fillStyle = P.bulbGlow;
    ctx.fill();
  }
  // screen + three reels, each drifting at its own rate
  rr(ctx, p.x - 27, p.y - 116, 54, 44, 6);
  paint(ctx, P.slotGlass, 2);
  ctx.save();
  rr(ctx, p.x - 27, p.y - 116, 54, 44, 6);
  ctx.clip();
  for (let r = 0; r < 3; r += 1) {
    const speed = 26 + r * 9;
    const off = ((time * speed + r * 40) % 26);
    for (let k = -1; k < 3; k += 1) {
      const sy = p.y - 116 + k * 26 + off;
      rr(ctx, p.x - 25 + r * 17, sy, 14, 22, 4);
      paint(ctx, P.slotReel, 1.5);
      ctx.fillStyle = [P.chipR, P.chipB, P.chipG][(k + r + 3) % 3];
      circle(ctx, p.x - 18 + r * 17, sy + 11, 4.5);
      ctx.fill();
    }
  }
  ctx.restore();
  // button deck + handle
  rr(ctx, p.x - 30, p.y - 64, 60, 16, 5);
  paint(ctx, P.slotTrim, 2);
  circle(ctx, p.x - 14, p.y - 56, 5);
  paint(ctx, P.chipR, 1.5);
  circle(ctx, p.x + 2, p.y - 56, 5);
  paint(ctx, P.chipG, 1.5);
  rr(ctx, p.x + 32, p.y - 108, 7, 40, 3);
  paint(ctx, P.railHi, 2);
  circle(ctx, p.x + 35, p.y - 112, 7);
  paint(ctx, P.chipR, 2);
}

// A stool at a slot machine (pure scenery).
function drawStool(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 20, 6);
  rr(ctx, p.x - 4, p.y - 34, 8, 34, 4);
  paint(ctx, P.rail, 2);
  ell(ctx, p.x, p.y - 38, 19, 8);
  paint(ctx, P.seatHi, 2.5);
}

// The blackjack table: felt half-round, dealer behind it, the
// three betting circles in front. The CARDS are not drawn here
// — the world view shows the table and who is sitting at it,
// and the game itself is the first-person view.
function drawBlackjackTable(ctx, p, P, theme, t) {
  const time = t || 0;
  const cx = p.x;
  const cy = p.y;
  softShadow(ctx, cx, cy + 10, 176, 34);

  // rail (the padded edge) then the felt inset
  ell(ctx, cx, cy - 26, 178, 96);
  paint(ctx, P.rail, 3);
  ell(ctx, cx, cy - 30, 162, 84);
  paint(ctx, P.railHi, 2);
  ell(ctx, cx, cy - 32, 146, 72);
  paint(ctx, P.felt, 2.5);

  // dealer's arc + the house rules, printed on the felt
  ctx.strokeStyle = P.feltLine;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 36, 104, 46, 0, Math.PI * 0.08, Math.PI * 0.92);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.font = "700 12px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.feltLine;
  ctx.globalAlpha = 0.85;
  ctx.fillText("BLACKJACK PAYS 3 TO 2", cx, cy - 54);
  ctx.font = "700 9px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillText("DEALER STANDS ON ALL 17s", cx, cy - 40);
  ctx.restore();

  // three betting circles, matching the three seats
  for (let i = 0; i < 3; i += 1) {
    const bx = cx + (i - 1) * 84;
    const by = cy - 12 + (i === 1 ? 8 : 0);
    ell(ctx, bx, by, 22, 11);
    ctx.strokeStyle = P.feltLine;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // shoe + discard tray on the dealer's right
  rr(ctx, cx + 96, cy - 86, 34, 24, 5);
  paint(ctx, P.chipK, 2);
  rr(ctx, cx + 100, cy - 92, 26, 10, 3);
  paint(ctx, P.cream, 1.5);
  rr(ctx, cx - 130, cy - 84, 30, 20, 4);
  paint(ctx, P.chipK, 2);

  // chip tray in front of the dealer
  rr(ctx, cx - 54, cy - 92, 108, 20, 6);
  paint(ctx, P.chipK, 2);
  const chipCols = [P.chipW, P.chipR, P.chipG, P.chipB, P.chipK];
  for (let i = 0; i < 5; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      ell(ctx, cx - 42 + i * 21, cy - 84 - k * 3, 8, 4);
      paint(ctx, chipCols[i], 1.2);
    }
  }

  // the dealer, standing behind the table
  const dy = cy - 116;
  // legs hidden behind the felt; body from the waist up
  rr(ctx, cx - 26, dy - 54, 52, 66, 14);
  paint(ctx, P.dealerVest, 2.5);
  rr(ctx, cx - 32, dy - 50, 16, 58, 8);
  paint(ctx, P.dealerShirt, 2);
  rr(ctx, cx + 16, dy - 50, 16, 58, 8);
  paint(ctx, P.dealerShirt, 2);
  // bow tie + collar
  rr(ctx, cx - 12, dy - 58, 24, 12, 4);
  paint(ctx, P.dealerShirt, 2);
  circle(ctx, cx, dy - 52, 5);
  paint(ctx, P.chipR, 1.5);
  // head
  circle(ctx, cx, dy - 76, 21);
  paint(ctx, P.dealerSkin, 2.5);
  ctx.fillStyle = P.ink;
  circle(ctx, cx - 7, dy - 79, 2.4);
  ctx.fill();
  circle(ctx, cx + 7, dy - 79, 2.4);
  ctx.fill();
  // hair
  ctx.beginPath();
  ctx.arc(cx, dy - 82, 21, Math.PI * 1.05, Math.PI * 1.95);
  ctx.closePath();
  paint(ctx, P.ink, 2);

  // a lazy "table is live" glow under the sign above
  const pulse = 0.5 + 0.5 * Math.sin(time * 1.4);
  rr(ctx, cx - 78, cy - 214, 156, 46, 10);
  paint(ctx, P.chipK, 2.5);
  ctx.save();
  ctx.font = "700 22px Oswald, 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (P.bulbGlow) {
    ctx.shadowColor = P.bulbGlow;
    ctx.shadowBlur = 6 + pulse * 12;
  }
  ctx.fillStyle = P.slotTrim;
  ctx.fillText("BLACKJACK", cx, cy - 191);
  ctx.restore();
}

// An empty chair at the table. When somebody is sitting in it
// the room engine paints their avatar on top — the chair keeps
// drawing underneath either way.
function drawTableChair(ctx, p, P) {
  softShadow(ctx, p.x, p.y, 22, 7);
  rr(ctx, p.x - 5, p.y - 30, 10, 30, 4);
  paint(ctx, P.rail, 2);
  ell(ctx, p.x, p.y - 34, 21, 9);
  paint(ctx, P.seat, 2.5);
  rr(ctx, p.x - 17, p.y - 74, 34, 40, 9);
  paint(ctx, P.seatHi, 2.5);
}

// Where a seated player's avatar is painted, and where you
// have to walk to before you can sit. Exported because the
// blackjack route and the room engine both need it, and it
// must never drift between them.
export const CASINO_TABLE_SEATS = [
  { index: 0, anchor: { x: 366, y: 724 }, approach: { x: 366, y: 764 }, hotspot: { x: 320, y: 640, w: 92, h: 116 } },
  { index: 1, anchor: { x: 450, y: 752 }, approach: { x: 450, y: 792 }, hotspot: { x: 406, y: 668, w: 88, h: 116 } },
  { index: 2, anchor: { x: 534, y: 724 }, approach: { x: 534, y: 764 }, hotspot: { x: 488, y: 640, w: 92, h: 116 } },
];

const CASINO_FLOOR = {
  id: "casino-floor",
  name: "Casino",
  capacity: 16,
  width: 900,
  height: 960,
  // The room reads as a room only if you can see the wall, the
  // cashier cage and the BLACKJACK sign over the table at the
  // same time as the felt — all of which sit above the floor.
  fitRoom: true,
  spawn: { x: 450, y: 906 },
  palette: { light: FLOOR_LIGHT, dark: FLOOR_DARK },

  walkable: [
    { x: 40, y: 620 },
    { x: 860, y: 620 },
    { x: 872, y: 700 },
    { x: 872, y: 930 },
    { x: 28, y: 930 },
    { x: 28, y: 700 },
  ],

  // The table itself is not walkable; the chairs in front of
  // it are where you stand to sit down.
  seats: CASINO_TABLE_SEATS,

  exits: [
    {
      id: "casino-strip",
      label: "Casino Strip",
      roomId: "casino-strip",
      hotspot: { x: 352, y: 860, w: 196, h: 100 },
      approach: { x: 450, y: 900 },
      arrive: { x: 480, y: 660 },
    },
  ],

  props: [
    { id: "table", x: 450, y: 660, sortY: 664, draw: drawBlackjackTable, footprint: { x: 300, y: 600, w: 300, h: 74 } },
    { id: "chair-0", x: 366, y: 724, sortY: 723, draw: drawTableChair, footprint: { x: 348, y: 712, w: 36, h: 16 } },
    { id: "chair-1", x: 450, y: 752, sortY: 751, draw: drawTableChair, footprint: { x: 432, y: 740, w: 36, h: 16 } },
    { id: "chair-2", x: 534, y: 724, sortY: 723, draw: drawTableChair, footprint: { x: 516, y: 712, w: 36, h: 16 } },
    { id: "slot-1", x: 120, y: 660, draw: drawSlot, footprint: { x: 84, y: 646, w: 72, h: 22 } },
    { id: "slot-2", x: 212, y: 660, draw: drawSlot, footprint: { x: 176, y: 646, w: 72, h: 22 } },
    { id: "slot-3", x: 688, y: 660, draw: drawSlot, footprint: { x: 652, y: 646, w: 72, h: 22 } },
    { id: "slot-4", x: 780, y: 660, draw: drawSlot, footprint: { x: 744, y: 646, w: 72, h: 22 } },
    { id: "slot-5", x: 96, y: 872, draw: drawSlot, footprint: { x: 60, y: 858, w: 72, h: 22 } },
    { id: "slot-6", x: 804, y: 872, draw: drawSlot, footprint: { x: 768, y: 858, w: 72, h: 22 } },
    { id: "stool-1", x: 120, y: 706, draw: drawStool, footprint: { x: 104, y: 698, w: 32, h: 14 } },
    { id: "stool-2", x: 212, y: 706, draw: drawStool, footprint: { x: 196, y: 698, w: 32, h: 14 } },
    { id: "stool-3", x: 688, y: 706, draw: drawStool, footprint: { x: 672, y: 698, w: 32, h: 14 } },
    { id: "stool-4", x: 780, y: 706, draw: drawStool, footprint: { x: 764, y: 698, w: 32, h: 14 } },
    { id: "exitmat", x: 450, y: 908, draw: (ctx, p, P) => drawMat(ctx, p.x, p.y, P, "STRIP") },
  ],

  drawBackground: drawFloorBackground,
  music: "casino",
};

export const ROOMS = {
  [TOWN_SQUARE.id]: TOWN_SQUARE,
  [GROCERY_STORE.id]: GROCERY_STORE,
  [FAST_FOOD.id]: FAST_FOOD,
  [SPORTS_BAR.id]: SPORTS_BAR,
  [RESTROOM.id]: RESTROOM,
  [HIDDEN_HALLWAY.id]: HIDDEN_HALLWAY,
  [MISSION_CONTROL.id]: MISSION_CONTROL,
  [CASINO_STRIP.id]: CASINO_STRIP,
  [CASINO_FLOOR.id]: CASINO_FLOOR,
};
export const DEFAULT_ROOM_ID = TOWN_SQUARE.id;

export function getRoom(id) {
  return ROOMS[id] || ROOMS[DEFAULT_ROOM_ID];
}

// ---- screens (milestone 12) --------------------------------
// Which rooms have a screen on the wall, and exactly where it
// is. Both rects are the SAME 16:9 size (608 x 342) because
// both show the same feed: the room engine pins one DOM
// <video> to whichever rect belongs to the room you walked
// into, and the pinning code never needs to know which room
// that is.
//
// SCREEN_CHANNEL is the other half of "one broadcast, two
// rooms". Signaling used to ride the room's own topic
// (neighborhood-rtc:<room>), which meant the broadcaster in
// Mission Control could never hear a viewer standing in the
// bar. Every room with a screen now shares ONE signaling
// topic, so the broadcaster's mesh spans both rooms with no
// second connection and no second announcement. Rooms without
// a screen open no signaling channel at all — they never had
// anything to say on one.
//
// Nothing about TRUST moved: the offer a viewer accepts still
// has to carry a grant minted by the admin-only broadcast
// route and bound to that viewer's own nonce
// (lib/neighborhood/broadcastGrant.js). The channel decides
// who can be *reached*, never who is believed.
export const SCREEN_CHANNEL = "big-board";

export const SCREENS = {
  [MISSION_CONTROL.id]: MISSION_SCREEN,
  [SPORTS_BAR.id]: BAR_SCREEN,
};

export const SCREEN_ROOM_IDS = Object.keys(SCREENS);

// The room a broadcast is started FROM (the Share My Screen
// button, the grant, the admin gate). It lights up every room
// in SCREENS.
export const BROADCAST_ROOM_ID = MISSION_CONTROL.id;

export function screenRectFor(roomId) {
  return SCREENS[roomId] || null;
}

export function roomHasScreen(roomId) {
  return !!SCREENS[roomId];
}

// The signaling topic suffix for a room: the shared board
// channel for rooms with a screen, null for everywhere else.
export function screenChannelFor(roomId) {
  return roomHasScreen(roomId) ? SCREEN_CHANNEL : null;
  }
