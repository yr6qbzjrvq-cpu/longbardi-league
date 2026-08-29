"use client";

// ============================================================
// HSPNeighborhood — room engine (multiplayer + doors, m4-m6)
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
//     dark/light palettes
//   • doors (milestone 6): arriving on an exit hotspot joins
//     the target room via the same join API (capacity checked
//     there — full rooms bounce you back with a toast), swaps
//     world + Realtime channel + peers under a short fade,
//     and replays the new room's chat history in the log
// ============================================================

import { useEffect, useRef, useState } from "react";
import { drawAvatar, normalizeAvatar } from "@/lib/neighborhoodAvatar";
import { getRoom } from "@/lib/neighborhood/rooms";
import { findPath, getNavGrid, nearestWalkable } from "@/lib/neighborhood/pathing";
import { WALK_SPEED, advanceAlongPath } from "@/lib/neighborhood/movement";
import { joinRoom, fetchChatHistory } from "@/lib/neighborhood/realtime";
import { CHAT_MAX, validateChatText, bubbleDurationMs } from "@/lib/neighborhood/chat";

const AVATAR_SCALE = 0.92; // world size of players in rooms
const MIN_ZOOM = 0.55; // keep avatars readable on small phones
const MAX_ZOOM = 1;
const SIZE_FACTOR = { short: 0.86, medium: 1, tall: 1.14 }; // mirrors drawAvatar
const MOVE_SEND_GAP_MS = 340; // client-side pacing under the ~3/s server limit
const LOG_LIMIT = 120; // chat log entries kept in memory
const FADE_SPEED = 4; // door-transition fade, full swings per second

// Speech bubbles are drawn in SCREEN pixels (not world units)
// so chat stays readable at every phone zoom level.
const BUBBLE_FONT = "600 13.5px Inter, system-ui, sans-serif";
const BUBBLE_MAX_W = 210;
const BUBBLE_LINE_H = 17;
const BUBBLE_PAD_X = 11;
const BUBBLE_PAD_Y = 8;
const BUBBLE_MAX_PER_PLAYER = 3; // rapid-fire stacks, oldest drops

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

