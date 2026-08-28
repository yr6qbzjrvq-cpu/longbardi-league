"use client";

// ============================================================
// HSPNeighborhood — room engine (single player, milestone 3)
// ------------------------------------------------------------
// Renders one room config from lib/neighborhood/rooms.js on a
// <canvas>:
//   • cached offscreen background layer (repainted only when
//     theme or resolution changes → stable phone framerate)
//   • click/tap-to-walk using lib/neighborhood/pathing (A* +
//     line-of-sight smoothing), constant-speed movement
//   • Y-depth sorting of props + player every frame
//   • camera follow with room clamping, centered when the room
//     fits the viewport
//   • DPR-aware responsive sizing, dark/light palettes, door
//     "opening soon" nudges
// Milestone 4 drops other players into the same entity list —
// the loop is already shaped for it.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { drawAvatar, normalizeAvatar } from "@/lib/neighborhoodAvatar";
import { getRoom } from "@/lib/neighborhood/rooms";
import { findPath, getNavGrid, nearestWalkable } from "@/lib/neighborhood/pathing";

const WALK_SPEED = 200; // world px/sec — constant, no easing
const AVATAR_SCALE = 0.92; // world size of players in rooms
const MIN_ZOOM = 0.55; // keep avatars readable on small phones
const MAX_ZOOM = 1;
const SIZE_FACTOR = { short: 0.86, medium: 1, tall: 1.14 }; // mirrors drawAvatar

// Camera offset for one axis: follow the player, clamp to the
// room, center (negative offset) when the room fits the view.
function camAxis(center, view, world) {
  if (view >= world) return (world - view) / 2;
  return Math.min(Math.max(center - view / 2, 0), world - view);
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// Repaint the background layer only when needed.
function ensureBg(s, theme) {
  const bs = Math.min(s.zoom * s.dpr, 2);
  const key = `${theme}|${bs.toFixed(3)}`;
  if (s.bgKey === key && s.bg) return;
  const c = document.createElement("canvas");
  c.width = Math.ceil(s.room.width * bs);
  c.height = Math.ceil(s.room.height * bs);
  const bctx = c.getContext("2d");
  bctx.setTransform(bs, 0, 0, bs, 0, 0);
  s.room.drawBackground(bctx, s.room, theme);
  s.bg = c;
  s.bgKey = key;
}

function drawNameTag(ctx, name, x, y) {
  ctx.font = "600 13px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(name).width + 18;
  roundRectPath(ctx, x - w / 2, y - 11, w, 22, 11);
  ctx.fillStyle = "rgba(16,24,32,0.72)";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name, x, y + 0.5);
}

function drawScene(ctx, canvas, s, theme, t) {
  const { room } = s;
  const P = room.palette[theme];
  const scale = s.zoom * s.dpr;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = P.outside;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, -s.cam.x * scale, -s.cam.y * scale);

  ensureBg(s, theme);
  ctx.drawImage(s.bg, 0, 0, s.bg.width, s.bg.height, 0, 0, room.width, room.height);

  // tap-destination ripple
  if (s.marker) {
    const age = (performance.now() - s.marker.t) / 1000;
    if (age < 0.8) {
      const pr = age / 0.8;
      ctx.beginPath();
      ctx.ellipse(
        s.marker.x,
        s.marker.y,
        10 + pr * 22,
        (10 + pr * 22) * 0.45,
        0,
        0,
        Math.PI * 2
      );
      ctx.strokeStyle = P.marker;
      ctx.lineWidth = 3.5 * (1 - pr) + 0.5;
      ctx.stroke();
    } else {
      s.marker = null;
    }
  }

  // Y-depth sort: lower feet = closer to camera = drawn later.
  // Milestone 4 pushes the other players into this same list.
  const ents = [];
  for (const p of room.props) ents.push({ y: p.sortY ?? p.y, prop: p });
  ents.push({ y: s.pos.y, player: true });
  ents.sort((a, b) => a.y - b.y);
  for (const e of ents) {
    if (e.player) {
      drawAvatar(ctx, s.avatar, s.pos.x, s.pos.y, AVATAR_SCALE, {
        walking: s.walking,
        frame: s.walkT,
      });
      const tagY =
        s.pos.y - (150 * SIZE_FACTOR[s.avatar.body.size] + 16) * AVATAR_SCALE - 8;
      drawNameTag(ctx, s.name, s.pos.x, tagY);
    } else {
      e.prop.draw(ctx, e.prop, P, theme, t);
    }
  }
}

