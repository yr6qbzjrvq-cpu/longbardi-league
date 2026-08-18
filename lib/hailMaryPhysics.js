import { LEVELS, MATERIALS, WORLD_W, WORLD_H, GROUND_Y } from "./hailMaryLevels";

// A small axis-aligned rigid body world. No rotation: boxes slide, topple out
// of stacks and fall, which is enough for towers that come down convincingly
// and keeps the whole thing predictable on a phone.

export const GRAVITY = 1700;
export const STEP = 1 / 120; // fixed physics step
const ITER = 8; // solver passes per step; more = steadier stacks
const DMG_FLOOR = 160; // impact speed below this does no damage

export const SLING = { x: 152, y: GROUND_Y - 104 };
export const BALL_R = 15;
export const MAX_PULL = 132;
export const POWER = 8.4;
const BALL_MASS = 0.95;

function makeRect(b) {
  const m = MATERIALS[b.kind];
  const mass = b.w * b.h * m.density;
  return {
    t: "rect",
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    vx: 0,
    vy: 0,
    inv: 1 / mass,
    mass,
    rest: m.rest,
    kind: b.kind,
    hp: m.hp,
    maxHp: m.hp,
    dead: false,
  };
}

function makeStatic(x, y, w, h) {
  return {
    t: "rect",
    x,
    y,
    w,
    h,
    vx: 0,
    vy: 0,
    inv: 0,
    mass: Infinity,
    rest: 0.1,
    kind: "ground",
    hp: Infinity,
    dead: false,
  };
}

export function createWorld(index) {
  const level = LEVELS[index];
  const blocks = level.blocks.map(makeRect);
  return {
    level,
    blocks,
    statics: [
      makeStatic(WORLD_W / 2, GROUND_Y + 200, WORLD_W * 3, 400), // turf
      makeStatic(-60, WORLD_H / 2, 100, WORLD_H * 3), // left wall
    ],
    ball: null,
    ballsLeft: level.balls,
    drag: null,
    particles: [],
    settleTimer: 0,
    overTimer: 0,
    status: "aim",
    shake: 0,
  };
}

export function launch(world, px, py, vx, vy) {
  world.ball = {
    t: "circle",
    x: px,
    y: py,
    r: BALL_R,
    vx,
    vy,
    inv: 1 / BALL_MASS,
    mass: BALL_MASS,
    rest: 0.26,
    kind: "ball",
    hp: Infinity,
    dead: false,
  };
  world.ballsLeft -= 1;
  world.settleTimer = 0;
}

function rectRect(a, b) {
  const dx = b.x - a.x;
  const px = (a.w + b.w) / 2 - Math.abs(dx);
  if (px <= 0) return null;
  const dy = b.y - a.y;
  const py = (a.h + b.h) / 2 - Math.abs(dy);
  if (py <= 0) return null;
  if (px < py) return { nx: dx < 0 ? -1 : 1, ny: 0, pen: px };
  return { nx: 0, ny: dy < 0 ? -1 : 1, pen: py };
}

// normal points from the circle toward the rect
function circleRect(c, r) {
  const hx = r.w / 2;
  const hy = r.h / 2;
  const cx = Math.max(r.x - hx, Math.min(c.x, r.x + hx));
  const cy = Math.max(r.y - hy, Math.min(c.y, r.y + hy));
  const dx = cx - c.x;
  const dy = cy - c.y;
  const d = Math.hypot(dx, dy);
  if (d > c.r) return null;
  if (d > 1e-6) return { nx: dx / d, ny: dy / d, pen: c.r - d };
  const ox = hx + c.r - Math.abs(c.x - r.x);
  const oy = hy + c.r - Math.abs(c.y - r.y);
  if (ox < oy) return { nx: r.x > c.x ? 1 : -1, ny: 0, pen: ox };
  return { nx: 0, ny: r.y > c.y ? 1 : -1, pen: oy };
}