// Greedy word wrap for bubble text; marathon "words" get
// hard-broken so a bubble can never blow past its max width.
function wrapChatLines(ctx, text, maxW) {
  const lines = [];
  let line = "";
  for (let word of String(text).split(" ")) {
    while (ctx.measureText(word).width > maxW) {
      let cut = word.length;
      while (cut > 1 && ctx.measureText(word.slice(0, cut)).width > maxW) cut--;
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    if (!word) continue;
    const attempt = line ? `${line} ${word}` : word;
    if (ctx.measureText(attempt).width <= maxW) line = attempt;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Chat bubbles — thick rounded outlines to match the art
// direction, newest message nearest the speaker's head with
// older ones stacked above, tail only on the newest. Drawn in
// screen space after the world pass; speakers are sorted by
// depth so whoever is nearer the camera keeps their bubble on
// top when neighbors overlap, and every bubble is clamped to
// the viewport so it stays readable at the room edges.
function drawSpeechBubbles(ctx, s) {
  if (!s.cam || !s.bubbles.size) return;
  const now = Date.now();
  const speakers = [];
  const collect = (id, avatar, x, y) => {
    const list = s.bubbles.get(id);
    if (list && list.length) {
      speakers.push({ x, headY: tagYFor(avatar, y), depth: y, list });
    }
  };
  collect(s.selfId, s.avatar, s.pos.x, s.pos.y);
  for (const peer of s.peers.values()) {
    collect(peer.id, peer.avatar, peer.curX, peer.curY);
  }
  if (!speakers.length) return;
  speakers.sort((a, b) => a.depth - b.depth);

  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  ctx.font = BUBBLE_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  for (const sp of speakers) {
    const sx = (sp.x - s.cam.x) * s.zoom;
    let bottom = (sp.headY - s.cam.y) * s.zoom - 14; // clear of the name tag
    const list = [...sp.list].sort((a, b) => a.at - b.at);
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      const alpha = Math.max(0, Math.min(1, (b.until - now) / 300));
      if (alpha <= 0) continue;
      const lines = wrapChatLines(ctx, b.text, BUBBLE_MAX_W);
      let textW = 0;
      for (const l of lines) textW = Math.max(textW, ctx.measureText(l).width);
      const w = textW + BUBBLE_PAD_X * 2;
      const h = lines.length * BUBBLE_LINE_H + BUBBLE_PAD_Y * 2;
      const newest = i === list.length - 1;
      const tailH = newest ? 8 : 0;
      const cx = Math.min(
        Math.max(sx, w / 2 + 6),
        Math.max(w / 2 + 6, s.viewW - w / 2 - 6)
      );
      const left = cx - w / 2;
      const top = Math.max(6, bottom - tailH - h);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = "rgba(16,24,32,0.85)";
      ctx.lineWidth = 3;
      // Strokes first, fills after, so the tail and the body
      // merge into one seamless thick outline.
      let tail = null;
      if (newest) {
        const tx = Math.min(Math.max(sx, left + 16), left + w - 16);
        tail = new Path2D();
        tail.moveTo(tx - 8, top + h - 2);
        tail.lineTo(tx, top + h + tailH);
        tail.lineTo(tx + 8, top + h - 2);
        tail.closePath();
        ctx.stroke(tail);
      }
      roundRectPath(ctx, left, top, w, h, 13);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      if (tail) ctx.fill(tail);
      roundRectPath(ctx, left, top, w, h, 13);
      ctx.fill();
      ctx.fillStyle = "#17222d";
      for (let li = 0; li < lines.length; li++) {
        ctx.fillText(
          lines[li],
          left + BUBBLE_PAD_X,
          top + BUBBLE_PAD_Y + BUBBLE_LINE_H * (li + 0.5)
        );
      }
      bottom = top - 6;
    }
  }
  ctx.globalAlpha = 1;
}

// "just now" / "2m ago" stamps for the chat log.
function relTime(at) {
  const secs = Math.max(0, Math.round((Date.now() - (at || 0)) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
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

  // Chat draws over everything, in screen space.
  drawSpeechBubbles(ctx, s);

  // door-transition fade, screen space, over the whole frame
  if (s.fade > 0) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = s.fade;
    ctx.fillStyle = "#0e1218";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }
}

export default function NeighborhoodRoom({ player, preview, onEditCharacter, onJoinFailed }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const themeRef = useRef("light");
  const [toast, setToast] = useState(null);
  const [hint, setHint] = useState(true);
  const [count, setCount] = useState(1);
  const [roomName, setRoomName] = useState("Town Square");
  const [log, setLog] = useState([]); // chat log entries (backfill + live)
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [, setClockTick] = useState(0); // re-render for relative stamps
  const chatBarRef = useRef(null);
  const logRef = useRef(null);
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
      // chat
      selfId: player?.playerId || "self",
      bubbles: new Map(), // playerId → [{ id, text, at, until }]
      // doors (milestone 6)
      destroyed: false,
      connGen: 0, // bumps per connection; stale events are dropped
      switching: false,
      fade: 0,
      fadeTarget: 0,
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

  function refreshCount() {
    const s = sRef.current;
    setCount(s.peers.size + 1);
  }

  // roster/move wire format → peer record (idempotent upsert)
  function applyWire(p) {
    const s = sRef.current;
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
  }

  // Event handlers for ONE connection generation. Every event
  // checks it still belongs to the room the player is in, so
  // nothing from a room we already left can smudge the current
  // one (door hops swap connections mid-flight — milestone 6).
  function makeHandlers(gen) {
    const s = sRef.current;
    const live = () => !s.destroyed && gen === s.connGen && !s.switching;
    return {
      // Authoritative roster (initial join, reconnect resync,
      // heartbeat re-join): reconcile the whole peer set.
      onRoster: (players, serverNow) => {
        if (!live()) return;
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
        if (!live()) return;
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
        if (!live()) return;
        applyWire(p);
        refreshCount();
      },
      onPeerLeave: (id) => {
        if (!live()) return;
        s.peers.delete(id);
        refreshCount();
      },
      onChat: (m) => {
        if (!live() || !m || !m.text) return;
        pushBubble(m.playerId, m.id, m.text);
        appendLog(m);
      },
    };
  }

  // Open a connection to `roomId` with fresh handlers. Events
  // route to the new generation immediately; a failed join
  // rolls the generation back so the old room stays live.
  async function openConn(roomId, entryPoint) {
    const s = sRef.current;
    const prevGen = s.connGen;
    const gen = prevGen + 1;
    s.connGen = gen;
    try {
      return await joinRoom({
        roomId,
        player,
        entry: entryPoint || undefined,
        ...makeHandlers(gen),
      });
    } catch (err) {
      s.connGen = prevGen;
      throw err;
    }
  }

  useEffect(() => {
    const s = sRef.current;
    s.destroyed = false;

    (async () => {
      try {
        const conn = await openConn(s.room.id, null);
        if (s.destroyed) {
          conn.leave();
          return;
        }
        s.conn = conn;
        s.clockOffset = conn.clockOffset;
        for (const p of conn.players) applyWire(p);
        refreshCount();

        // Chat log backfill from the stored trail, so a reload
        // (or late join) shows the recent conversation.
        fetchChatHistory(s.room.id).then((history) => {
          if (s.destroyed || s.conn !== conn || !history.length) return;
          setLog((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            const merged = [...history.filter((m) => !seen.has(m.id)), ...prev];
            merged.sort((a, b) => (a.at || 0) - (b.at || 0));
            return merged.length > LOG_LIMIT
              ? merged.slice(merged.length - LOG_LIMIT)
              : merged;
          });
        });

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
        if (s.destroyed) return;
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
      if (s.conn) s.conn.leave();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      s.destroyed = true;
      window.removeEventListener("pagehide", onPageHide);
      if (s.moveTimer) {
        clearTimeout(s.moveTimer);
        s.moveTimer = null;
      }
      if (s.conn) s.conn.leave();
      s.conn = null;
      s.peers.clear();
    };
    // The component remounts (key on updatedAt) when identity
    // changes, so this runs once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- doors (milestone 6) ---------------------------------
  // Arriving on an exit hotspot lands here: fade out, join the
  // target room (its capacity is enforced by the join API — a
  // full room bounces you back where you stand), then swap the
  // world, channel, peers and chat log in one go and fade in.
  async function goThroughDoor(exit) {
    const s = sRef.current;
    if (s.switching || s.destroyed) return;
    if (!s.conn) {
      setToast({
        text: "Doors need the live connection — try a refresh.",
        id: performance.now(),
      });
      return;
    }
    const target = getRoom(exit.roomId);
    const entryPoint = exit.arrive || target.spawn;
    s.switching = true;
    s.fadeTarget = 1;
    // a queued move for the old room must not fire mid-hop
    s.moveTarget = null;
    if (s.moveTimer) {
      clearTimeout(s.moveTimer);
      s.moveTimer = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      const conn = await openConn(target.id, entryPoint);
      if (s.destroyed) {
        // unmounted mid-hop: cleanup already sent /leave for our
        // row; just close the fresh channel.
        conn.detach();
        return;
      }
      const old = s.conn;
      s.room = target;
      s.grid = getNavGrid(target);
      s.bg = null;
      s.bgKey = "";
      s.peers.clear();
      s.bubbles.clear();
      s.path = [];
      s.walking = false;
      s.walkT = 0;
      s.pendingExit = null;
      s.marker = null;
      s.lastMoveAt = 0;
      const self = conn.self;
      s.pos = self ? { x: self.x, y: self.y } : { ...entryPoint };
      s.cam = null; // snap, don't pan, into the new room
      s.zoom = Math.min(Math.max(s.viewW / target.width, MIN_ZOOM), MAX_ZOOM);
      s.conn = conn;
      s.clockOffset = conn.clockOffset;
      for (const p of conn.players) applyWire(p);
      refreshCount();
      conn.updateSelf(s.pos.x, s.pos.y);
      // the old channel goes away, but our row already moved —
      // detach (no /leave, which would delete the new row)
      if (old) old.detach();
      setRoomName(target.name);
      setLog([]); // the log follows the room
      fetchChatHistory(target.id).then((history) => {
        if (s.destroyed || s.conn !== conn) return;
        setLog(history);
      });
    } catch (err) {
      if (err && err.code === "room_full") {
        setToast({
          text: `${exit.label} is packed right now — try again in a minute.`,
          id: performance.now(),
        });
      } else if (!s.destroyed) {
        setToast({
          text: "That door seems stuck — give it another try.",
          id: performance.now(),
        });
      }
    } finally {
      s.switching = false;
      s.fadeTarget = 0;
    }
  }

  // The rAF loop lives in a run-once effect; hand it the latest
  // door fn through a ref so it never calls a stale closure.
  const doorFnRef = useRef(null);
  doorFnRef.current = goThroughDoor;

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

  // ---- chat ------------------------------------------------
  function pushBubble(playerId, id, text) {
    const s = sRef.current;
    const list = s.bubbles.get(playerId) || [];
    list.push({ id, text, at: Date.now(), until: Date.now() + bubbleDurationMs(text) });
    while (list.length > BUBBLE_MAX_PER_PLAYER) list.shift();
    s.bubbles.set(playerId, list);
  }

  function dropBubble(playerId, id) {
    const s = sRef.current;
    const list = s.bubbles.get(playerId);
    if (!list) return;
    const alive = list.filter((b) => b.id !== id);
    if (alive.length) s.bubbles.set(playerId, alive);
    else s.bubbles.delete(playerId);
  }

  function appendLog(entry) {
    setLog((prev) => {
      if (entry.id && prev.some((e) => e.id === entry.id)) return prev;
      const next = [...prev, entry];
      return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
    });
  }

  // Optimistic send: bubble + log line appear instantly, the
  // round trip swaps in the server id/timestamp — or marks the
  // line failed and pulls the bubble back down gently.
  async function handleChatSubmit(e) {
    e.preventDefault();
    const s = sRef.current;
    const v = validateChatText(chatDraft);
    if (!v.ok) {
      if (v.code !== "empty") setToast({ text: v.error, id: performance.now() });
      return;
    }
    if (!s.conn) {
      setToast({ text: "Chat is offline right now — try a refresh.", id: performance.now() });
      return;
    }
    if (chatBusy) return;
    setChatDraft("");
    const localId = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    pushBubble(s.selfId, localId, v.value);
    appendLog({
      id: localId,
      playerId: s.selfId,
      username: s.name,
      text: v.value,
      at: Date.now(),
      pending: true,
    });
    setChatBusy(true);
    try {
      const res = await s.conn.chat(v.value);
      const m = res && res.message;
      setLog((prev) =>
        prev.map((entry) =>
          entry.id === localId
            ? { ...entry, id: (m && m.id) || localId, at: (m && m.at) || entry.at, pending: false }
            : entry
        )
      );
    } catch (err) {
      dropBubble(s.selfId, localId);
      setLog((prev) =>
        prev.map((entry) =>
          entry.id === localId ? { ...entry, pending: false, failed: true } : entry
        )
      );
      setToast({ text: (err && err.message) || "That message didn't send.", id: performance.now() });
      if (err && err.code === "rate_limited") setChatDraft(v.value);
    } finally {
      setChatBusy(false);
    }
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
        // arrived at a door — step through (or nudge if that
        // room isn't in the registry yet)
        const exit = s.pendingExit;
        s.pendingExit = null;
        if (exit.roomId && doorFnRef.current) {
          doorFnRef.current(exit);
        } else {
          setToast({ text: `${exit.label} — opening soon!`, id: now });
        }
      }
      s.walking = moving;

      // door-transition fade eases toward its target
      if (s.fade !== s.fadeTarget) {
        const step = FADE_SPEED * dt;
        s.fade =
          s.fade < s.fadeTarget
            ? Math.min(s.fadeTarget, s.fade + step)
            : Math.max(s.fadeTarget, s.fade - step);
      }

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

      // let expired speech bubbles go
      const wallNow = Date.now();
      for (const [id, list] of s.bubbles) {
        const alive = list.filter((b) => b.until > wallNow);
        if (alive.length !== list.length) {
          if (alive.length) s.bubbles.set(id, alive);
          else s.bubbles.delete(id);
        }
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

  // Mobile keyboards: lift the chat bar by exactly however much
  // the keyboard overlaps it (visualViewport), leaving the
  // canvas layout itself alone. The 16px input font prevents
  // iOS zoom-on-focus.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      const bar = chatBarRef.current;
      if (!bar) return;
      bar.style.transform = "none";
      const rect = bar.getBoundingClientRect();
      const keyboardTop = vv.offsetTop + vv.height;
      const overlap = rect.bottom + 8 - keyboardTop;
      if (overlap > 0) bar.style.transform = `translateY(${-overlap}px)`;
    };
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("scroll", apply, true);
    apply();
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("scroll", apply, true);
    };
  }, []);

  // pin the log to the newest message
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, chatOpen]);

  // keep "2m ago" stamps fresh while the log is open
  useEffect(() => {
    if (!chatOpen) return;
    const t = setInterval(() => setClockTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [chatOpen]);

  function handlePointerDown(e) {
    const canvas = canvasRef.current;
    const s = sRef.current;
    if (!canvas || !s.cam) return;
    if (s.switching) return; // mid door-hop — ignore taps
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left) / s.zoom + s.cam.x;
    const wy = (e.clientY - rect.top) / s.zoom + s.cam.y;

    // Door tap? Walk over, then step through on arrival.
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
      // already standing at the door — step straight through
      if (exit) {
        s.pendingExit = null;
        if (exit.roomId && doorFnRef.current) {
          doorFnRef.current(exit);
        } else {
          setToast({ text: `${exit.label} — opening soon!`, id: performance.now() });
        }
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
            {roomName}
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            aria-pressed={chatOpen}
            className={`min-h-[40px] rounded-md border border-espn px-3 font-display text-xs uppercase tracking-widest transition-colors ${
              chatOpen
                ? "bg-espn text-white"
                : "text-espn hover:bg-espn hover:text-white"
            }`}
          >
            {chatOpen ? "Hide Log" : "Chat Log"}
          </button>
          <button
            type="button"
            onClick={onEditCharacter}
            className="min-h-[40px] rounded-md border border-espn px-3 font-display text-xs uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white"
          >
            Edit Character
          </button>
        </div>
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
          aria-label={`${roomName} — tap the ground to walk`}
        />
        {chatOpen && (
          <div
            ref={logRef}
            aria-label="Chat log"
            className="absolute right-2 top-2 z-10 max-h-[55%] w-[min(19rem,78%)] space-y-2 overflow-y-auto rounded-xl border border-gray-200 bg-white/95 p-2.5 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-900/95"
          >
            {log.length === 0 && (
              <p className="py-1 text-center text-xs text-gray-500 dark:text-gray-400">
                No chatter yet — say hi!
              </p>
            )}
            {log.map((entry) => (
              <div key={entry.id} className={entry.failed ? "opacity-70" : ""}>
                <span
                  className={`font-semibold ${
                    entry.playerId === sRef.current.selfId
                      ? "text-espn"
                      : "text-gray-900 dark:text-gray-100"
                  }`}
                >
                  {entry.username}
                </span>{" "}
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                  {entry.pending
                    ? "sending…"
                    : entry.failed
                      ? "not sent"
                      : relTime(entry.at)}
                </span>
                <p
                  className={`break-words leading-snug ${
                    entry.failed
                      ? "italic text-gray-400 line-through dark:text-gray-500"
                      : "text-gray-700 dark:text-gray-200"
                  }`}
                >
                  {entry.text}
                </p>
              </div>
            ))}
          </div>
        )}
        {(toast || hint) && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute inset-x-0 bottom-[4.25rem] flex justify-center px-4"
          >
            <p className="rounded-full bg-black/70 px-4 py-2 text-center text-sm font-medium text-white">
              {toast ? toast.text : "Tap the ground to walk around"}
            </p>
          </div>
        )}
        <form
          ref={chatBarRef}
          onSubmit={handleChatSubmit}
          className="absolute inset-x-2 bottom-2 z-20 flex items-center gap-2"
        >
          <input
            type="text"
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            maxLength={CHAT_MAX}
            placeholder="Say something…"
            enterKeyHint="send"
            autoComplete="off"
            aria-label="Chat message"
            className="h-11 min-w-0 flex-1 rounded-full border border-gray-300 bg-white/95 px-4 text-[16px] text-gray-900 shadow-sm outline-none placeholder:text-gray-400 focus:border-espn dark:border-gray-600 dark:bg-gray-900/95 dark:text-gray-100"
          />
          <button
            type="submit"
            disabled={chatBusy}
            className="h-11 min-w-[64px] rounded-full bg-espn px-4 font-display text-xs uppercase tracking-widest text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            Send
          </button>
        </form>
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        Tap a doorway to head inside — or back out to the square. League
        friends in the room walk around and chat live; open the log to catch
        up.
      </p>
    </div>
  );
}
