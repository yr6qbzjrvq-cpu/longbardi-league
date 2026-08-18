// Hail Mary — level data.
//
// The game runs in fixed world units (1000 x 600) and the canvas scales to fit,
// so a level looks the same on a phone as it does on a laptop. Every piece is
// an axis-aligned box; x and y are the centre of it.

export const WORLD_W = 1000;
export const WORLD_H = 600;
export const GROUND_Y = 540; // top surface of the turf

// density, hit points, and how bouncy each material is
export const MATERIALS = {
  wood: { density: 0.0011, hp: 60, rest: 0.16, fill: "#b07a3f", edge: "#8a5c2a" },
  stone: { density: 0.0026, hp: 190, rest: 0.08, fill: "#8a94a0", edge: "#6b747e" },
  glass: { density: 0.0006, hp: 22, rest: 0.05, fill: "#9fd4e8", edge: "#6fb2cc" },
  star: { density: 0.0009, hp: 26, rest: 0.2, fill: "#ffc53d", edge: "#e0a012" },
};

const col = (x, top, h, kind, w = 22) => ({
  x,
  y: GROUND_Y - top - h / 2,
  w,
  h,
  kind,
});
const beam = (x, top, w, kind, h = 24) => ({
  x,
  y: GROUND_Y - top - h / 2,
  w,
  h,
  kind,
});
const star = (x, top) => ({
  x,
  y: GROUND_Y - top - 17,
  w: 34,
  h: 34,
  kind: "star",
});

export const LEVELS = [
  {
    name: "Warm-Ups",
    balls: 3,
    blocks: [
      col(640, 0, 120, "wood"),
      col(760, 0, 120, "wood"),
      beam(700, 120, 160, "wood"),
      { x: 700, y: GROUND_Y - 168, w: 44, h: 36, kind: "glass" },
      star(700, 0),
    ],
  },
  {
    name: "Two-Minute Drill",
    balls: 4,
    blocks: [
      beam(650, 0, 190, "stone", 30),
      col(575, 30, 120, "glass", 20),
      col(725, 30, 120, "glass", 20),
      beam(650, 150, 180, "wood"),
      star(650, 30),
      { x: 650, y: GROUND_Y - 200, w: 40, h: 32, kind: "wood" },
      col(840, 0, 96, "wood", 20),
      col(920, 0, 96, "wood", 20),
      beam(880, 96, 110, "wood"),
      star(880, 0),
    ],
  },
  {
    name: "Fourth And Long",
    balls: 5,
    blocks: [
      col(620, 0, 140, "stone", 26),
      col(780, 0, 140, "stone", 26),
      beam(700, 140, 200, "stone"),
      star(700, 0),
      col(652, 164, 100, "wood", 20),
      col(748, 164, 100, "wood", 20),
      beam(700, 264, 140, "wood"),
      star(700, 164),
      { x: 700, y: GROUND_Y - 306, w: 46, h: 40, kind: "glass" },
      col(890, 0, 110, "glass", 20),
      beam(890, 110, 90, "wood"),
      star(890, 0),
    ],
  },
];
