"use client";

// ============================================================
// HSPNeighborhood — room engine (multiplayer, milestone 4)
// ------------------------------------------------------------
// Renders one room config from lib/neighborhood/rooms.js on a
// <canvas>:
//   • cached offscreen background layer (repainted only when
//     theme or resolution changes → stable phone framerate)
//   • click/tap-to-walk using lib/neighborhood/pathing (A* +
//     line-of-sight smoothing), constant-speed movement
//   • realtime peers via lib/neighborhood/realtime: your own
//     avatar walks INSTANTLY on the locally computed path
//     while the destination goes to /api/neighborhood/move,
//     which validates with the same pathing module and
//     broadcasts; peers are rendered DETERMINISTICALLY from
//     (x, y, path, startedAt) + the server clock, so a hidden
//     tab or a late joiner lands on the exact same positions
//   • Y-depth sorting of props + every player each frame
//   • camera follow with room clamping, DPR-aware sizing,
//     dark/light palettes, door "opening soon" nudges
// ============================================================

import { useEffect, useRef, useState } from "react";
import { drawAvatar, normalizeAvatar } from "@/lib/neighborhoodAvatar";
import { getRoom } from "@/lib/neighborhood/rooms";
import { findPath, getNavGrid, nearestWalkable } from "@/lib/neighborhood/pathing";
import { WALK_SPEED, advanceAlongPath } from "@/lib/neighborhood/movement";
import { joinRoom } from "@/lib/neighborhood/realtime";

const AVATAR_SCALE = 0.92; // world size of players in rooms
const MIN_ZOOM = 0.55; // keep avatars readable on small phones
const MAX_ZOOM = 1;
const SIZE_FACTOR = { short: 0.86, medium: 1, tall: 1.14 }; // mirrors drawAvatar
const MOVE_SEND_GAP_MS = 340; // client-side pacing under the ~3/s server limit

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

function tagYFor(avatar, y) {
  const size = (avatar && avatar.body && avatar.body.size) || "medium";
  return y - (150 * (SIZE_FACTOR[size] || 1) + 16) * AVATAR_SCALE - 8;
}

function drawNameTag(ctx, name, x, y, self) {
  ctx.font = "600 13px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(name).width + 18;
  roundRectPath(ctx, x - w / 2, y - 11, w, 22, 11);
  ctx.fillStyle = self ? "rgba(0,87,184,0.78)" : "rgba(16,24,32,0.72)";
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
  // Props, every peer and ourselves all sort in ONE list.
  const ents = [];
  for (const p of room.props) ents.push({ y: p.sortY ?? p.y, prop: p });
  for (const peer of s.peers.values()) ents.push({ y: peer.curY, peer });
  ents.push({ y: s.pos.y, player: true });
  ents.sort((a, b) => a.y - b.y);
  for (const e of ents) {
    if (e.player) {
      drawAvatar(ctx, s.avatar, s.pos.x, s.pos.y, AVATAR_SCALE, {
        walking: s.walking,
        frame: s.walkT,
      });
      drawNameTag(ctx, s.name, s.pos.x, tagYFor(s.avatar, s.pos.y), true);
    } else if (e.peer) {
      const pr = e.peer;
      drawAvatar(ctx, pr.avatar, pr.curX, pr.curY, AVATAR_SCALE, {
        walking: pr.walking,
        frame: pr.walkT,
      });
      drawNameTag(ctx, pr.username, pr.curX, tagYFor(pr.avatar, pr.curY), false);
    } else {
      e.prop.draw(ctx, e.prop, P, theme, t);
    }
  }
}

