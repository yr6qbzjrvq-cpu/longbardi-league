"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GROUND_Y, WORLD_H, WORLD_W } from "@/lib/hailMaryLevels";
import { POWER, SLING, STEP } from "@/lib/hailMaryPhysics";
import { drawBall, drawQB, pull } from "@/lib/qbSprite";
import {
  CATCH_R,
  CHEST_Y,
  GOAL_X,
  canThrow,
  createGame,
  launch,
  step,
} from "@/lib/deepThreat";

const BOARD_URL = "/api/deep-threat/leaderboard";

export default function DeepThreatGame({ names }) {
  const canvasRef = useRef(null);
  const game = useRef(null);
  const [hud, setHud] = useState({
    streak: 0,
    best: 0,
    name: "",
    phase: "live",
    canThrow: true,
  });
  const [scores, setScores] = useState([]);
  const [boardError, setBoardError] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [entry, setEntry] = useState("");
  const [saving, setSaving] = useState(false);

  // The board doubles as the qualifying bar, so it's kept in a ref for the
  // animation loop to read without re-subscribing every render.
  const board = useRef([]);
  useEffect(() => {
    board.current = scores;
  }, [scores]);

  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch(BOARD_URL, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load the board.");
      setScores(data.scores || []);
      setBoardError(null);
    } catch (err) {
      setBoardError(err.message);
    }
  }, []);

  // Keyed on the joined names so a re-render with an equivalent array doesn't
  // throw away the game in progress.
  const roster = names.join(",");
  useEffect(() => {
    game.current = createGame(roster.split(","));
    loadBoard();
  }, [roster, loadBoard]);

  const qualifies = (streak) => {
    if (streak < 1) return false;
    const list = board.current;
    if (list.length < 10) return true;
    return streak > list[list.length - 1].streak;
  };

  // --- input --------------------------------------------------------------
  const toWorld = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const s = rect.width / WORLD_W;
    return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s };
  };

  const onDown = (e) => {
    const g = game.current;
    if (!g || !canThrow(g)) return;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {}
    g.drag = toWorld(e);
  };

  const onMove = (e) => {
    const g = game.current;
    if (!g || !g.drag) return;
    e.preventDefault();
    g.drag = toWorld(e);
  };

  const onUp = () => {
    const g = game.current;
    if (!g || !g.drag) return;
    const { px, py } = pull(g.drag);
    const vx = (SLING.x - px) * POWER;
    const vy = (SLING.y - py) * POWER;
    g.drag = null;
    if (Math.hypot(vx, vy) < 120) return; // a tap, not a throw
    launch(g, px, py, vx, vy);
  };

  // --- loop ---------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    let last = performance.now();
    let acc = 0;

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
        if (game.current) {
          const s = step(game.current);
          out = s;
          if (s.event === "miss" && qualifies(s.lastStreak)) {
            game.current.paused = true;
            setPrompt({ streak: s.lastStreak });
            setEntry("");
          }
        }
        acc -= STEP;
      }
      if (out) {
        setHud((h) =>
          h.streak === out.streak &&
          h.best === out.best &&
          h.name === out.name &&
          h.phase === out.phase &&
          h.canThrow === out.canThrow
            ? h
            : {
                streak: out.streak,
                best: out.best,
                name: out.name,
                phase: out.phase,
                canThrow: out.canThrow,
              }
        );
      }
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      draw(ctx, canvas.clientWidth, game.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!prompt || saving) return;
    setSaving(true);
    try {
      const res = await fetch(BOARD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: entry, streak: prompt.streak }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save that.");
      setScores(data.scores || []);
      setBoardError(null);
      dismiss();
    } catch (err) {
      setBoardError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const dismiss = () => {
    setPrompt(null);
    if (game.current) game.current.paused = false;
  };

  const status =
    hud.phase === "live"
      ? hud.canThrow
        ? "Drag back and let it go"
        : "Ball's in the air"
      : "Next receiver lining up";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-display text-xs uppercase tracking-widest text-gray-500">
            Receiver
          </p>
          <p className="font-display text-lg uppercase tracking-wide text-gray-900">
            {hud.name || "—"}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <p className="font-display text-xs uppercase tracking-widest text-gray-500">
            Streak <span className="text-espn">{hud.streak}</span>
          </p>
          <p className="font-display text-xs uppercase tracking-widest text-gray-500">
            Best <span className="text-gray-900">{hud.best}</span>
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

        {prompt && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 px-6 text-center">
            <div>
              <p className="font-display text-3xl uppercase tracking-wide text-white">
                Top 10
              </p>
              <p className="mt-1 text-sm text-gray-200">
                {prompt.streak} in a row. Put a name on it.
              </p>
            </div>
            <form onSubmit={submit} className="flex flex-wrap justify-center gap-2">
              <input
                type="text"
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
                maxLength={18}
                autoFocus
                placeholder="Your name"
                className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
              <button
                type="submit"
                disabled={saving || entry.trim().length === 0}
                className="rounded-md bg-espn px-5 py-2 font-display text-sm uppercase tracking-widest text-white transition-colors hover:bg-espn-dark disabled:opacity-50"
              >
                {saving ? "Saving" : "Save"}
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="rounded-md border border-white/40 px-5 py-2 font-display text-sm uppercase tracking-widest text-white hover:bg-white/10"
              >
                Skip
              </button>
            </form>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          One throw per receiver. Lead him — the ball has to come down on him
          before he crosses the goal line. {status}.
        </p>
      </div>

      <div className="mt-6">
        <h2 className="border-b-2 border-espn pb-2 font-display text-lg uppercase tracking-wide text-gray-900">
          Top 10 Streaks
        </h2>
        {boardError && (
          <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {boardError}
          </p>
        )}
        {scores.length === 0 && !boardError && (
          <p className="mt-3 text-sm text-gray-500">
            Nobody on the board yet. First completion streak takes the top spot.
          </p>
        )}
        {scores.length > 0 && (
          <ol className="mt-3 divide-y divide-gray-100">
            {scores.map((s, i) => (
              <li
                key={s.created_at + s.name}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span className="flex items-center gap-3">
                  <span className="w-6 font-display text-xs text-gray-400">
                    {i + 1}
                  </span>
                  <span className="text-gray-900">{s.name}</span>
                </span>
                <span className="font-display text-base text-espn">
                  {s.streak}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// --- drawing --------------------------------------------------------------
function draw(ctx, cssW, g) {
  if (!g) return;
  const s = cssW / WORLD_W;

  ctx.save();
  ctx.scale(s, s);

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
  for (let x = 40; x < GOAL_X; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y);
    ctx.lineTo(x, WORLD_H);
    ctx.stroke();
  }

  // end zone
  ctx.fillStyle = "#0057B8";
  ctx.fillRect(GOAL_X, GROUND_Y, WORLD_W - GOAL_X + 40, WORLD_H - GROUND_Y + 40);
  ctx.strokeStyle = "#f4f1ea";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(GOAL_X, GROUND_Y);
  ctx.lineTo(GOAL_X, WORLD_H);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(GOAL_X, GROUND_Y - 4);
  ctx.lineTo(GOAL_X, GROUND_Y - 150);
  ctx.moveTo(GOAL_X - 26, GROUND_Y - 150);
  ctx.lineTo(GOAL_X + 26, GROUND_Y - 150);
  ctx.moveTo(GOAL_X - 26, GROUND_Y - 150);
  ctx.lineTo(GOAL_X - 26, GROUND_Y - 196);
  ctx.moveTo(GOAL_X + 26, GROUND_Y - 150);
  ctx.lineTo(GOAL_X + 26, GROUND_Y - 196);
  ctx.stroke();

  const hand = g.drag ? pull(g.drag) : { px: SLING.x, py: SLING.y };
  drawQB(ctx, hand);

  if (g.receiver) drawReceiver(ctx, g.receiver, g.phase);

  for (const t of g.trail) {
    ctx.globalAlpha = Math.max(0, t.life / t.max) * 0.55;
    ctx.fillStyle = "#f4f1ea";
    ctx.beginPath();
    ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (g.ball) {
    drawBall(ctx, g.ball.x, g.ball.y, Math.atan2(g.ball.vy, g.ball.vx));
  } else if (g.drag) {
    const vx = (SLING.x - hand.px) * POWER;
    const vy = (SLING.y - hand.py) * POWER;
    drawBall(ctx, hand.px, hand.py, Math.atan2(vy, vx));
  } else if (canThrow(g)) {
    drawBall(ctx, SLING.x, SLING.y, -0.35);
  }

  for (const p of g.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
  }
  ctx.globalAlpha = 1;

  if (g.result && g.resultAge < 1.6) {
    ctx.globalAlpha = Math.max(0, 1 - g.resultAge / 1.6);
    ctx.fillStyle = g.phase === "caught" ? "#ffc53d" : "#f4f1ea";
    ctx.font = "700 62px Oswald, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(g.result, WORLD_W / 2, 190);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawReceiver(ctx, r, phase) {
  const swing = Math.sin(r.stride / 15) * 12;
  const lift = r.caught ? Math.abs(Math.sin(r.stride / 9)) * 5 : 0;
  const top = GROUND_Y - lift;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(r.x, GROUND_Y + 3, 20, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // legs
  ctx.strokeStyle = "#1b2a3d";
  ctx.lineCap = "round";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(r.x, top - 26);
  ctx.lineTo(r.x + swing, top - 2);
  ctx.moveTo(r.x, top - 26);
  ctx.lineTo(r.x - swing, top - 2);
  ctx.stroke();

  // jersey
  ctx.fillStyle = "#c8102e";
  ctx.fillRect(r.x - 11, top - 58, 22, 32);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "600 12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("88", r.x, top - 36);

  // arms, up if the ball is his
  ctx.strokeStyle = "#e6b79c";
  ctx.lineWidth = 6;
  ctx.beginPath();
  if (r.caught) {
    ctx.moveTo(r.x - 8, top - 54);
    ctx.lineTo(r.x - 18, top - 78);
    ctx.moveTo(r.x + 8, top - 54);
    ctx.lineTo(r.x + 18, top - 78);
  } else {
    ctx.moveTo(r.x - 8, top - 52);
    ctx.lineTo(r.x - 8 - swing * 0.8, top - 34);
    ctx.moveTo(r.x + 8, top - 52);
    ctx.lineTo(r.x + 8 + swing * 0.8, top - 34);
  }
  ctx.stroke();

  // helmet
  ctx.fillStyle = "#c8102e";
  ctx.beginPath();
  ctx.arc(r.x, top - 68, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#d8dde3";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(r.x + 6, top - 66);
  ctx.lineTo(r.x + 12, top - 62);
  ctx.stroke();

  if (r.caught) {
    drawBall(ctx, r.x, top - 46, -0.4);
  }

  // catch window, so you can see what you're aiming at
  if (phase === "live") {
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(r.x, CHEST_Y, CATCH_R, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "600 15px Oswald, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(r.name.toUpperCase(), r.x, top - 92);
  ctx.restore();
}