// resolves one contact and reports the closing speed, which drives damage
function resolve(a, b, n) {
  const inv = a.inv + b.inv;
  if (inv === 0) return 0;

  const corr = (Math.max(n.pen - 0.05, 0) / inv) * 0.7;
  a.x -= n.nx * corr * a.inv;
  a.y -= n.ny * corr * a.inv;
  b.x += n.nx * corr * b.inv;
  b.y += n.ny * corr * b.inv;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const vn = rvx * n.nx + rvy * n.ny;
  if (vn > 0) return 0;

  const e = Math.min(a.rest, b.rest);
  const j = (-(1 + e) * vn) / inv;
  a.vx -= j * n.nx * a.inv;
  a.vy -= j * n.ny * a.inv;
  b.vx += j * n.nx * b.inv;
  b.vy += j * n.ny * b.inv;

  let tx = rvx - vn * n.nx;
  let ty = rvy - vn * n.ny;
  const tl = Math.hypot(tx, ty);
  if (tl > 1e-4) {
    tx /= tl;
    ty /= tl;
    const jt = -(rvx * tx + rvy * ty) / inv;
    const mu = 0.45;
    const c = Math.max(-j * mu, Math.min(j * mu, jt));
    a.vx -= c * tx * a.inv;
    a.vy -= c * ty * a.inv;
    b.vx += c * tx * b.inv;
    b.vy += c * ty * b.inv;
  }
  return -vn;
}

function burst(w, body) {
  const color = MATERIALS[body.kind]?.fill || "#ffffff";
  const n = body.kind === "star" ? 22 : 12;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 120 + Math.random() * 260;
    w.particles.push({
      x: body.x,
      y: body.y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 120,
      life: 0.5 + Math.random() * 0.4,
      max: 0.9,
      color,
    });
  }
}

export function step(w) {
  const bodies = w.blocks.filter((b) => !b.dead);
  if (w.ball) bodies.push(w.ball);

  for (const b of bodies) {
    if (b.inv === 0) continue;
    b.vy += GRAVITY * STEP;
    b.x += b.vx * STEP;
    b.y += b.vy * STEP;
    b.vx *= 0.999;
    b.vy *= 0.999;
  }

  const hits = [];
  for (let pass = 0; pass < ITER; pass++) {
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (const s of w.statics) {
        const n = a.t === "circle" ? circleRect(a, s) : rectRect(a, s);
        if (n) {
          const v = resolve(a, s, n);
          if (pass === 0 && v > DMG_FLOOR) hits.push([a, s, v]);
        }
      }
      for (let k = i + 1; k < bodies.length; k++) {
        const b = bodies[k];
        let n;
        let A = a;
        let B = b;
        if (a.t === "circle" && b.t === "rect") n = circleRect(a, b);
        else if (a.t === "rect" && b.t === "circle") {
          n = circleRect(b, a);
          A = b;
          B = a;
        } else n = rectRect(a, b);
        if (n) {
          const v = resolve(A, B, n);
          if (pass === 0 && v > DMG_FLOOR) hits.push([A, B, v]);
        }
      }
    }
  }

  for (const [a, b, v] of hits) {
    const speed = v - DMG_FLOOR;
    for (const [self, other] of [
      [a, b],
      [b, a],
    ]) {
      if (self.inv === 0 || self.dead || self.hp === Infinity) continue;
      const punch =
        other.t === "circle"
          ? 2.4
          : Math.min(2.5, Math.max(0.7, other.mass / 2));
      self.hp -= speed * 0.16 * punch;
      if (self.hp <= 0) {
        self.dead = true;
        w.shake = Math.min(14, w.shake + (self.kind === "star" ? 10 : 5));
        burst(w, self);
      }
    }
  }

  // settle tiny motion so resting stacks stop shivering
  for (const b of bodies) {
    if (b.inv === 0) continue;
    if (Math.abs(b.vx) < 3) b.vx = 0;
  }

  for (const p of w.particles) {
    p.vy += 900 * STEP;
    p.x += p.vx * STEP;
    p.y += p.vy * STEP;
    p.life -= STEP;
  }
  w.particles = w.particles.filter((p) => p.life > 0);
  if (w.shake > 0) w.shake = Math.max(0, w.shake - 30 * STEP);

  if (w.ball) {
    const b = w.ball;
    const still = Math.hypot(b.vx, b.vy) < 26;
    const gone = b.x > WORLD_W + 120 || b.y > WORLD_H + 200;
    w.settleTimer = still || gone ? w.settleTimer + STEP : 0;
    if (gone || w.settleTimer > 1.1) {
      w.ball = null;
      w.settleTimer = 0;
    }
  }

  const starsLeft = w.blocks.filter((b) => b.kind === "star" && !b.dead).length;

  let status;
  if (starsLeft === 0) status = "won";
  else if (w.ball) status = "flying";
  else if (w.ballsLeft === 0) {
    w.overTimer += STEP;
    status = w.overTimer > 0.8 ? "lost" : "flying";
  } else status = "aim";

  w.status = status;
  return { starsLeft, ballsLeft: w.ballsLeft, status };
}