export default function NeighborhoodRoom({ player, preview, onEditCharacter, onJoinFailed }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const themeRef = useRef("light");
  const [toast, setToast] = useState(null);
  const [hint, setHint] = useState(true);
  const [count, setCount] = useState(1);
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
      // multiplayer
      peers: new Map(), // playerId → {username, avatar, x, y, path, startedAt, curX, curY, walking, walkT}
      conn: null,
      clockOffset: 0,
      moveTarget: null,
      moveTimer: null,
      lastMoveAt: 0,
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

  // ---- multiplayer connection --------------------------------
  useEffect(() => {
    const s = sRef.current;
    let cancelled = false;
    let conn = null;

    const refreshCount = () => setCount(s.peers.size + 1);

    // roster/move wire format → peer record (idempotent upsert)
    const applyWire = (p) => {
      const prev = s.peers.get(p.id);
      s.peers.set(p.id, {
        id: p.id,
        username: p.username || (prev && prev.username) || "???",
        avatar: normalizeAvatar(p.avatar || (prev && prev.avatar)),
        x: Number.isFinite(p.x) ? p.x : s.room.spawn.x,
        y: Number.isFinite(p.y) ? p.y : s.room.spawn.y,
        path: Array.isArray(p.path) ? p.path : [],
        startedAt: Number.isFinite(p.startedAt) ? p.startedAt : null,
        curX: Number.isFinite(p.x) ? p.x : s.room.spawn.x,
        curY: Number.isFinite(p.y) ? p.y : s.room.spawn.y,
        walking: false,
        walkT: 0,
      });
    };

    (async () => {
      try {
        conn = await joinRoom({
          roomId: s.room.id,
          player,
          // Authoritative roster (initial join, reconnect resync,
          // heartbeat re-join): reconcile the whole peer set.
          onRoster: (players, serverNow) => {
            if (cancelled) return;
            s.clockOffset = serverNow - Date.now();
            const seen = new Set();
            for (const p of players) {
              if (p.id === player.playerId) continue;
              seen.add(p.id);
              applyWire(p);
            }
            for (const id of [...s.peers.keys()]) {
              if (!seen.has(id)) s.peers.delete(id);
            }
            refreshCount();
          },
          // Presence join: render newcomers immediately at their
          // announced spot; the first "move" takes over from there.
          onPeerJoin: (id, meta) => {
            if (cancelled) return;
            const existing = s.peers.get(id);
            if (existing) {
              if (meta.username) existing.username = meta.username;
              if (meta.avatar) existing.avatar = normalizeAvatar(meta.avatar);
            } else {
              applyWire({ id, username: meta.username, avatar: meta.avatar, x: meta.x, y: meta.y, path: [], startedAt: null });
            }
            refreshCount();
          },
          onPeerMove: (p) => {
            if (cancelled) return;
            applyWire(p);
            refreshCount();
          },
          onPeerLeave: (id) => {
            if (cancelled) return;
            s.peers.delete(id);
            refreshCount();
          },
        });
        if (cancelled) {
          conn.leave();
          return;
        }
        s.conn = conn;
        s.clockOffset = conn.clockOffset;
        for (const p of conn.players) applyWire(p);
        refreshCount();

        // Reconcile our own position with the server's:
        // rejoin (Edit Character remount, refresh) keeps the old
        // spot server-side while we reset to spawn locally.
        const self = conn.self;
        const atSpawn =
          s.path.length === 0 &&
          Math.hypot(s.pos.x - s.room.spawn.x, s.pos.y - s.room.spawn.y) < 2;
        if (self) {
          const serverMoved =
            Math.hypot(self.x - s.room.spawn.x, self.y - s.room.spawn.y) > 2;
          if (atSpawn && serverMoved) {
            s.pos = { x: self.x, y: self.y };
            conn.updateSelf(self.x, self.y);
          } else if (!atSpawn) {
            // We walked while the join was in flight — tell the
            // server where we're headed so peers catch up.
            const dest = s.path.length ? s.path[s.path.length - 1] : s.pos;
            queueMoveSend(dest.x, dest.y);
          }
        }
      } catch (err) {
        if (cancelled) return;
        const code = err && err.code;
        if (code === "room_full" || code === "name_taken" || code === "bad_name") {
          if (onJoinFailed) onJoinFailed(code, err.message);
        } else {
          setToast({
            text: "Multiplayer is offline — walking solo for now.",
            id: performance.now(),
          });
        }
      }
    })();

    const onPageHide = () => {
      if (conn) conn.leave();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", onPageHide);
      if (s.moveTimer) {
        clearTimeout(s.moveTimer);
        s.moveTimer = null;
      }
      if (conn) conn.leave();
      s.conn = null;
      s.peers.clear();
    };
    // The component remounts (key on updatedAt) when identity
    // changes, so this runs once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coalesce rapid taps into ≤ ~3 sends/sec (matches the server
  // rate limit) and retry the freshest destination on 429.
  function queueMoveSend(x, y) {
    const s = sRef.current;
    s.moveTarget = { x, y };
    if (s.moveTimer) return; // a send is already scheduled — it'll pick up the newest target
    const fire = async () => {
      s.moveTimer = null;
      const t = s.moveTarget;
      s.moveTarget = null;
      if (!t || !s.conn) return;
      try {
        await s.conn.move(t.x, t.y);
        s.lastMoveAt = Date.now();
        s.conn.updateSelf(t.x, t.y);
      } catch (err) {
        if (err && err.status === 429 && !s.moveTarget) s.moveTarget = t;
      }
      if (s.moveTarget) s.moveTimer = setTimeout(fire, MOVE_SEND_GAP_MS);
    };
    const wait = Math.max(0, MOVE_SEND_GAP_MS - (Date.now() - s.lastMoveAt));
    s.moveTimer = setTimeout(fire, wait);
  }

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

  // Main loop: advance the walks, follow with the camera, draw.
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

      // own avatar: incremental constant-speed movement (instant
      // response to taps; identical math to advanceAlongPath)
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

      // peers: DETERMINISTIC position from the validated path +
      // server start time — survives hidden tabs, matches every
      // other client and the server's own idea exactly.
      const serverNow = Date.now() + s.clockOffset;
      for (const peer of s.peers.values()) {
        if (peer.startedAt && peer.path.length) {
          const adv = advanceAlongPath(
            peer.x,
            peer.y,
            peer.path,
            (serverNow - peer.startedAt) / 1000
          );
          peer.curX = adv.x;
          peer.curY = adv.y;
          peer.walking = !adv.done;
          peer.walkT = (serverNow - peer.startedAt) / 1000;
          if (adv.done) {
            peer.x = adv.x;
            peer.y = adv.y;
            peer.path = [];
            peer.startedAt = null;
          }
        } else {
          peer.curX = peer.x;
          peer.curY = peer.y;
          peer.walking = false;
        }
      }

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
    // own walk starts NOW; the server validates the same
    // destination and re-broadcasts for everyone else.
    if (s.conn) queueMoveSend(spot.x, spot.y);
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
          <span className="rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
            {count} here
          </span>
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
        Tap a building to visit — interiors open soon. League friends in the
        square walk around live; chat is on the way.
      </p>
    </div>
  );
}