export default function NeighborhoodRoom({ player, preview, onEditCharacter }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const themeRef = useRef("light");
  const [toast, setToast] = useState(null);
  const [hint, setHint] = useState(true);
  const sRef = useRef(null);

  // Mutable game state lives outside React so the rAF loop
  // never re-renders the tree.
  if (!sRef.current) {
    const room = getRoom("town-square");
    sRef.current = {
      room,
      grid: getNavGrid(room),
      avatar: normalizeAvatar(player?.avatar),
      name: player?.username || "You",
      pos: { ...room.spawn },
      path: [],
      walking: false,
      walkT: 0,
      cam: null,
      marker: null,
      pendingExit: null,
      zoom: 1,
      dpr: 1,
      viewW: 1,
      viewH: 1,
      bg: null,
      bgKey: "",
    };
  }

  // Track the site theme (.dark on <html>) so the square flips
  // to its dusk palette live.
  useEffect(() => {
    const el = document.documentElement;
    const read = () => {
      themeRef.current = el.classList.contains("dark") ? "dark" : "light";
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Responsive canvas: CSS size from layout, backing store at
  // devicePixelRatio, zoom fits the room width within limits.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const s = sRef.current;
    const apply = () => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      s.viewW = rect.width;
      s.viewH = rect.height;
      s.dpr = Math.min(window.devicePixelRatio || 1, 3);
      s.zoom = Math.min(Math.max(rect.width / s.room.width, MIN_ZOOM), MAX_ZOOM);
      canvas.width = Math.max(1, Math.round(rect.width * s.dpr));
      canvas.height = Math.max(1, Math.round(rect.height * s.dpr));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Main loop: advance the walk, follow with the camera, draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const s = sRef.current;
    let raf = 0;
    let last = performance.now();

    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // constant-speed movement along the waypoint list
      let remaining = WALK_SPEED * dt;
      while (remaining > 0 && s.path.length) {
        const next = s.path[0];
        const dx = next.x - s.pos.x;
        const dy = next.y - s.pos.y;
        const d = Math.hypot(dx, dy);
        if (d <= remaining) {
          s.pos.x = next.x;
          s.pos.y = next.y;
          s.path.shift();
          remaining -= d;
        } else {
          s.pos.x += (dx / d) * remaining;
          s.pos.y += (dy / d) * remaining;
          remaining = 0;
        }
      }
      const moving = s.path.length > 0;
      if (moving) s.walkT += dt;
      if (!moving && s.walking && s.pendingExit) {
        // arrived at a door — interiors open in milestone 6
        setToast({ text: `${s.pendingExit.label} — opening soon!`, id: now });
        s.pendingExit = null;
      }
      s.walking = moving;

      // camera: exponential ease toward the clamped follow spot
      const viewW = s.viewW / s.zoom;
      const viewH = s.viewH / s.zoom;
      const dx2 = camAxis(s.pos.x, viewW, s.room.width);
      const dy2 = camAxis(s.pos.y, viewH, s.room.height);
      if (!s.cam) {
        s.cam = { x: dx2, y: dy2 };
      } else {
        const k = 1 - Math.exp(-6 * dt);
        s.cam.x += (dx2 - s.cam.x) * k;
        s.cam.y += (dy2 - s.cam.y) * k;
      }

      drawScene(ctx, canvas, s, themeRef.current, now / 1000);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // auto-hide the door nudge
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  function handlePointerDown(e) {
    const canvas = canvasRef.current;
    const s = sRef.current;
    if (!canvas || !s.cam) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left) / s.zoom + s.cam.x;
    const wy = (e.clientY - rect.top) / s.zoom + s.cam.y;

    // Door tap? Walk over, then nudge on arrival.
    const exit = s.room.exits.find(
      (x) =>
        wx >= x.hotspot.x &&
        wx <= x.hotspot.x + x.hotspot.w &&
        wy >= x.hotspot.y &&
        wy <= x.hotspot.y + x.hotspot.h
    );
    const want = exit ? exit.approach : { x: wx, y: wy };
    const spot = nearestWalkable(s.room, s.grid, want.x, want.y);
    if (!spot) return;
    // ignore taps way off the floor (sky, roofs) unless a door
    if (!exit && Math.hypot(spot.x - want.x, spot.y - want.y) > 240) return;

    const path = findPath(s.room, s.grid, s.pos.x, s.pos.y, spot.x, spot.y);
    setHint(false);
    s.pendingExit = exit || null;
    if (path.length === 0) {
      // already standing there
      if (exit) {
        setToast({ text: `${exit.label} — opening soon!`, id: performance.now() });
        s.pendingExit = null;
      }
      return;
    }
    s.path = path;
    s.marker = { x: spot.x, y: spot.y, t: performance.now() };
  }

  return (
    <div
      className="mx-auto max-w-5xl px-3 pt-3 sm:px-6"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100 sm:text-2xl">
            Town Square
          </h1>
          {preview && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              Preview
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onEditCharacter}
          className="min-h-[40px] rounded-md border border-espn px-3 font-display text-xs uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white"
        >
          Edit Character
        </button>
      </div>

      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700"
        style={{ height: "clamp(420px, calc(100dvh - 210px), 860px)" }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onContextMenu={(e) => e.preventDefault()}
          className="h-full w-full cursor-pointer touch-none select-none"
          style={{ WebkitTouchCallout: "none" }}
          aria-label="Town Square — tap the ground to walk"
        />
        {(toast || hint) && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4"
          >
            <p className="rounded-full bg-black/70 px-4 py-2 text-center text-sm font-medium text-white">
              {toast ? toast.text : "Tap the ground to walk around"}
            </p>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        Tap a building to visit — interiors open soon. League friends appear
        here once multiplayer arrives.
      </p>
    </div>
  );
}
