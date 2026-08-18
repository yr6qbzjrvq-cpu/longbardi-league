"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LEVELS, MATERIALS, WORLD_W, WORLD_H, GROUND_Y } from "@/lib/hailMaryLevels";
import { QB_HEAD_SRC } from "@/lib/hailMaryHead";
import {
  BALL_R,
  MAX_PULL,
  POWER,
  SLING,
  STEP,
  createWorld,
  launch,
  step,
} from "@/lib/hailMaryPhysics";

// The quarterback stands just left of the release point so his head never
// covers the ball. Everything else about him is drawn off these three numbers.
const QB_X = 88;
const QB_SHOULDER = GROUND_Y - 68;
const HEAD_R = 52;

// Decoded once for the life of the page. Until it is ready the head renders as
// a plain circle, so a slow decode can never leave a hole in the sprite.
let headImg = null;
function qbHead() {
  if (headImg) return headImg;
  if (typeof window === "undefined") return null;
  headImg = new window.Image();
  headImg.src = QB_HEAD_SRC;
  return headImg;
}

export default function HailMaryGame() {
  const canvasRef = useRef(null);
  const world = useRef(null);
  const [levelIndex, setLevelIndex] = useState(0);
  const [hud, setHud] = useState({ balls: 0, stars: 0, status: "aim" });

  const reset = useCallback((index) => {
    const w = createWorld(index);
    world.current = w;
    setHud({
      balls: w.ballsLeft,
      stars: w.blocks.filter((b) => b.kind === "star").length,
      status: "aim",
    });
  }, []);

  useEffect(() => {
    reset(levelIndex);
  }, [levelIndex, reset]);

  // --- input --------------------------------------------------------------
  const toWorld = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const s = rect.width / WORLD_W;
    return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s };
  };

  const onDown = (e) => {
    const w = world.current;
    if (!w || w.ball || w.ballsLeft <= 0 || w.status === "won") return;
    // Keeps the drag alive if the finger leaves the canvas. Safari throws here
    // for pointers it doesn't recognise, and a failed capture shouldn't cost
    // you the shot.
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {}
    w.drag = toWorld(e);
  };

  const onMove = (e) => {
    const w = world.current;
    if (!w || !w.drag) return;
    e.preventDefault();
    w.drag = toWorld(e);
  };

  const onUp = () => {
    const w = world.current;
    if (!w || !w.drag) return;
    const { px, py } = pull(w.drag);
    const vx = (SLING.x - px) * POWER;
    const vy = (SLING.y - py) * POWER;
    w.drag = null;
    if (Math.hypot(vx, vy) < 120) return; // a tap, not a throw
    launch(w, px, py, vx, vy);
  };

  // --- loop ---------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    let last = performance.now();
    let acc = 0;

    // CSS owns the shape (aspect-[1000/600]); this only keeps the backing
    // store sharp. Setting style.height here instead would re-trigger the
    // ResizeObserver and Chrome would drop the follow-up notification, which
    // left the canvas squashed after a rotation or a width change.
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const frame = (now) => {
      acc += Math.min(0.1, (now - last) / 1000);
      last = now;
      let out = null;
      while (acc >= STEP) {
        if (world.current) out = step(world.current);
        acc -= STEP;
      }
      if (out) {
        setHud((h) =>
          h.balls === out.ballsLeft &&
          h.stars === out.starsLeft &&
          h.status === out.status
            ? h
            : { balls: out.ballsLeft, stars: out.starsLeft, status: out.status }
        );
      }
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      draw(ctx, canvas.clientWidth, world.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const level = LEVELS[levelIndex];
  const lastLevel = levelIndex === LEVELS.length - 1;
  const over = hud.status === "won" || hud.status === "lost";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-display text-xs uppercase tracking-widest text-gray-500">
            Level {levelIndex + 1} of {LEVELS.length}
          </p>
          <p className="font-display text-lg uppercase tracking-wide text-gray-900">
            {level.name}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <p className="font-display text-xs uppercase tracking-widest text-gray-500">
            Stars <span className="text-gray-900">{hud.stars}</span>
          </p>
          <p className="font-display text-xs uppercase tracking-widest text-gray-500">
            Footballs <span className="text-gray-900">{hud.balls}</span>
          </p>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-md border border-gray-200">
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="block w-full aspect-[1000/600]"
          style={{ touchAction: "none" }}
        />

        {over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60 px-6 text-center">
            <p className="font-display text-3xl uppercase tracking-wide text-white">
              {hud.status === "won" ? "Touchdown" : "Turnover on downs"}
            </p>
            <p className="max-w-sm text-sm text-gray-200">
              {hud.status === "won"
                ? lastLevel
                  ? "That's every star in the stadium."
                  : "Stars cleared. On to the next one."
                : "Out of footballs with stars still standing."}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => reset(levelIndex)}
                className="rounded-md border border-white/40 px-5 py-2 font-display text-sm uppercase tracking-widest text-white hover:bg-white/10"
              >
                Replay
              </button>
              {hud.status === "won" && !lastLevel && (
                <button
                  type="button"
                  onClick={() => setLevelIndex((i) => i + 1)}
                  className="rounded-md bg-espn px-5 py-2 font-display text-sm uppercase tracking-widest text-white hover:bg-espn-dark"
                >
                  Next Level
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Drag back from the quarterback and let go. Knock every star down
          before you run out of footballs — the helmets explode.
        </p>
        <div className="flex gap-2">
          {LEVELS.map((l, i) => (
            <button
              key={l.name}
              type="button"
              onClick={() => setLevelIndex(i)}
              className={`rounded border px-3 py-1 font-display text-xs uppercase tracking-widest transition-colors ${
                i === levelIndex
                  ? "border-espn text-espn"
                  : "border-gray-200 text-gray-500 hover:border-espn"
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- drawing --------------------------------------------------------------
function draw(ctx, cssW, w) {
  if (!w) return;
  const s = cssW / WORLD_W;

  ctx.save();
  ctx.scale(s, s);
  if (w.shake > 0) {
    ctx.translate(
      (Math.random() - 0.5) * w.shake,
      (Math.random() - 0.5) * w.shake
    );
  }

  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, "#0b1a2e");
  sky.addColorStop(1, "#173759");
  ctx.fillStyle = sky;
  ctx.fillRect(-40, -40, WORLD_W + 80, GROUND_Y + 40);

  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (const lx of [220, 560, 880]) {
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx - 120, GROUND_Y);
    ctx.lineTo(lx + 120, GROUND_Y);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = "#1f6b3a";
  ctx.fillRect(-40, GROUND_Y, WORLD_W + 80, WORLD_H - GROUND_Y + 40);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  for (let x = 40; x < WORLD_W; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y);
    ctx.lineTo(x, WORLD_H);
    ctx.stroke();
  }

  const hand = w.drag ? pull(w.drag) : { px: SLING.x, py: SLING.y };
  drawQB(ctx, hand);

  for (const b of w.blocks) {
    if (b.dead) continue;
    const m = MATERIALS[b.kind];
    if (b.kind === "star") {
      drawStar(ctx, b.x, b.y, 19, m.fill);
      continue;
    }
    if (b.kind === "helmet") {
      drawHelmet(ctx, b);
      continue;
    }
    const wear = Math.max(0, Math.min(1, b.hp / b.maxHp));
    ctx.fillStyle = m.fill;
    ctx.globalAlpha = 0.45 + wear * 0.55;
    ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = m.edge;
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
  }

  for (const bl of w.blasts) {
    const k = bl.t / bl.max;
    ctx.globalAlpha = Math.max(0, 1 - k);
    ctx.strokeStyle = "#ffb020";
    ctx.lineWidth = 7 * (1 - k) + 1;
    ctx.beginPath();
    ctx.arc(bl.x, bl.y, bl.r * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  if (w.drag) {
    const { px, py } = hand;
    const vx = (SLING.x - px) * POWER;
    const vy = (SLING.y - py) * POWER;
    drawBall(ctx, px, py, Math.atan2(vy, vx));
  }

  if (w.ball) {
    drawBall(ctx, w.ball.x, w.ball.y, Math.atan2(w.ball.vy, w.ball.vx));
  } else if (!w.drag && w.status === "aim" && w.ballsLeft > 0) {
    drawBall(ctx, SLING.x, SLING.y, -0.35);
  }

  for (const p of w.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function pull(drag) {
  let dx = drag.x - SLING.x;
  let dy = drag.y - SLING.y;
  const d = Math.hypot(dx, dy);
  if (d > MAX_PULL) {
    dx = (dx / d) * MAX_PULL;
    dy = (dy / d) * MAX_PULL;
  }
  return { px: SLING.x + dx, py: SLING.y + dy };
}

// The commissioner: normal-sized quarterback, absurd head. The throwing arm
// tracks wherever the ball is being pulled to, so he winds up as you drag.
function drawQB(ctx, hand) {
  const headY = QB_SHOULDER - HEAD_R + 4;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(QB_X, GROUND_Y + 3, 34, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#1b2a3d";
  ctx.lineCap = "round";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(QB_X - 4, GROUND_Y - 34);
  ctx.lineTo(QB_X - 16, GROUND_Y - 2);
  ctx.moveTo(QB_X + 4, GROUND_Y - 34);
  ctx.lineTo(QB_X + 18, GROUND_Y - 2);
  ctx.stroke();

  // jersey
  ctx.fillStyle = "#0057B8";
  ctx.fillRect(QB_X - 15, QB_SHOULDER, 30, GROUND_Y - 32 - QB_SHOULDER);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "600 14px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("1", QB_X, QB_SHOULDER + 22);

  // off arm out front for balance, throwing arm back to the ball
  ctx.strokeStyle = "#e6b79c";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(QB_X + 12, QB_SHOULDER + 6);
  ctx.lineTo(QB_X + 42, QB_SHOULDER + 2);
  ctx.moveTo(QB_X + 12, QB_SHOULDER + 4);
  ctx.lineTo(hand.px, hand.py);
  ctx.stroke();

  const img = qbHead();
  const ready = img && img.complete && img.naturalWidth > 0;
  ctx.save();
  ctx.beginPath();
  ctx.arc(QB_X, headY, HEAD_R, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (ready) {
    ctx.drawImage(img, QB_X - HEAD_R, headY - HEAD_R, HEAD_R * 2, HEAD_R * 2);
  } else {
    ctx.fillStyle = "#e6b79c";
    ctx.fillRect(QB_X - HEAD_R, headY - HEAD_R, HEAD_R * 2, HEAD_R * 2);
  }
  ctx.restore();

  ctx.strokeStyle = "#f7d154";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(QB_X, headY, HEAD_R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawHelmet(ctx, b) {
  const half = b.w / 2;
  const r = b.h / 2;
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.shadowColor = "rgba(255,90,31,0.85)";
  ctx.shadowBlur = 14;
  ctx.fillStyle = "#c8102e";
  ctx.beginPath();
  ctx.ellipse(0, -1, half * 0.88, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = "#f4f1ea";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-half * 0.6, -r + 4);
  ctx.lineTo(half * 0.35, -r + 3);
  ctx.stroke();

  ctx.strokeStyle = "#d8dde3";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(half * 0.3, -3);
  ctx.lineTo(half * 0.88, 3);
  ctx.lineTo(half * 0.72, r - 2);
  ctx.lineTo(0, r - 2);
  ctx.stroke();

  ctx.fillStyle = "#ffd166";
  ctx.beginPath();
  ctx.arc(-half * 0.45, -3, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBall(ctx, x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#8b4a24";
  ctx.beginPath();
  ctx.ellipse(0, 0, BALL_R + 4, BALL_R - 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f4f1ea";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-7, 0);
  ctx.lineTo(7, 0);
  for (let i = -5; i <= 5; i += 2.5) {
    ctx.moveTo(i, -3.5);
    ctx.lineTo(i, 3.5);
  }
  ctx.stroke();
  ctx.restore();
}

function drawStar(ctx, x, y, r, fill) {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = "rgba(255,197,61,0.9)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.46;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const px = Math.cos(a) * rad;
    const py = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
