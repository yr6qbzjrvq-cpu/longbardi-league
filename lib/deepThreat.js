// Deep Threat — one receiver, one throw.
//
// The ball runs through exactly the Hail Mary integrator: same gravity, same
// fixed step, same faint air drag. A throw that felt right over there lands in
// the same place here. Everything else in this file is the receiver.

import { GROUND_Y, WORLD_W } from "./hailMaryLevels";
import { BALL_R, GRAVITY, STEP } from "./hailMaryPhysics";

export const START_X = 260; // where the receiver lines up
export const GOAL_X = 900; // goal line; past this the play is over
export const CHEST_Y = GROUND_Y - 46; // catch point, roughly his hands
export const CATCH_R = 40;
export const SNAP_DELAY = 0.55; // beat before he takes off, so you can read him
export const NEXT_DELAY = 2.5; // gap between plays

// The offensive line: a wall between the QB and the field. Anything on a rope
// smacks into it, so every completion has to be lofted over the top.
export const WALL_X = 208;
export const WALL_W = 16;
export const WALL_TOP = GROUND_Y - 235; // ~85 above the release point

// Slow-motion factor for the ball. Velocity scales by SLOW and gravity by
// SLOW squared, so the flight path of a given throw is unchanged — the ball
// just takes longer to get there, which means leading the receiver by more.
const SLOW = 0.72;

// Speeds sit in a narrow band: every receiver is quick, but you can't throw
// the same pass twice and expect it to land.
const MIN_SPEED = 104;
const MAX_SPEED = 148;

function pickName(pool, avoid) {
  const options = pool.filter((n) => n !== avoid);
  const list = options.length > 0 ? options : pool;
  return list[Math.floor(Math.random() * list.length)];
}

function burst(g, x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 90 + Math.random() * 300;
    g.particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 110,
      life: 0.4 + Math.random() * 0.5,
      max: 0.9,
      color,
    });
  }
}

export function createGame(names) {
  const g = {
    names: names && names.length > 0 ? names : ["Receiver"],
    receiver: null,
    ball: null,
    drag: null,
    thrown: false,
    trail: [],
    particles: [],
    phase: "live",
    timer: 0,
    streak: 0,
    best: 0,
    lastStreak: 0,
    result: null,
    resultAge: 0,
    paused: false,
  };
  spawn(g);
  return g;
}

export function spawn(g) {
  g.receiver = {
    x: START_X,
    name: pickName(g.names, g.receiver ? g.receiver.name : null),
    speed: MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED),
    t: 0,
    stride: 0,
    caught: false,
  };
  g.ball = null;
  g.thrown = false;
  g.trail = [];
  g.phase = "live";
  g.result = null;
  g.resultAge = 0;
  g.timer = 0;
}

export function canThrow(g) {
  return g.phase === "live" && !g.thrown && !g.paused;
}

export function launch(g, px, py, vx, vy) {
  if (!canThrow(g)) return;
  g.ball = { x: px, y: py, vx: vx * SLOW, vy: vy * SLOW };
  g.thrown = true;
}

function complete(g) {
  g.receiver.caught = true;
  g.streak += 1;
  if (g.streak > g.best) g.best = g.streak;
  g.phase = "caught";
  g.result = "TOUCHDOWN";
  g.resultAge = 0;
  g.timer = NEXT_DELAY;
  burst(g, g.receiver.x, CHEST_Y, "#ffc53d", 26);
  g.ball = null;
}

// One throw per receiver, so any ball that doesn't find him ends the run. The
// streak is stashed on lastStreak first — that's what the leaderboard reads.
function incomplete(g, label, x, y) {
  g.lastStreak = g.streak;
  g.streak = 0;
  g.phase = "incomplete";
  g.result = label;
  g.resultAge = 0;
  g.timer = NEXT_DELAY;
  if (x !== undefined) burst(g, x, y, "#8b4a24", 14);
  g.ball = null;
}

function snapshot(g, event) {
  return {
    phase: g.phase,
    streak: g.streak,
    best: g.best,
    lastStreak: g.lastStreak,
    name: g.receiver ? g.receiver.name : "",
    canThrow: canThrow(g),
    event,
  };
}

export function step(g) {
  for (const p of g.particles) {
    p.vy += 900 * STEP;
    p.x += p.vx * STEP;
    p.y += p.vy * STEP;
    p.life -= STEP;
  }
  g.particles = g.particles.filter((p) => p.life > 0);
  for (const t of g.trail) t.life -= STEP;
  g.trail = g.trail.filter((t) => t.life > 0);
  g.resultAge += STEP;

  // Frozen while the name prompt is up, so nothing advances behind it.
  if (g.paused) return snapshot(g, null);

  let event = null;
  const r = g.receiver;

  if (g.phase === "live") {
    r.t += STEP;
    if (r.t > SNAP_DELAY) {
      r.x += r.speed * STEP;
      r.stride += r.speed * STEP;
    }

    if (g.ball) {
      const b = g.ball;
      b.vy += GRAVITY * SLOW * SLOW * STEP;
      b.x += b.vx * STEP;
      b.y += b.vy * STEP;
      b.vx *= 0.9997;
      b.vy *= 0.9997;
      g.trail.push({ x: b.x, y: b.y, life: 0.3, max: 0.3 });

      const dx = b.x - r.x;
      const dy = b.y - CHEST_Y;
      const hitWall =
        b.x + BALL_R > WALL_X - WALL_W / 2 &&
        b.x - BALL_R < WALL_X + WALL_W / 2 &&
        b.y + BALL_R > WALL_TOP;
      if (hitWall) {
        incomplete(g, "BLOCKED", b.x, b.y);
        event = "miss";
      } else if (Math.hypot(dx, dy) < CATCH_R + BALL_R) {
        complete(g);
        event = "catch";
      } else if (b.y + BALL_R >= GROUND_Y) {
        incomplete(g, "INCOMPLETE", b.x, GROUND_Y - 6);
        event = "miss";
      } else if (b.x > WORLD_W + 220 || b.y > GROUND_Y + 500) {
        incomplete(g, "OVERTHROWN", b.x, b.y);
        event = "miss";
      }
    }

    // Crossing the goal line only ends it if nothing is in the air — a ball
    // already on its way can still come down on him in the end zone.
    if (g.phase === "live" && !g.ball && r.x >= GOAL_X) {
      incomplete(g, g.thrown ? "INCOMPLETE" : "NO THROW");
      event = "miss";
    }
  } else {
    // He keeps jogging into the end zone while the result is on screen.
    r.x = Math.min(GOAL_X + 60, r.x + (g.phase === "caught" ? 70 : 40) * STEP);
    g.timer = Math.max(0, g.timer - STEP);
    if (g.timer === 0) spawn(g);
  }

  return snapshot(g, event);
}
