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
//   exits[]                door hotspots; roomId: null means
//                          "opening soon" until milestone 6
//   buildings[]            facade data used by the background
//   drawBackground         paints everything that never sorts
//                          against players (sky, ground,
//                          facades) — cached offscreen
//
// Adding the Grocery Store interior later = write one more
// entry here. Draw fns receive a ctx but the module itself
// never touches window/document, so server code can import it
// for spawn/walkable/capacity data.
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

  // the door itself (tappable — interiors are milestone 6)
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

  // Tapping a hotspot walks the player to `approach`. roomId
  // null = interior not built yet → the engine shows a nudge.
  exits: [
    {
      id: "grocery-store",
      label: "Grocery Store",
      roomId: null,
      hotspot: { x: 36, y: 166, w: 288, h: 338 },
      approach: { x: 180, y: 548 },
    },
    {
      id: "fast-food",
      label: "Fast Food Place",
      roomId: null,
      hotspot: { x: 352, y: 166, w: 256, h: 338 },
      approach: { x: 480, y: 548 },
    },
    {
      id: "sports-bar",
      label: "Sports Bar",
      roomId: null,
      hotspot: { x: 636, y: 166, w: 288, h: 338 },
      approach: { x: 780, y: 548 },
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

export const ROOMS = { [TOWN_SQUARE.id]: TOWN_SQUARE };
export const DEFAULT_ROOM_ID = TOWN_SQUARE.id;

export function getRoom(id) {
  return ROOMS[id] || ROOMS[DEFAULT_ROOM_ID];
}
