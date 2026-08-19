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
export const WALL_TOP = GROUND_Y - 118; // just below the release point

// Slow-motion factor for the ball. Velocity scales by SLOW and gravity by
// SLOW squared, so the flight path of a given throw is unchanged — the ball
// just takes longer to get there, which means leading the receiver by more.
const SLOW = 0.72;

// Power cap. Unlike SLOW this really shortens the throw. At 0.90 a max-power
// perfect throw can just reach the back pads — deep balls are on the menu,
// but the wall still catches anything truly overcooked.
const POWER_SCALE = 0.9;

// The padded wall at the back of the end zone. A ball that reaches it is dead
// on the spot, and the receiver pulls up in front of it instead of running
// off the screen under a long lob.
export const BACK_X = WORLD_W - 8;

// The defender plays press coverage: he lines up just behind the receiver
// (on the throw side) and is always a step slower, so the window between his
// reach and the catch point starts tight and opens the further they run.
// Throw quick through the tight window, or wait until the receiver is open.
export const DEF_R = 26; // his reach — a ball inside it gets swatted
const DEF_GAP = 30; // how far behind the receiver he lines up
const DEF_SPEED_MIN = 0.72; // fraction of the receiver's speed
const DEF_SPEED_MAX = 0.82;

// Past midfield the defender finds a second gear: he accelerates until he's
// running slightly faster than the receiver, so the deep window that opened
// up starts closing again. The sweet spot is between the two.
const MID_X = (START_X + GOAL_X) / 2;
const DEF_RECOVER = 120; // how hard he accelerates, units/s^2
const DEF_RECOVER_CAP = 1.18; // tops out faster than the receiver

// Points for air yards, in 10-point steps from 10 to 50. Distance is measured
// from where the ball left the hand to where the receiver caught it.
function airPoints(dist) {
  return Math.max(10, Math.min(50, (Math.floor((dist - 100) / 150) + 1) * 10));
}

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
    defender: null,
    ball: null,
    drag: null,
    thrown: false,
    trail: [],
    particles: [],
    phase: "live",
    timer: 0,
    streak: 0,
    points: 0,
    best: 0,
    lastPoints: 0,
    throwX: 0,
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
  g.defender = {
    x: START_X - DEF_GAP,
    speed:
      g.receiver.speed *
      (DEF_SPEED_MIN + Math.random() * (DEF_SPEED_MAX - DEF_SPEED_MIN)),
    stride: 0,
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
  g.throwX = px;
  g.ball = {
    x: px,
    y: py,
    vx: vx * SLOW * POWER_SCALE,
    vy: vy * SLOW * POWER_SCALE,
  };
  g.thrown = true;
}

function complete(g) {
  g.receiver.caught = true;
  g.streak += 1;
  const pts = airPoints(g.receiver.x - g.throwX);
  g.points += pts;
  if (g.points > g.best) g.best = g.points;
  g.phase = "caught";
  g.result = "TOUCHDOWN +" + pts;
  g.resultAge = 0;
  g.timer = NEXT_DELAY;
  burst(g, g.receiver.x, CHEST_Y, "#ffc53d", 26);
  g.ball = null;
}

// One throw per receiver, so any ball that doesn't find him ends the run. The
// point total is stashed on lastPoints first — that's what the board reads.
function incomplete(g, label, x, y) {
  g.lastPoints = g.points;
  g.points = 0;
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
    points: g.points,
    best: g.best,
    lastPoints: g.lastPoints,
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
      // he pulls up in front of the back wall rather than running off screen
      r.x = Math.min(BACK_X - 30, r.x + r.speed * STEP);
      r.stride += r.speed * STEP;
      const d = g.defender;
      if (r.x > MID_X) {
        d.speed = Math.min(
          g.receiver.speed * DEF_RECOVER_CAP,
          d.speed + DEF_RECOVER * STEP
        );
      }
      d.x = Math.min(BACK_X - 70, d.x + d.speed * STEP);
      d.stride += d.speed * STEP;
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
      // the defender's reach comes first — he is between the ball and the
      // receiver, which is the whole point of him
      const swat =
        Math.hypot(b.x - g.defender.x, b.y - CHEST_Y) < DEF_R + BALL_R;
      if (hitWall) {
        incomplete(g, "BLOCKED", b.x, b.y);
        event = "miss";
      } else if (swat) {
        incomplete(g, "SWATTED", b.x, b.y);
        event = "miss";
      } else if (Math.hypot(dx, dy) < CATCH_R + BALL_R) {
        complete(g);
        event = "catch";
      } else if (b.x + BALL_R >= BACK_X) {
        incomplete(g, "OVERTHROWN", BACK_X - 6, b.y);
        event = "miss";
      } else if (b.y + BALL_R >= GROUND_Y) {
        incomplete(g, "INCOMPLETE", b.x, GROUND_Y - 6);
        event = "miss";
      } else if (b.y > GROUND_Y + 500) {
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
    g.defender.x = Math.min(GOAL_X + 10, g.defender.x + 40 * STEP);
    g.timer = Math.max(0, g.timer - STEP);
    if (g.timer === 0) spawn(g);
  }

  return snapshot(g, event);
}
