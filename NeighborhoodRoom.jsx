"use client";

// ============================================================
// HSPNeighborhood — room engine (multiplayer + doors, m4-m8)
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
//     broadcasts; EVERY avatar — peers and (milestone 7) your
//     own — is rendered DETERMINISTICALLY from
//     (origin, path, startedAt) with the shared constant-speed
//     math, so a tab that sat hidden (rAF frozen) snaps to
//     where you really are the moment it's visible again
//   • Y-depth sorting of props + every player each frame
//   • camera follow with room clamping, DPR-aware sizing,
//     dark/light palettes
//   • doors (milestone 6): arriving on an exit hotspot joins
//     the target room via the same join API (capacity checked
//     there — full rooms bounce you back with a toast), swaps
//     world + Realtime channel + peers under a short fade,
//     and replays the new room's chat history in the log
//   • moderation (milestone 7): a "kicked" broadcast for us
//     tears the connection down and hands off to the removed
//     screen; "chat_delete" pulls a message out of the log and
//     any still-visible bubble
//   • secret chain (milestone 8): rooms may declare tappable
//     `interact` hotspots — reveals (the restroom's spinning
//     wall) and coded keypads (the hallway's blast door) —
//     plus exits gated by the per-visit flags they set; the
//     flags live in client state only, so every player
//     discovers the chain for themselves
//   • tomatoes (milestone 13): arm the Tomato button and the
//     next tap is a THROW — at a player, at any spot in the
//     room, or at a big screen. The client only ever sends a
//     target to /api/neighborhood/throw; the server decides
//     the origin, the flight time and the landing point and
//     broadcasts one record, so every browser replays the
//     identical arc (the walking pattern, applied to
//     projectiles). Splats stick for a few seconds and fade.
//     Screen splats are painted on an overlay canvas pinned to
//     the same rect as the <video>, so they land ON a live
//     feed instead of behind it
//   • big board (milestone 9, two rooms since 12): in any room
//     that has a screen — Mission Control's big board and the
//     Sports Bar's screen over the counter — a DOM <video> is
//     pinned over the canvas to that room's screen rect
//     (screenRectFor()) and re-positioned in the SAME
//     animation frame as the draw, so the screen-share stays
//     welded to the wall through every camera move. Both rects
//     are the same 16:9 size and ONE broadcast feeds both
//     rooms. Media is peer to peer
//     (lib/neighborhood/screenshare.js); only the commissioner
//     can start one, and only from Mission Control
// ============================================================

import { useEffect, useRef, useState } from "react";
import { drawAvatar, normalizeAvatar } from "@/lib/neighborhoodAvatar";
import {
  getRoom,
  screenRectFor,
  roomHasScreen,
  setScreenFeedState,
  BROADCAST_ROOM_ID,
  CASINO_TABLE_SEATS,
} from "@/lib/neighborhood/rooms";
import * as BJ from "@/lib/neighborhood/blackjack";
import { drawTableView, actionsFor, statusLine } from "@/lib/neighborhood/casinoTable";
import dynamic from "next/dynamic";
import { TEAMS } from "@/lib/leagueData";
import { findPath, getNavGrid, nearestWalkable } from "@/lib/neighborhood/pathing";
import { advanceAlongPath } from "@/lib/neighborhood/movement";
import { joinRoom, fetchChatHistory } from "@/lib/neighborhood/realtime";
import { CHAT_MAX, validateChatText, bubbleDurationMs } from "@/lib/neighborhood/chat";
import {
  THROW_COOLDOWN_MS,
  HAND_LIFT,
  BODY_LIFT,
  SPLAT_LIFE_MS,
  SPLAT_RADIUS,
  SCREEN_SPLAT_RADIUS,
  TOMATO_RADIUS,
  MAX_SPLATS,
  arcPointAt,
  arcHeightFor,
  flightDurationMs,
  splatAlpha,
  splatScale,
  seedFromId,
  rngFrom,
  makeSplatArt,
  drawSplat,
  drawTomato,
  drawTomatoShadow,
} from "@/lib/neighborhood/tomatoes";
import {
  createBroadcaster,
  createViewer,
  checkBroadcastAuth,
  screenShareSupported,
  screenViewSupported,
  relayAvailable,
} from "@/lib/neighborhood/screenshare";

const AVATAR_SCALE = 0.92; // world size of players in rooms
const MIN_ZOOM = 0.55; // keep avatars readable on small phones
const MAX_ZOOM = 1;
// Floor for rooms that must fit their whole selves (below).
// Lower than MIN_ZOOM on purpose: in a short window, showing
// all of Mission Control beats keeping avatars big.
const MIN_FIT_ZOOM = 0.4;
const SIZE_FACTOR = { short: 0.86, medium: 1, tall: 1.14 }; // mirrors drawAvatar
const MOVE_SEND_GAP_MS = 340; // client-side pacing under the ~3/s server limit
const LOG_LIMIT = 120; // chat log entries kept in memory
const FADE_SPEED = 4; // door-transition fade, full swings per second
const LONG_PRESS_MS = 550; // hold the feed to go OS fullscreen
// Milestone 14 — the casino. BJ_SYNC_MS is the pulse that
// moves a table's clock: serverless functions cannot tick on
// their own, so whoever is in the room asks the server to
// advance any expired deadline. Cheap (one row read, a write
// only when something actually changed) and self-healing —
// the LAST player to leave the room still leaves a table whose
// next visitor ticks it forward on arrival.
const BJ_SYNC_MS = 2500;
const CASINO_ROOMS = ["casino-floor", "casino-strip"];
const BJ_TABLE_ROOM = "casino-floor";
const CHIP_VALUES = [5, 25, 100];
// Chat at the table (milestone 15). Seated players read the
// SAME room chat as everyone else — these two numbers only
// decide how much of it is echoed onto the felt before the
// felt goes quiet again. Anything older lives in the Chat Log.
const TABLE_CHAT_LINES = 4;
const TABLE_CHAT_MS = 60_000;
const TABLE_CHAT_FADE = [0.45, 0.62, 0.8, 1]; // oldest line dimmest

// Speech bubbles are drawn in SCREEN pixels (not world units)
// so chat stays readable at every phone zoom level.
const BUBBLE_FONT = "600 13.5px Inter, system-ui, sans-serif";
const BUBBLE_MAX_W = 210;
const BUBBLE_LINE_H = 17;
const BUBBLE_PAD_X = 11;
const BUBBLE_PAD_Y = 8;
const BUBBLE_MAX_PER_PLAYER = 3; // rapid-fire stacks, oldest drops

// Milestone 17 — the arcade machine in the Fast Food Place.
// The cabinet mounts the SAME DeepThreatGame the /deep-threat
// page uses (own canvas, own /api/deep-threat/leaderboard
// fetch), lazy-loaded so nobody downloads a football game
// just to walk around town.
const DeepThreatGame = dynamic(() => import("@/components/DeepThreatGame"), {
  ssr: false,
  loading: () => (
    <p className="py-12 text-center font-display text-sm uppercase tracking-widest text-gray-500">
      Powering up the cabinet…
    </p>
  ),
});
const ARCADE_NAMES = TEAMS.map((t) => t.manager);

// Camera offset for one axis: follow the player, clamp to the
// room, center (negative offset) when the room fits the view.
function camAxis(center, view, world) {
  if (view >= world) return (world - view) / 2;
  return Math.min(Math.max(center - view / 2, 0), world - view);
}

// How far to zoom for a room at a given viewport.
//
// The default rule fits the room's WIDTH, which is right for
// rooms you explore by walking: taller-than-view rooms scroll
// vertically as you move, and the camera clamp keeps you from
// panning past the walls.
//
// That rule alone cannot show scenery mounted ABOVE the floor.
// The camera follows your feet, so the highest it can ever pan
// is (top of the walkable polygon - half a viewport). In
// Mission Control the big board lives at y 36-378 while the
// floor starts at y 452, so on a desktop-shaped viewport (wide
// => zoom pinned at MAX_ZOOM => a short world-space view) the
// top of the board sat above the camera's reach and was simply
// unreachable.
//
// So the zoom now fits the WHOLE room — both axes — in every
// room, and no room is ever drawn closer than that fit. This
// is what milestone 10 gave Mission Control (as fitHeight) and
// milestone 12 gave the Sports Bar: those two framed better on
// desktop than every other room, which is exactly the "too
// zoomed in" everywhere else — Town Square's storefronts sit
// above its floor and a wide, short window could never pan up
// to them. `fitRoom` now only picks the floor: rooms that must
// show a wall screen shrink to MIN_FIT_ZOOM, the rest stop at
// MIN_ZOOM. On a phone width is the binding axis either way,
// so phone framing is unchanged and only desktop pulls back.
export function roomZoom(room, viewW, viewH) {
  const byWidth = Math.min(Math.max(viewW / room.width, MIN_ZOOM), MAX_ZOOM);
  if (!(viewH > 0)) return byWidth;
  const fit = Math.min(viewW / room.width, viewH / room.height);
  return Math.max(Math.min(byWidth, fit), room.fitRoom ? MIN_FIT_ZOOM : MIN_ZOOM);
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

// ---- tomatoes (milestone 13) -----------------------------

// Roughly the box an avatar occupies, in world units, for
// "did that tap hit a player?". Generous on purpose: a thumb
// on a phone is not a sniper scope.
function avatarHitBox(avatar, x, y) {
  const size = (avatar && avatar.body && avatar.body.size) || "medium";
  const h = 150 * (SIZE_FACTOR[size] || 1) * AVATAR_SCALE;
  const halfW = 48 * AVATAR_SCALE;
  return { left: x - halfW, right: x + halfW, top: y - h - 8, bottom: y + 14 };
}

// Frontmost player under a world point, or null. Peers only —
// tapping your own avatar means "splat the ground I'm on".
function playerHitAt(s, wx, wy) {
  let best = null;
  for (const peer of s.peers.values()) {
    const b = avatarHitBox(peer.avatar, peer.curX, peer.curY);
    if (wx < b.left || wx > b.right || wy < b.top || wy > b.bottom) continue;
    if (!best || peer.curY > best.curY) best = peer;
  }
  return best;
}

// Where a tomato is actually headed THIS frame. Player-seeking
// throws re-aim at the victim's live position every frame —
// which is still deterministic, because every client computes
// that position from the same broadcast path + timestamp.
function throwEndpoint(s, t) {
  if (t.kind !== "player") return { x: t.tx, y: t.ty };
  if (t.targetId === s.selfId) return { x: s.pos.x, y: s.pos.y - BODY_LIFT };
  const peer = s.peers.get(t.targetId);
  if (peer) return { x: peer.curX, y: peer.curY - BODY_LIFT };
  return { x: t.tx, y: t.ty - BODY_LIFT };
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

  // secret-chain state handed to prop draw fns (milestone 8)
  const fx = { flags: s.flags, times: s.flagTimes };

  // Y-depth sort: lower feet = closer to camera = drawn later.
  // Props, every peer and ourselves all sort in ONE list.
  const ents = [];
  for (const p of room.props) ents.push({ y: p.sortY ?? p.y, prop: p });
  // Anyone sitting at the blackjack table is PAINTED in their
  // chair rather than wherever their walk left them
  // (milestone 14). The seat map is mirrored from the same
  // broadcast state the felt is drawn from, so every client in
  // the room sees the same three chairs filled by the same
  // three people.
  for (const peer of s.peers.values()) {
    const at = s.seatAnchors.get(peer.id);
    ents.push({ y: at ? at.y : peer.curY, peer, at });
  }
  const selfAt = s.seatAnchors.get(s.selfId);
  ents.push({ y: selfAt ? selfAt.y : s.pos.y, player: true, at: selfAt });
  // Splats on the floor / a wall / a prop sort by where they
  // landed, exactly like scenery does: a splat low on the
  // screen is in front, one up on a wall is behind everybody.
  // (Splats on a SCREEN are not here — they ride the overlay
  // canvas over the <video>.)
  for (const sp of s.splats) if (sp.kind === "spot") ents.push({ y: sp.y, splat: sp });
  ents.sort((a, b) => a.y - b.y);
  const wallNowDraw = Date.now();
  const drawStuck = (id, x, y) => {
    for (const sp of s.splats) {
      if (sp.kind !== "player" || sp.targetId !== id) continue;
      const age = wallNowDraw - sp.at;
      drawSplat(ctx, sp.art, x + sp.dx, y - BODY_LIFT + sp.dy, splatAlpha(age), splatScale(age));
    }
  };
  for (const e of ents) {
    if (e.player) {
      const px = e.at ? e.at.x : s.pos.x;
      const py = e.at ? e.at.y : s.pos.y;
      drawAvatar(ctx, s.avatar, px, py, AVATAR_SCALE, {
        walking: e.at ? false : s.walking,
        frame: e.at ? 0 : s.walkT,
      });
      drawStuck(s.selfId, px, py);
      drawNameTag(ctx, s.name, px, tagYFor(s.avatar, py), true);
    } else if (e.peer) {
      const pr = e.peer;
      const px = e.at ? e.at.x : pr.curX;
      const py = e.at ? e.at.y : pr.curY;
      drawAvatar(ctx, pr.avatar, px, py, AVATAR_SCALE, {
        walking: e.at ? false : pr.walking,
        frame: e.at ? 0 : pr.walkT,
      });
      drawStuck(pr.id, px, py);
      drawNameTag(ctx, pr.username, px, tagYFor(pr.avatar, py), false);
    } else if (e.splat) {
      const age = wallNowDraw - e.splat.at;
      drawSplat(ctx, e.splat.art, e.splat.x, e.splat.y, splatAlpha(age), splatScale(age));
    } else {
      e.prop.draw(ctx, e.prop, P, theme, t, fx);
    }
  }

  // Tomatoes in the air draw over everything in the world —
  // they are, after all, in the air.
  for (const tm of s.tomatoes) {
    const u = Math.max(0, Math.min(1, (wallNowDraw - tm.at) / tm.flightMs));
    const end = throwEndpoint(s, tm);
    const oy = tm.oy - HAND_LIFT;
    const arcH = arcHeightFor(tm.ox, oy, end.x, end.y);
    const pt = arcPointAt(tm.ox, oy, end.x, end.y, u, arcH);
    drawTomatoShadow(
      ctx,
      tm.ox + (end.x - tm.ox) * u,
      tm.oy + (end.y + HAND_LIFT - tm.oy) * u,
      u,
      TOMATO_RADIUS
    );
    drawTomato(ctx, pt.x, pt.y, TOMATO_RADIUS, pt.rot);
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

// ---- keypad overlay (milestone 8) --------------------------
// Full-screen number pad for coded doors. The expected code
// comes from the room config (`interact[].code`) — client-side
// theater for an easter egg, not security. Wrong codes flash
// ACCESS DENIED and shake; the right one hands off to
// onSuccess after a short green beat. Keys are 56px tall for
// phone thumbs, and a hardware keyboard works too.
function KeypadOverlay({ act, onSuccess, onClose }) {
  const [value, setValue] = useState("");
  const [denied, setDenied] = useState(false);
  const [granted, setGranted] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const timerRef = useRef(null);
  const len = (act.code || "").length || 4;

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function press(d) {
    if (denied || granted) return;
    const next = value.length < len ? value + d : value;
    setValue(next);
    if (next.length === len && next !== value) {
      if (next === act.code) {
        setGranted(true);
        timerRef.current = setTimeout(onSuccess, 650);
      } else {
        setDenied(true);
        setShakeKey((k) => k + 1);
        timerRef.current = setTimeout(() => {
          setDenied(false);
          setValue("");
        }, 850);
      }
    }
  }

  function backspace() {
    if (!denied && !granted) setValue((v) => v.slice(0, -1));
  }

  // hardware keyboards: digits, backspace, escape
  useEffect(() => {
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") backspace();
      else if (e.key === "Escape" && !granted) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const slots = [];
  for (let i = 0; i < len; i++) slots.push(value[i] || "");
  const keyCls =
    "flex h-14 items-center justify-center rounded-lg border border-gray-400 bg-white font-display text-xl font-semibold text-gray-800 shadow-sm transition active:scale-95 active:bg-gray-100 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-100 dark:active:bg-gray-600";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Security keypad"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !granted) onClose();
      }}
    >
      <style>{`@keyframes hspnKeypadShake{0%,100%{transform:translateX(0)}15%{transform:translateX(-11px)}35%{transform:translateX(9px)}55%{transform:translateX(-7px)}75%{transform:translateX(5px)}90%{transform:translateX(-2px)}}`}</style>
      <div
        key={shakeKey}
        className="w-full max-w-[20rem] rounded-2xl border-2 border-gray-500 bg-gray-100 p-4 shadow-2xl dark:border-gray-500 dark:bg-gray-800"
        style={denied ? { animation: "hspnKeypadShake 0.5s" } : undefined}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="font-display text-sm font-semibold uppercase tracking-widest text-gray-800 dark:text-gray-100">
              {act.title || "Security Door"}
            </p>
            <p
              aria-live="polite"
              className={`text-xs font-semibold uppercase tracking-wider ${
                granted
                  ? "text-green-600 dark:text-green-400"
                  : denied
                    ? "text-red-600 dark:text-red-400"
                    : "text-gray-500 dark:text-gray-400"
              }`}
            >
              {granted
                ? "Access granted"
                : denied
                  ? "Access denied"
                  : act.subtitle || "Enter access code"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keypad"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-400 text-lg text-gray-600 transition hover:bg-gray-200 dark:border-gray-500 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            ✕
          </button>
        </div>
        <div
          className={`mb-3 flex h-14 items-center justify-center gap-3 rounded-lg border-2 bg-gray-900 font-mono text-2xl tracking-widest ${
            granted
              ? "border-green-500 text-green-400"
              : denied
                ? "border-red-500 text-red-400"
                : "border-gray-600 text-emerald-300"
          }`}
        >
          {slots.map((d, i) => (
            <span
              key={i}
              className={`inline-block w-5 text-center ${d === "" ? "opacity-30" : ""}`}
            >
              {d === "" ? "•" : d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} type="button" onClick={() => press(d)} className={keyCls}>
              {d}
            </button>
          ))}
          <button type="button" onClick={backspace} aria-label="Delete digit" className={keyCls}>
            ⌫
          </button>
          <button type="button" onClick={() => press("0")} className={keyCls}>
            0
          </button>
          <button type="button" onClick={onClose} aria-label="Cancel" className={keyCls}>
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NeighborhoodRoom({
  player,
  preview,
  onEditCharacter,
  onJoinFailed,
  onRemoved,
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const themeRef = useRef("light");
  const [toast, setToast] = useState(null);
  const [count, setCount] = useState(1);
  const [roomName, setRoomName] = useState("Town Square");
  const [log, setLog] = useState([]); // chat log entries (backfill + live)
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [keypad, setKeypad] = useState(null); // open keypad interact config (milestone 8)
  // Milestone 17 — the arcade. True while the Deep Threat
  // cabinet has the viewport. Same overlay contract as the
  // blackjack table: the world, the connection and the 30s
  // heartbeats keep running underneath, so a long game never
  // reads as idle to the server-side stale prune.
  const [arcadeOpen, setArcadeOpen] = useState(false);
  const arcadeFnRef = useRef(null);
  arcadeFnRef.current = () => setArcadeOpen(true);
  // ---- tomatoes (milestone 13) ----
  // Armed = the NEXT tap is a throw instead of a walk. One
  // obvious state, one obvious cancel; nothing about
  // click-to-walk changes while it is off.
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  armedRef.current = armed;
  const screenFxRef = useRef(null); // splat overlay, pinned over the <video>
  // ---- casino (milestone 14) ----
  // The table is never simulated here. `bjTable` is verbatim
  // whatever the server last broadcast (cards, whose turn,
  // everyone's money); the only local state is which chips you
  // have stacked up but not yet committed.
  const [bjTable, setBjTable] = useState(null);
  const [bjBalance, setBjBalance] = useState(null);
  const [bjSeated, setBjSeated] = useState(false);
  const [bjMin, setBjMin] = useState(false); // seated, but watching the room
  const [bjBusy, setBjBusy] = useState(false);
  const [bjStake, setBjStake] = useState(0); // chips down, not yet committed
  const bjCanvasRef = useRef(null);
  const bjTableRef = useRef(null);
  const bjBalanceRef = useRef(null);
  const bjSeatedRef = useRef(false);
  const bjCallRef = useRef(null);
  const seatFnRef = useRef(null);
  bjTableRef.current = bjTable;
  bjBalanceRef.current = bjBalance;
  bjSeatedRef.current = bjSeated;
  // ---- big board (milestone 9) ----
  const [roomId, setRoomId] = useState("town-square");
  const [feed, setFeed] = useState("standby"); // standby | connecting | live
  const [canBroadcast, setCanBroadcast] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [hd, setHd] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [theater, setTheater] = useState(false);
  const [viewers, setViewers] = useState(null);
  const videoRef = useRef(null);
  const videoBoxRef = useRef(null);
  const screenRef = useRef(null); // { viewer, broadcaster, roomId }
  const canBroadcastRef = useRef(false);
  const sharingRef = useRef(false);
  const soundOnRef = useRef(false);
  const theaterRef = useRef(false);
  const longPressRef = useRef(null);
  theaterRef.current = theater;
  sharingRef.current = sharing;
  soundOnRef.current = soundOn;
  const [, setClockTick] = useState(0); // re-render for relative stamps
  const chatBarRef = useRef(null);
  const tableChatBarRef = useRef(null); // the same chat, sent from the table
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
      // Own walk = the SAME deterministic shape peers use:
      // { origin, path, startedAt } advanced by wall-clock time
      // (milestone 7 — hidden tabs catch up on return).
      walk: null,
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
      // tomatoes (milestone 13): in-flight arcs and the splats
      // they leave. Both are ephemeral client state replayed
      // from broadcast records — nothing is stored server-side.
      tomatoes: [],
      splats: [],
      lastThrowAt: 0,
      fxPainted: false,
      // chat
      selfId: player?.playerId || "self",
      bubbles: new Map(), // playerId → [{ id, text, at, until }]
      // big board (milestone 9): true while a feed should be
      // painted over the wall — read by the rAF loop
      feedOn: false,
      // secret chain (milestone 8): per-visit discovery flags
      // (tunnelOpen, vaultOpen) + trigger times in seconds on
      // the rAF clock, for the reveal animations
      flags: {},
      flagTimes: {},
      // blackjack (milestone 14): playerId -> the chair their
      // avatar is painted in, mirrored from the broadcast
      // table state. Empty in every room but the casino floor.
      seatAnchors: new Map(),
      pendingSeat: null,
      // arcade (milestone 17): true while walking to the cabinet
      pendingArcade: false,
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

  // ---- big board / screen share (milestone 9) ---------------

  // One place decides what the wall is showing: React (for the
  // badges), the mutable loop state (for positioning) and the
  // canvas prop (for the standby art) all move together.
  function applyFeed(state) {
    const s = sRef.current;
    s.feedOn = state === "live";
    setScreenFeedState(state);
    setFeed(state);
  }

  // iOS Safari refuses play() on an element that is not being
  // rendered, and never retries on its own. The board is still
  // display:none at the moment the track arrives — the rAF loop
  // only reveals it on the NEXT frame — so a single play() can
  // lose that race and leave a phone staring at a dead
  // rectangle. Ask again, briefly, until the picture is running.
  function playVideo(v, tries) {
    if (!v || !v.srcObject) return;
    const played = v.play();
    if (played && played.catch) {
      played.catch(() => {
        if (tries > 0) setTimeout(() => playVideo(v, tries - 1), 350);
      });
    }
  }

  function attachStream(stream) {
    const v = videoRef.current;
    if (!v) return;
    if (stream) {
      if (v.srcObject !== stream) v.srcObject = stream;
      // Autoplay policy: always land muted, then let the first
      // tap turn the sound on. The broadcaster's own preview
      // stays muted for good — unmuting it would feed his own
      // tab audio straight back at him.
      v.muted = true;
      playVideo(v, 12);
    } else {
      v.srcObject = null;
      v.muted = true;
    }
  }

  // Give the commissioner a broadcaster once we know he is one
  // (the auth probe can land after the room connection does).
  function ensureBroadcaster() {
    const sc = screenRef.current;
    if (!sc || sc.broadcaster || !canBroadcastRef.current) return;
    // Watching happens in every room with a screen; STARTING a
    // broadcast happens in Mission Control, which is the room
    // the grant and the admin gate name. (The feed then shows
    // up on the bar's screen too — same mesh, same grant.)
    if (sc.roomId !== BROADCAST_ROOM_ID) return;
    sc.broadcaster = createBroadcaster({
      conn: sc.conn,
      selfId: sRef.current.selfId,
      roomId: sc.roomId,
      onState: (state) => {
        const isLive = state === "live";
        setSharing(isLive);
        if (isLive) {
          applyFeed("live");
          attachStream(sc.broadcaster.getStream());
        } else {
          applyFeed("standby");
          attachStream(null);
          setViewers(null);
        }
      },
      onViewers: (info) => setViewers(info),
    });
  }

  function detachScreen() {
    const sc = screenRef.current;
    screenRef.current = null;
    if (sc) {
      try {
        if (sc.broadcaster) sc.broadcaster.stop();
      } catch {
        // tearing down anyway
      }
      try {
        if (sc.viewer) sc.viewer.teardown();
      } catch {
        // tearing down anyway
      }
    }
    setSharing(false);
    setSoundOn(false);
    setTheater(false);
    setViewers(null);
    applyFeed("standby");
    attachStream(null);
  }

  // Wire the screen-share peers to a freshly opened room
  // connection. In a room with no screen this just makes sure
  // nothing is left running.
  function attachScreen(conn, targetRoomId) {
    detachScreen();
    // WATCHING only needs a peer connection. Gating this on
    // screenShareSupported() (which also demands getDisplayMedia,
    // a desktop-only capture API) is what kept every phone on
    // "AWAITING FEED" — no viewer, so no hello, so no offer.
    if (!roomHasScreen(targetRoomId) || !screenViewSupported()) return;
    const selfId = sRef.current.selfId;
    const sc = { conn, roomId: targetRoomId, viewer: null, broadcaster: null };
    sc.viewer = createViewer({
      conn,
      selfId,
      roomId: targetRoomId,
      onStream: (stream) => {
        // The broadcaster watches his own local preview; don't
        // let a loopback offer overwrite it.
        if (sharingRef.current) return;
        attachStream(stream);
      },
      onState: (state) => {
        if (sharingRef.current) return;
        if (state === "failed") {
          // Two different failures, two different sentences.
          // Without a relay configured, a cellular viewer will
          // never connect and should be told so; with one, a
          // failure is a fluke worth retrying.
          setToast({
            text: relayAvailable()
              ? "Lost that connection — walk out and back in to retry."
              : "Couldn't reach the feed — that connection needs a relay.",
            id: performance.now(),
          });
          applyFeed("standby");
          attachStream(null);
          return;
        }
        applyFeed(state);
        if (state !== "live") {
          setSoundOn(false);
          setTheater(false);
          if (state === "standby") attachStream(null);
        }
      },
    });
    screenRef.current = sc;
    // "May I broadcast?" was asked exactly once, on mount, in
    // the Town Square. One hiccup on that fetch — a cold start,
    // a dropped request — and the answer was a permanent no:
    // there was no retry, so the Share My Screen button stayed
    // hidden for the whole session no matter how many times
    // Austin walked into the bunker. Walking into the broadcast
    // room asks again. The server is still the only authority
    // and still 404s everyone without the commissioner cookie,
    // so this widens nothing; it just stops one lost packet
    // from costing a broadcast.
    if (
      targetRoomId === BROADCAST_ROOM_ID &&
      !canBroadcastRef.current &&
      screenShareSupported()
    ) {
      checkBroadcastAuth().then((ok) => {
        if (!ok || screenRef.current !== sc) return;
        canBroadcastRef.current = true;
        setCanBroadcast(true);
        ensureBroadcaster();
      });
    }
    ensureBroadcaster();
    // Someone may already be broadcasting — say hello and find
    // out, rather than waiting for the next announcement.
    sc.viewer.announce();
  }

  // Is this browser the commissioner? The server answers; the
  // Share My Screen button doesn't render otherwise.
  useEffect(() => {
    let alive = true;
    if (!screenShareSupported()) return undefined;
    checkBroadcastAuth().then((ok) => {
      if (!alive) return;
      canBroadcastRef.current = ok;
      setCanBroadcast(ok);
      if (ok) ensureBroadcaster();
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleShare() {
    const sc = screenRef.current;
    if (!sc || !sc.broadcaster || shareBusy) return;
    if (sc.broadcaster.isLive()) {
      sc.broadcaster.stop();
      return;
    }
    setShareBusy(true);
    try {
      await sc.broadcaster.start({ hd });
    } catch (err) {
      const name = err && err.name;
      if (name === "NotAllowedError" || name === "AbortError") {
        // picker dismissed — not an error worth a toast
      } else if (err && err.code === "not_admin") {
        setToast({
          text: "Only the commissioner can put a feed on the big board.",
          id: performance.now(),
        });
      } else {
        setToast({
          text: "That share didn't start — give it another try.",
          id: performance.now(),
        });
      }
    } finally {
      setShareBusy(false);
    }
  }

  function goFullscreen() {
    const v = videoRef.current;
    if (!v) return;
    if (typeof v.webkitEnterFullscreen === "function" && !document.fullscreenEnabled) {
      // iPhone Safari: only the video element can go fullscreen
      v.webkitEnterFullscreen();
      return;
    }
    const target = videoBoxRef.current || v;
    if (target.requestFullscreen) target.requestFullscreen().catch(() => {});
  }

  // Where on the screen's picture did that pointer land, as
  // 0..1 of the screen rect? Measured off the splat overlay,
  // which is pinned to the picture in both wall and theater
  // framing — so this is right in either.
  function screenUnitFromEvent(e) {
    const fx = screenFxRef.current;
    const el = fx && fx.style.display !== "none" ? fx : videoBoxRef.current;
    if (!el) return null;
    const b = el.getBoundingClientRect();
    if (!(b.width > 0) || !(b.height > 0)) return null;
    return {
      sx: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)),
      sy: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)),
    };
  }

  // Tap = sound, then theater. Hold = OS fullscreen.
  function feedPointerDown(e) {
    e.stopPropagation();
    // Armed? Then a tap on the live picture is a tomato at the
    // screen, not a sound/theater toggle.
    if (armedRef.current) {
      e.preventDefault();
      setArmed(false);
      const u = screenUnitFromEvent(e);
      if (u) sendThrow({ kind: "screen", sx: u.sx, sy: u.sy });
      return;
    }
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => {
      longPressRef.current = null;
      goFullscreen();
    }, LONG_PRESS_MS);
  }

  function feedPointerUp(e) {
    e.stopPropagation();
    if (!longPressRef.current) return; // the hold already fired
    clearTimeout(longPressRef.current);
    longPressRef.current = null;
    if (!soundOn && !sharing) {
      const v = videoRef.current;
      if (v) {
        v.muted = false;
        playVideo(v, 4);
      }
      setSoundOn(true);
      return;
    }
    setTheater((t) => !t);
  }

  // Pointer left the element mid-hold (a scroll, a drag) —
  // cancel the long-press so it can't fire fullscreen later.
  function feedPointerCancel() {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }

  // Escape leaves theater mode.
  useEffect(() => {
    if (!theater) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setTheater(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [theater]);

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

  // The kicked handoff: tear the connection down WITHOUT a
  // /leave (the row is now the ban record server-side) and let
  // the parent swap in the removed screen.
  const onRemovedRef = useRef(null);
  onRemovedRef.current = onRemoved;
  function handleKicked(payload) {
    const s = sRef.current;
    const conn = s.conn;
    s.conn = null;
    s.moveTarget = null;
    if (s.moveTimer) {
      clearTimeout(s.moveTimer);
      s.moveTimer = null;
    }
    if (conn) conn.detach();
    detachScreen();
    if (onRemovedRef.current) onRemovedRef.current(payload || {});
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
        // The broadcaster left the room: back to standby art
        // now, instead of waiting for the connection to rot.
        const sc = screenRef.current;
        if (sc && sc.viewer && sc.viewer.broadcaster() === id) {
          sc.viewer.teardown();
          attachStream(null);
          setSoundOn(false);
          setTheater(false);
          applyFeed("standby");
        }
        if (sc && sc.broadcaster) sc.broadcaster.dropViewer(id);
        refreshCount();
      },
      onChat: (m) => {
        if (!live() || !m || !m.text) return;
        pushBubble(m.playerId, m.id, m.text);
        appendLog(m);
      },
      // The commissioner deleted a message — drop it from the
      // log and any bubble still floating (milestone 7).
      onChatDelete: (payload) => {
        if (!live() || !payload || !payload.id) return;
        if (payload.playerId) dropBubble(payload.playerId, payload.id);
        setLog((prev) => prev.filter((e) => e.id !== payload.id));
      },
      // Someone threw a tomato (milestone 13). Only the throw
      // route can publish this, and it carries everything a
      // client needs to replay the identical arc.
      onThrow: (ev) => {
        if (!live()) return;
        addThrow(ev, false);
      },
      // The blackjack table changed (milestone 14). Only the
      // blackjack route can publish this, so it is simply the
      // truth: cards, chips and whose turn it is are replaced
      // wholesale, never merged with a local guess.
      onBlackjack: (wire) => {
        if (!live()) return;
        applyTable(wire);
      },
      // Screen-share handshake (milestone 9) — hand every
      // rtc-* event to both peer roles; each ignores what
      // isn't addressed to it.
      onSignal: (event, payload) => {
        if (!live()) return;
        const sc = screenRef.current;
        if (!sc) return;
        try {
          if (sc.broadcaster) {
            Promise.resolve(sc.broadcaster.handleSignal(event, payload)).catch(() => {});
          }
          if (sc.viewer) {
            Promise.resolve(sc.viewer.handleSignal(event, payload)).catch(() => {});
          }
        } catch {
          // a malformed signal must never break the room
        }
      },
      // The commissioner removed US (milestone 7).
      onKicked: (payload) => {
        if (s.destroyed || gen !== s.connGen) return;
        handleKicked(payload);
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
        attachScreen(conn, s.room.id);
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
          !s.walk &&
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
            const dest = s.walk
              ? s.walk.path[s.walk.path.length - 1]
              : s.pos;
            queueMoveSend(dest.x, dest.y);
          }
        }
      } catch (err) {
        if (s.destroyed) return;
        const code = err && err.code;
        if (
          code === "room_full" ||
          code === "name_taken" ||
          code === "bad_name" ||
          code === "kicked"
        ) {
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
      detachScreen();
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
      // Name the room the moment the world becomes it. These
      // used to be the LAST two lines of the try block, after
      // the channel rewiring and the peer replay — so anything
      // that threw in between left the canvas showing the new
      // room while `roomId` still said the old one, and the
      // Share My Screen button (gated on roomId) never
      // appeared in Mission Control. The room you are standing
      // in is decided here, not by how the rest of the hop goes.
      setRoomName(target.name);
      setRoomId(target.id);
      s.grid = getNavGrid(target);
      s.bg = null;
      s.bgKey = "";
      s.peers.clear();
      s.bubbles.clear();
      // Tomatoes belong to the room they were thrown in.
      s.tomatoes = [];
      s.splats = [];
      s.lastThrowAt = 0;
      // The table belongs to the casino floor. Leaving the room
      // does NOT stand you up server-side — the seat is freed by
      // the route the moment it notices you are gone — but the
      // view and the chairs go away with the room.
      s.seatAnchors = new Map();
      s.pendingSeat = null;
      s.pendingArcade = false;
      s.walk = null;
      s.walking = false;
      s.walkT = 0;
      s.pendingExit = null;
      s.marker = null;
      s.lastMoveAt = 0;
      const self = conn.self;
      s.pos = self ? { x: self.x, y: self.y } : { ...entryPoint };
      s.cam = null; // snap, don't pan, into the new room
      s.zoom = roomZoom(target, s.viewW, s.viewH);
      s.conn = conn;
      s.clockOffset = conn.clockOffset;
      // New room, new channel: rewire (or shut down) the board.
      attachScreen(conn, target.id);
      for (const p of conn.players) applyWire(p);
      refreshCount();
      conn.updateSelf(s.pos.x, s.pos.y);
      // the old channel goes away, but our row already moved —
      // detach (no /leave, which would delete the new row)
      if (old) old.detach();
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
      } else if (err && err.code === "kicked") {
        // Banned mid-session: the old room is done too.
        handleKicked({ message: err.message });
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

  // ---- keypad (milestone 8) --------------------------------
  // The right code flips the interact's flag: the vault prop
  // animates open off the trigger time and the flag-gated exit
  // behind it starts answering taps.
  function keypadUnlocked() {
    const s = sRef.current;
    const act = keypad;
    setKeypad(null);
    if (!act) return;
    s.flags[act.flag] = true;
    s.flagTimes[act.flag] = performance.now() / 1000;
    if (act.successToast) {
      setToast({ text: act.successToast, id: performance.now() });
    }
  }

  // ---- casino (milestone 14) -------------------------------

  // One broadcast (or one route reply) becomes the whole view:
  // the felt, the money badge, and which chairs the world view
  // paints avatars in. Nothing is inferred locally.
  function applyTable(wire) {
    const s = sRef.current;
    if (!wire) return;
    setBjTable(wire);
    const anchors = new Map();
    (wire.seats || []).forEach((seat, i) => {
      const cfg = CASINO_TABLE_SEATS[i];
      if (seat && cfg) anchors.set(seat.playerId, cfg.anchor);
    });
    s.seatAnchors = anchors;
    const mine = (wire.seats || []).find((x) => x && x.playerId === s.selfId);
    setBjSeated((was) => {
      if (mine && !was) setBjMin(false); // just sat down: open the table
      return !!mine;
    });
    if (mine) setBjBalance(mine.balance);
    // A finished betting window clears anything you stacked up
    // but never committed.
    if (wire.phase !== "betting") setBjStake(0);
  }

  // Ask the table for something. Errors are not exceptional —
  // a stale button is the normal case — so a refusal repaints
  // from the fresh state the server sent back with it.
  async function bjCall(action, extra) {
    const s = sRef.current;
    if (!s.conn || !s.conn.blackjack) return null;
    if (action !== "sync") setBjBusy(true);
    try {
      const res = await s.conn.blackjack(action, extra);
      if (res && res.table) applyTable(res.table);
      if (res && res.balance !== null && res.balance !== undefined) {
        setBjBalance(res.balance);
      }
      return res;
    } catch (err) {
      if (err && err.data && err.data.table) applyTable(err.data.table);
      if (err && err.data && err.data.balance !== null && err.data.balance !== undefined) {
        setBjBalance(err.data.balance);
      }
      // Rate limits are the client pacing itself, not news.
      if (err && err.code !== "rate_limited" && action !== "sync") {
        setToast({ text: err.message, id: performance.now() });
      }
      return null;
    } finally {
      if (action !== "sync") setBjBusy(false);
    }
  }
  bjCallRef.current = bjCall;
  seatFnRef.current = (seatIndex) => bjCall("sit", { seatIndex });

  // Chips go down locally, then Deal commits them in one go —
  // so building a $55 bet is one request, not three, and the
  // rate limit never gets in the way of a thumb.
  async function bjDeal() {
    if (bjStake < BJ.MIN_BET) return;
    const placed = await bjCall("bet", { amount: bjStake });
    if (placed && placed.ok !== false) await bjCall("ready");
  }

  // ---- tomatoes (milestone 13) -----------------------------

  // One broadcast record (ours or a peer's) becomes one flight.
  // `mine` throws carry a LOCAL timestamp; peers' carry the
  // server's, which we shift onto our clock with the same
  // offset the walk sim uses.
  function addThrow(ev, mine) {
    const s = sRef.current;
    if (!ev || !ev.id) return;
    if (s.tomatoes.some((t) => t.id === ev.id)) return;
    const at = Number(ev.at);
    s.tomatoes.push({
      id: ev.id,
      playerId: ev.playerId,
      kind: ev.kind,
      targetId: ev.targetId || null,
      ox: Number(ev.ox) || 0,
      oy: Number(ev.oy) || 0,
      tx: Number(ev.tx) || 0,
      ty: Number(ev.ty) || 0,
      sx: ev.sx == null ? null : Number(ev.sx),
      sy: ev.sy == null ? null : Number(ev.sy),
      at: (Number.isFinite(at) ? at : Date.now()) - (mine ? 0 : s.clockOffset),
      flightMs: Number(ev.flightMs) || 600,
    });
  }

  // The server said no after we already drew the throw.
  function dropThrow(id) {
    const s = sRef.current;
    s.tomatoes = s.tomatoes.filter((t) => t.id !== id);
    s.splats = s.splats.filter((sp) => sp.id !== id);
  }

  // Impact. Splat art is generated from a hash of the throw id,
  // so every browser draws the same splatter without a byte of
  // geometry crossing the wire.
  //
  // The splat is stamped with the moment it LANDED (origin time +
  // flight), not the moment this tab got around to noticing. A
  // hidden tab has its rAF frozen, so every tomato thrown while
  // you were away lands on the first frame after you come back —
  // stamping Date.now() there gave each of them a fresh 4.6s
  // life and greeted you with a wall of splats from ten minutes
  // ago. Stamped with the real landing time they are already
  // expired, and the prune in the rAF loop drops them the same
  // frame.
  function landSplat(t) {
    const s = sRef.current;
    const seed = seedFromId(t.id);
    const rnd = rngFrom(seed);
    const base = { id: t.id, kind: t.kind, at: t.at + t.flightMs };
    if (t.kind === "screen") {
      s.splats.push({
        ...base,
        sx: t.sx == null ? 0.5 : t.sx,
        sy: t.sy == null ? 0.5 : t.sy,
        art: makeSplatArt(seed, SCREEN_SPLAT_RADIUS),
      });
    } else if (t.kind === "player") {
      // A little scatter across the body so three hits on the
      // same victim don't stack into one blob.
      s.splats.push({
        ...base,
        targetId: t.targetId,
        dx: (rnd() - 0.5) * 44,
        dy: (rnd() - 0.5) * 46,
        art: makeSplatArt(seed, SPLAT_RADIUS * 0.78),
      });
    } else {
      s.splats.push({ ...base, x: t.tx, y: t.ty, art: makeSplatArt(seed, SPLAT_RADIUS) });
    }
    while (s.splats.length > MAX_SPLATS) s.splats.shift();
  }

  // Send a throw. The wire carries a TARGET only; the server
  // owns the origin, the flight and the landing point. We draw
  // our own arc immediately (same deal as our own walk) and
  // ignore the server echo of it — see lib/neighborhood/realtime.
  async function sendThrow(target) {
    const s = sRef.current;
    if (!s.conn) {
      setToast({
        text: "Tomatoes need the live connection — try a refresh.",
        id: performance.now(),
      });
      return;
    }
    const now = Date.now();
    if (now - s.lastThrowAt < THROW_COOLDOWN_MS) {
      setToast({
        text: "One tomato at a time — let that one land.",
        id: performance.now(),
      });
      return;
    }
    s.lastThrowAt = now;

    // Optimistic local flight, computed with the shared module
    // the server uses, so our arc and everyone else's match.
    const localId = `local-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    let tx = s.pos.x;
    let ty = s.pos.y;
    if (target.kind === "spot") {
      tx = target.x;
      ty = target.y;
    } else if (target.kind === "screen") {
      const rect = screenRectFor(s.room.id);
      if (rect) {
        tx = rect.x + target.sx * rect.w;
        ty = rect.y + target.sy * rect.h;
      }
    } else {
      const peer = s.peers.get(target.targetId);
      if (peer) {
        tx = peer.curX;
        ty = peer.curY;
      }
    }
    const localEv = {
      id: localId,
      playerId: s.selfId,
      kind: target.kind,
      targetId: target.targetId || null,
      ox: s.pos.x,
      oy: s.pos.y,
      tx,
      ty,
      sx: target.sx == null ? null : target.sx,
      sy: target.sy == null ? null : target.sy,
      at: now,
      flightMs: flightDurationMs(
        s.pos.x,
        s.pos.y - HAND_LIFT,
        tx,
        target.kind === "player" ? ty - BODY_LIFT : ty
      ),
    };
    addThrow(localEv, true);
    try {
      await s.conn.throwTomato(target);
    } catch (err) {
      dropThrow(localId);
      s.lastThrowAt = 0;
      if (err && err.code === "kicked") {
        handleKicked({ message: err.message, until: err.data && err.data.until });
        return;
      }
      setToast({
        text: (err && err.message) || "That throw didn't land.",
        id: performance.now(),
      });
    }
  }

  // Aim, then fire: work out WHAT the armed tap hit — a screen
  // first (it is mounted on a wall, above everything), then a
  // player, then plain ground.
  function throwAtWorldPoint(wx, wy) {
    const s = sRef.current;
    const rect = screenRectFor(s.room.id);
    if (
      rect &&
      wx >= rect.x &&
      wx <= rect.x + rect.w &&
      wy >= rect.y &&
      wy <= rect.y + rect.h
    ) {
      sendThrow({
        kind: "screen",
        sx: (wx - rect.x) / rect.w,
        sy: (wy - rect.y) / rect.h,
      });
      return;
    }
    const hit = playerHitAt(s, wx, wy);
    if (hit) {
      sendThrow({ kind: "player", targetId: hit.id });
      return;
    }
    sendThrow({
      kind: "spot",
      x: Math.min(Math.max(wx, 0), s.room.width),
      y: Math.min(Math.max(wy, 0), s.room.height),
    });
  }

  // Escape disarms, so an armed player is never stuck.
  useEffect(() => {
    if (!armed) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setArmed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

  // Escape steps away from the arcade cabinet too.
  useEffect(() => {
    if (!arcadeOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setArcadeOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [arcadeOpen]);

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
      // carry the server id onto the bubble too, so a later
      // chat_delete can find it
      if (m && m.id) {
        const list = s.bubbles.get(s.selfId);
        if (list) {
          for (const b of list) if (b.id === localId) b.id = m.id;
        }
      }
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
      s.zoom = roomZoom(s.room, rect.width, rect.height);
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

      // Own avatar: deterministic constant-speed advance from
      // the tap-time origin + timestamp — the SAME math peers
      // and the server run (advanceAlongPath), so a tab that
      // sat hidden (rAF frozen) lands exactly where the server
      // thinks we are the moment it becomes visible again
      // (milestone-7 fix — was incremental dt stepping).
      let moving = false;
      if (s.walk) {
        const elapsed = (Date.now() - s.walk.startedAt) / 1000;
        const adv = advanceAlongPath(
          s.walk.origin.x,
          s.walk.origin.y,
          s.walk.path,
          elapsed
        );
        s.pos.x = adv.x;
        s.pos.y = adv.y;
        s.walkT = elapsed;
        moving = !adv.done;
        if (adv.done) s.walk = null;
      }
      if (!moving && s.pendingExit) {
        // Arrived at a door — step through (or nudge if that
        // room isn't in the registry yet). Deliberately NOT
        // gated on s.walking: a rAF stall (hidden tab, phone
        // jank, screenshot) can swallow the whole wall-clock
        // walk in one frame gap, so the completion frame may
        // be the FIRST frame this walk is ever processed —
        // pendingExit only exists while a door walk is in
        // flight, so firing here is always what the tap meant.
        const exit = s.pendingExit;
        s.pendingExit = null;
        if (exit.roomId && doorFnRef.current) {
          doorFnRef.current(exit);
        } else {
          setToast({ text: `${exit.label} — opening soon!`, id: now });
        }
      }
      // Arrived at a chair (milestone 14) — ask for the seat.
      // Same "fires on the completion frame" reasoning as the
      // door above: pendingSeat only exists while a walk to a
      // chair is in flight.
      if (!moving && s.pendingSeat !== null && s.pendingSeat !== undefined) {
        const seatIndex = s.pendingSeat;
        s.pendingSeat = null;
        if (seatFnRef.current) seatFnRef.current(seatIndex);
      }
      // Arrived at the arcade cabinet (milestone 17) — power it
      // on. pendingArcade only exists while a walk to the
      // machine is in flight, same reasoning as the chair above.
      if (!moving && s.pendingArcade) {
        s.pendingArcade = false;
        if (arcadeFnRef.current) arcadeFnRef.current();
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

      // Tomatoes: land the ones whose flight is up, then let
      // old splats go. Both run off the wall clock, so a tab
      // that was hidden catches up instead of replaying.
      const throwNow = Date.now();
      if (s.tomatoes.length) {
        const stillFlying = [];
        for (const tm of s.tomatoes) {
          if (throwNow - tm.at >= tm.flightMs) landSplat(tm);
          else stillFlying.push(tm);
        }
        s.tomatoes = stillFlying;
      }
      if (s.splats.length) {
        const alive = s.splats.filter((sp) => throwNow - sp.at < SPLAT_LIFE_MS);
        if (alive.length !== s.splats.length) s.splats = alive;
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

      // Big board (milestone 9): the feed is a DOM <video>, so
      // it has to be moved by hand — and it has to happen HERE,
      // right after the draw in the same frame, or the picture
      // lags a frame behind the wall it is bolted to. The room
      // camera is a plain uniform transform, so the whole thing
      // is one translate + one scale (transform only: no
      // layout, no reflow, cheap on a phone).
      const box = videoBoxRef.current;
      if (box) {
        // Whichever screen this room has (both are 16:9 and the
        // same size, so nothing downstream cares which).
        const screen = screenRectFor(s.room.id);
        if (!s.feedOn || !screen || !s.cam) {
          if (box.style.display !== "none") box.style.display = "none";
        } else if (theaterRef.current) {
          box.style.display = "block";
          box.style.width = "100%";
          box.style.height = "100%";
          box.style.transform = "none";
        } else {
          box.style.display = "block";
          box.style.width = `${screen.w}px`;
          box.style.height = `${screen.h}px`;
          const bx = (screen.x - s.cam.x) * s.zoom;
          const by = (screen.y - s.cam.y) * s.zoom;
          box.style.transform = `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${s.zoom.toFixed(4)})`;
        }
      }

      // Tomato splats on a big screen (milestone 13). The feed
      // is a DOM <video>, so a splat painted on the world
      // canvas would sit BEHIND the picture. This overlay
      // canvas is pinned to the exact same rect, one z-layer
      // up, so a tomato lands ON the live video and fades from
      // there. It stays mounted whenever the room has a screen
      // — that way its bounding box is also the honest answer
      // to "where on the screen did that tap land?", in
      // theater mode as well as on the wall.
      const fx = screenFxRef.current;
      if (fx) {
        const screen = screenRectFor(s.room.id);
        if (!screen || !s.cam) {
          if (fx.style.display !== "none") fx.style.display = "none";
        } else {
          if (fx.style.display !== "block") fx.style.display = "block";
          const want = Math.max(1, Math.round(screen.w * s.dpr));
          const wantH = Math.max(1, Math.round(screen.h * s.dpr));
          if (fx.width !== want || fx.height !== wantH) {
            fx.width = want;
            fx.height = wantH;
            s.fxPainted = true; // a resize clears it; force one repaint
          }
          if (theaterRef.current) {
            // Match the letterbox of the object-contain video
            // so a splat stays on the same pixel of picture.
            const ar = screen.w / screen.h;
            let w = s.viewW;
            let h = w / ar;
            if (h > s.viewH) {
              h = s.viewH;
              w = h * ar;
            }
            fx.style.width = `${w}px`;
            fx.style.height = `${h}px`;
            fx.style.transform = `translate(${((s.viewW - w) / 2).toFixed(2)}px, ${((s.viewH - h) / 2).toFixed(2)}px)`;
          } else {
            fx.style.width = `${screen.w}px`;
            fx.style.height = `${screen.h}px`;
            const fxX = (screen.x - s.cam.x) * s.zoom;
            const fxY = (screen.y - s.cam.y) * s.zoom;
            fx.style.transform = `translate(${fxX.toFixed(2)}px, ${fxY.toFixed(2)}px) scale(${s.zoom.toFixed(4)})`;
          }
          // Repaint only while something is on the glass (plus
          // one final clearing frame), so an idle screen costs
          // nothing per frame.
          const wall = [];
          for (const sp of s.splats) if (sp.kind === "screen") wall.push(sp);
          if (wall.length || s.fxPainted) {
            const fctx = fx.getContext("2d");
            fctx.setTransform(1, 0, 0, 1, 0, 0);
            fctx.clearRect(0, 0, fx.width, fx.height);
            fctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
            for (const sp of wall) {
              const age = throwNow - sp.at;
              drawSplat(
                fctx,
                sp.art,
                sp.sx * screen.w,
                sp.sy * screen.h,
                splatAlpha(age),
                splatScale(age)
              );
            }
            s.fxPainted = wall.length > 0;
          }
        }
      }
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
  // iOS zoom-on-focus. Both bars — the world one and the one
  // on the blackjack felt — get the identical treatment; only
  // one of them is ever mounted at a time.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      for (const ref of [chatBarRef, tableChatBarRef]) {
        const bar = ref.current;
        if (!bar) continue;
        bar.style.transform = "none";
        // Lift only while typing IN this bar (keyboard up). On a
        // page that scrolls, the bar can sit below the visual
        // viewport with no keyboard at all — without this guard
        // it would get "lifted" onto the canvas, covering doors.
        if (!bar.contains(document.activeElement)) continue;
        const rect = bar.getBoundingClientRect();
        const keyboardTop = vv.offsetTop + vv.height;
        const overlap = rect.bottom + 8 - keyboardTop;
        if (overlap > 0) bar.style.transform = `translateY(${-overlap}px)`;
      }
    };
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("scroll", apply, true);
    window.addEventListener("focusin", apply);
    window.addEventListener("focusout", apply);
    apply();
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("scroll", apply, true);
      window.removeEventListener("focusin", apply);
      window.removeEventListener("focusout", apply);
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

  // At the table the chat lines age out on their own, so the
  // felt is clean again a minute after the last word.
  useEffect(() => {
    if (!bjSeated || bjMin) return undefined;
    const t = setInterval(() => setClockTick((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, [bjSeated, bjMin]);

  // Walking into the casino: claim the $100 (first visit, or a
  // top-up if you busted out), then keep the table's clock
  // moving. The interval is the ONLY reason a turn timer fires
  // or a dealer draws — see BJ_SYNC_MS.
  useEffect(() => {
    if (!CASINO_ROOMS.includes(roomId)) {
      setBjTable(null);
      setBjBalance(null);
      setBjSeated(false);
      setBjMin(false);
      setBjStake(0);
      sRef.current.seatAnchors = new Map();
      return undefined;
    }
    let stopped = false;
    const beat = async () => {
      if (stopped || !bjCallRef.current) return;
      // Still no balance means the grant has not landed yet
      // (a room hop can race the connection) — ask again. The
      // sync straight after it is what advances any deadline
      // the table was frozen on while the room stood empty.
      if (bjBalanceRef.current === null) {
        const got = await bjCallRef.current("enter");
        if (stopped || !got) return;
      }
      if (!stopped && bjCallRef.current) bjCallRef.current("sync");
    };
    beat();
    const t = setInterval(beat, BJ_SYNC_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [roomId]);

  // The first-person table. Its own canvas and its own loop:
  // the world keeps running underneath (peers still walk, chat
  // still arrives), this just draws on top of it.
  useEffect(() => {
    const open = bjSeated && !bjMin;
    const canvas = bjCanvasRef.current;
    if (!open || !canvas) return undefined;
    let raf = 0;
    const ctx = canvas.getContext("2d");
    const draw = () => {
      const box = canvas.parentElement;
      if (box) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = box.clientWidth;
        const h = box.clientHeight;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
          canvas.style.width = `${w}px`;
          canvas.style.height = `${h}px`;
        }
        drawTableView(ctx, {
          w,
          h,
          dpr,
          theme: themeRef.current,
          table: bjTableRef.current,
          selfId: sRef.current.selfId,
          now: Date.now() + sRef.current.clockOffset,
        });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [bjSeated, bjMin]);

  function handlePointerDown(e) {
    const canvas = canvasRef.current;
    const s = sRef.current;
    if (!canvas || !s.cam) return;
    if (s.switching) return; // mid door-hop — ignore taps
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left) / s.zoom + s.cam.x;
    const wy = (e.clientY - rect.top) / s.zoom + s.cam.y;

    // ARMED (milestone 13): this tap is a throw, and only a
    // throw — no walking, no doors, no keypads. One tap, one
    // tomato, then straight back to normal.
    if (armed) {
      setArmed(false);
      throwAtWorldPoint(wx, wy);
      return;
    }

    // A fresh tap re-aims the walk, so an arcade power-on
    // queued behind the OLD walk must not fire on arrival.
    s.pendingArcade = false;

    // Interactive hotspot? (milestone 8 — the secret chain.)
    // Reveals fire instantly; keypads open the overlay. Each
    // only answers while its flag is still unset — after that
    // the same spot belongs to the exit it revealed.
    const act = (s.room.interact || []).find(
      (a) =>
        !s.flags[a.flag] &&
        wx >= a.hotspot.x &&
        wx <= a.hotspot.x + a.hotspot.w &&
        wy >= a.hotspot.y &&
        wy <= a.hotspot.y + a.hotspot.h
    );
    if (act) {
      if (act.type === "keypad") {
        setKeypad(act);
      } else {
        s.flags[act.flag] = true;
        s.flagTimes[act.flag] = performance.now() / 1000;
        if (act.toast) setToast({ text: act.toast, id: performance.now() });
      }
      return;
    }

    // Arcade cabinet tap? (Milestone 17.) Walk to the machine,
    // then the game mounts on the arrival frame — the same
    // walk-then-act shape as chairs and doors.
    const arcade = s.room.arcade;
    if (
      arcade &&
      wx >= arcade.hotspot.x &&
      wx <= arcade.hotspot.x + arcade.hotspot.w &&
      wy >= arcade.hotspot.y &&
      wy <= arcade.hotspot.y + arcade.hotspot.h
    ) {
      const spot = nearestWalkable(s.room, s.grid, arcade.approach.x, arcade.approach.y);
      if (!spot) return;
      const path = findPath(s.room, s.grid, s.pos.x, s.pos.y, spot.x, spot.y);
      s.pendingExit = null;
      s.pendingSeat = null;
      if (path.length === 0) {
        // already standing at the machine
        setArcadeOpen(true);
        return;
      }
      s.pendingArcade = true;
      s.walk = { origin: { x: s.pos.x, y: s.pos.y }, path, startedAt: Date.now() };
      s.marker = { x: spot.x, y: spot.y, t: performance.now() };
      if (s.conn) queueMoveSend(spot.x, spot.y);
      return;
    }

    // Chair tap? (milestone 14.) Walk to it, then ask the
    // server for the seat on arrival. Whether the seat is free
    // is the SERVER's answer — this check only saves a walk.
    const chair = (s.room.seats || []).find(
      (c) =>
        wx >= c.hotspot.x &&
        wx <= c.hotspot.x + c.hotspot.w &&
        wy >= c.hotspot.y &&
        wy <= c.hotspot.y + c.hotspot.h
    );
    if (chair) {
      if (s.seatAnchors.has(s.selfId)) {
        setBjMin(false); // already sitting — just reopen the table
        return;
      }
      const wire = bjTableRef.current;
      if (wire && (wire.seats || [])[chair.index]) {
        setToast({ text: "That seat's taken.", id: performance.now() });
        return;
      }
      const seatSpot = nearestWalkable(s.room, s.grid, chair.approach.x, chair.approach.y);
      if (!seatSpot) return;
      const seatPath = findPath(s.room, s.grid, s.pos.x, s.pos.y, seatSpot.x, seatSpot.y);
      s.pendingExit = null;
      if (seatPath.length === 0) {
        s.pendingSeat = null;
        if (seatFnRef.current) seatFnRef.current(chair.index);
        return;
      }
      s.pendingSeat = chair.index;
      s.walk = { origin: { x: s.pos.x, y: s.pos.y }, path: seatPath, startedAt: Date.now() };
      s.marker = { x: seatSpot.x, y: seatSpot.y, t: performance.now() };
      if (s.conn) queueMoveSend(seatSpot.x, seatSpot.y);
      return;
    }

    // Door tap? Walk over, then step through on arrival. Flag-
    // gated exits (tunnel, vault doorway) only answer once
    // their reveal has happened.
    const exit = s.room.exits.find(
      (x) =>
        (!x.requiresFlag || s.flags[x.requiresFlag]) &&
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
    s.walk = {
      origin: { x: s.pos.x, y: s.pos.y },
      path,
      startedAt: Date.now(),
    };
    s.marker = { x: spot.x, y: spot.y, t: performance.now() };
    // own walk starts NOW; the server validates the same
    // destination and re-broadcasts for everyone else.
    if (s.conn) queueMoveSend(spot.x, spot.y);
  }

  // Derived once per render: the phase, whether our own bet is
  // already locked in, and which action buttons are legal. The
  // legality answers come from the ENGINE's own helpers, so a
  // button can never offer a move the server would refuse.
  const bjPhase = bjTable ? bjTable.phase : null;
  const bjMineSeat = bjTable
    ? (bjTable.seats || []).find((x) => x && x.playerId === sRef.current.selfId) || null
    : null;
  const bjMineReady = !!(bjMineSeat && bjMineSeat.ready);
  const bjActs = actionsFor(bjTable, sRef.current.selfId, BJ);
  // Sitting down does not leave the room, so the chat you read
  // at the felt is the SAME room chat as the world view: same
  // log, same send path, same rate limit and filter. This is
  // only the last minute of it, echoed onto the empty felt.
  const atTable = bjSeated && !bjMin;
  const tableChat = atTable
    ? log
        .filter((e) => !e.failed && e.at && Date.now() - e.at < TABLE_CHAT_MS)
        .slice(-TABLE_CHAT_LINES)
    : [];

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
          {sharing && (
            <span className="rounded-full border border-red-400 bg-red-600 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white">
              On Air{viewers && viewers.count ? ` · ${viewers.connected}/${viewers.count}` : ""}
            </span>
          )}
          {CASINO_ROOMS.includes(roomId) && bjBalance !== null && (
            <span
              title="Play money. Nothing here is real currency."
              className="rounded-full border border-emerald-500 bg-emerald-600 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white"
            >
              ${bjBalance} chips
            </span>
          )}
          {preview && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              Preview
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setArmed((v) => !v)}
            aria-pressed={armed}
            title={
              armed
                ? "Tap a target to throw — or tap here to cancel"
                : "Arm a tomato, then tap what you want to hit"
            }
            className={`min-h-[44px] rounded-md border px-3 font-display text-xs uppercase tracking-widest transition-colors ${
              armed
                ? "border-red-700 bg-red-600 text-white"
                : "border-red-600 text-red-600 hover:bg-red-600 hover:text-white dark:border-red-500 dark:text-red-400 dark:hover:text-white"
            }`}
          >
            {armed ? "Cancel Aim" : "Tomato"}
          </button>
          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            aria-pressed={chatOpen}
            className={`min-h-[44px] rounded-md border border-espn px-3 font-display text-xs uppercase tracking-widest transition-colors ${
              chatOpen
                ? "bg-espn text-white"
                : "text-espn hover:bg-espn hover:text-white"
            }`}
          >
            {chatOpen ? "Hide Log" : "Chat Log"}
          </button>
          {canBroadcast && roomId === BROADCAST_ROOM_ID && (
            <>
              <button
                type="button"
                onClick={() => setHd((v) => !v)}
                disabled={sharing}
                title="Capture quality for the next share"
                className="min-h-[44px] rounded-md border border-gray-300 px-2.5 font-display text-xs uppercase tracking-widest text-gray-600 transition-colors hover:border-espn hover:text-espn disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
              >
                {hd ? "1080p" : "720p"}
              </button>
              <button
                type="button"
                onClick={toggleShare}
                disabled={shareBusy}
                className={`min-h-[44px] rounded-md border px-3 font-display text-xs uppercase tracking-widest transition-colors disabled:opacity-60 ${
                  sharing
                    ? "border-red-600 bg-red-600 text-white"
                    : "border-espn text-espn hover:bg-espn hover:text-white"
                }`}
              >
                {sharing ? "Stop Sharing" : "Share My Screen"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onEditCharacter}
            className="min-h-[44px] rounded-md border border-espn px-3 font-display text-xs uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white"
          >
            Edit Character
          </button>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700"
        style={{ height: "clamp(420px, calc(100dvh - 262px), 860px)" }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onContextMenu={(e) => e.preventDefault()}
          className={`h-full w-full touch-none select-none ${
            armed ? "cursor-crosshair" : "cursor-pointer"
          }`}
          style={{ WebkitTouchCallout: "none" }}
          aria-label={
            armed
              ? `${roomName} — tap a target to throw a tomato`
              : `${roomName} — tap the ground to walk`
          }
        />
        {/* Big board feed (milestone 9). Every frame the rAF
            loop re-pins this to the current room's screen rect,
            so it rides the camera exactly like painted scenery.
            display/width/height/transform are owned by that
            loop — React only decides what goes INSIDE. */}
        <div
          ref={videoBoxRef}
          onPointerDown={feedPointerDown}
          onPointerUp={feedPointerUp}
          onPointerCancel={feedPointerCancel}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Big screen feed"
          style={{
            display: "none",
            position: "absolute",
            left: 0,
            top: 0,
            transformOrigin: "0 0",
            zIndex: theater ? 15 : 5,
            backgroundColor: theater ? "rgba(6,8,12,0.96)" : "#05070c",
            cursor: armed ? "crosshair" : "pointer",
            touchAction: "none",
            WebkitTouchCallout: "none",
          }}
        >
          <video
            ref={videoRef}
            playsInline
            autoPlay
            disablePictureInPicture
            className={`h-full w-full ${theater ? "object-contain" : "object-cover"}`}
          />
          {feed === "live" && !soundOn && !sharing && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-3">
              <span className="rounded-full bg-black/75 px-4 py-1.5 font-display text-lg uppercase tracking-widest text-white">
                Tap for sound
              </span>
            </div>
          )}
          {theater && (
            <div className="absolute right-2 top-2 flex gap-2">
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={goFullscreen}
                className="min-h-[38px] rounded-md bg-white/15 px-3 font-display text-xs uppercase tracking-widest text-white backdrop-blur hover:bg-white/25"
              >
                Fullscreen
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={() => setTheater(false)}
                className="min-h-[38px] rounded-md bg-white/15 px-3 font-display text-xs uppercase tracking-widest text-white backdrop-blur hover:bg-white/25"
              >
                Close
              </button>
            </div>
          )}
        </div>
        {/* Tomato splats on the big screen (milestone 13).
            Pinned to the same rect as the <video> above, one
            layer up, so a splat lands ON a live feed instead
            of behind it. Never takes a pointer — the box below
            handles taps, armed or not. */}
        <canvas
          ref={screenFxRef}
          aria-hidden="true"
          style={{
            display: "none",
            position: "absolute",
            left: 0,
            top: 0,
            transformOrigin: "0 0",
            pointerEvents: "none",
            zIndex: theater ? 16 : 6,
          }}
        />
        {armed && (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-[11] flex justify-center px-4">
            <p className="rounded-full border-2 border-red-500 bg-red-600/95 px-4 py-2 text-center text-sm font-semibold text-white shadow-lg">
              Tomato armed — tap a player, a screen, or anywhere
            </p>
          </div>
        )}
        {chatOpen && (
          <div
            ref={logRef}
            aria-label="Chat log"
            className={`absolute w-[min(19rem,78%)] space-y-2 overflow-y-auto rounded-xl border border-gray-200 bg-white/95 p-2.5 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-900/95 ${
              atTable
                ? "left-2 top-14 z-40 max-h-[46%]"
                : "right-2 top-2 z-10 max-h-[55%]"
            }`}
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
        {/* Status bar. Toasts ONLY — the room-is-full / door-is-
            stuck / lost-the-feed messages that a player has to
            read. The ambient "tap the ground to walk around"
            coaching that used to live here is gone. */}
        {toast && (
          <div
            aria-live="polite"
            className={`pointer-events-none absolute inset-x-0 z-40 flex justify-center px-4 ${
              atTable ? "bottom-[11rem]" : "bottom-2"
            }`}
          >
            <p className="rounded-full bg-black/70 px-4 py-2 text-center text-sm font-medium text-white">
              {toast.text}
            </p>
          </div>
        )}
        {bjSeated && bjMin && (
          <button
            type="button"
            onClick={() => setBjMin(false)}
            className="absolute left-1/2 top-2 z-30 min-h-[44px] -translate-x-1/2 rounded-full border-2 border-yellow-400 bg-black/85 px-5 font-display text-xs uppercase tracking-widest text-yellow-300"
          >
            Back to the table
          </button>
        )}
        {bjSeated && !bjMin && (
          <div className="absolute inset-0 z-30 flex flex-col bg-[#06110c]">
            <div className="relative min-h-0 flex-1">
              <canvas ref={bjCanvasRef} className="block h-full w-full" aria-label="Blackjack table" />
              <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1">
                <span className="rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white">
                  ${bjBalance === null ? "—" : bjBalance} chips
                </span>
                {bjStake > 0 && (
                  <span className="rounded-full bg-yellow-400 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-black">
                    Betting ${bjStake}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setBjMin(true)}
                className="absolute right-2 top-2 min-h-[44px] rounded-md bg-white/15 px-3 font-display text-xs uppercase tracking-widest text-white backdrop-blur hover:bg-white/25"
              >
                Watch Room
              </button>
              {/* Chat at the table (milestone 15). The felt
                  below the bet box is the one part of this
                  screen the table art never draws on, so the
                  room's chatter goes there: newest at the
                  bottom, older lines dimmer, all of it gone a
                  minute later. It takes no pointer events, and
                  the bet/action buttons are a SEPARATE flex
                  row below this box — chat can never cover
                  them, at any height. */}
              {tableChat.length > 0 && (
                <div
                  aria-live="polite"
                  aria-label="Table chat"
                  className="pointer-events-none absolute inset-x-2 bottom-[3.75rem] flex max-h-[42%] flex-col justify-end gap-1 overflow-hidden"
                >
                  {tableChat.map((entry, i) => (
                    <p
                      key={entry.id}
                      style={{
                        opacity:
                          TABLE_CHAT_FADE[
                            TABLE_CHAT_FADE.length - tableChat.length + i
                          ] || 1,
                        // A 200-character message must not blanket
                        // the felt: two lines here, the rest in the
                        // Chat Log.
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                      className="max-w-[94%] self-start break-words rounded-2xl bg-black/55 px-3 py-1 text-[13px] leading-snug text-white shadow-sm backdrop-blur-sm"
                    >
                      <span
                        className={`font-semibold ${
                          entry.playerId === sRef.current.selfId
                            ? "text-yellow-300"
                            : "text-emerald-200"
                        }`}
                      >
                        {entry.username}
                      </span>{" "}
                      {entry.pending ? (
                        <span className="opacity-70">{entry.text}</span>
                      ) : (
                        entry.text
                      )}
                    </p>
                  ))}
                </div>
              )}
              <form
                ref={tableChatBarRef}
                onSubmit={handleChatSubmit}
                className="absolute inset-x-2 bottom-2 flex items-center gap-2"
              >
                <input
                  type="text"
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  maxLength={CHAT_MAX}
                  placeholder="Say something to the table…"
                  enterKeyHint="send"
                  autoComplete="off"
                  aria-label="Chat message"
                  className="h-11 min-w-0 flex-1 rounded-full border border-white/25 bg-black/55 px-4 text-[16px] text-white shadow-sm outline-none backdrop-blur-sm placeholder:text-white/55 focus:border-yellow-400"
                />
                <button
                  type="submit"
                  disabled={chatBusy}
                  className="h-11 min-w-[64px] rounded-full bg-yellow-400 px-4 font-display text-xs uppercase tracking-widest text-black shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  Send
                </button>
              </form>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/10 bg-black/60 p-2">
              {bjPhase === "betting" && !bjMineReady && (
                <>
                  {CHIP_VALUES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      disabled={bjBusy || bjStake + v > BJ.MAX_BET || (bjBalance !== null && bjStake + v > bjBalance)}
                      onClick={() => setBjStake((n) => Math.min(BJ.MAX_BET, n + v))}
                      className="min-h-[44px] min-w-[56px] rounded-full border-2 border-white/60 bg-white/10 px-3 font-display text-sm font-bold text-white disabled:opacity-35"
                    >
                      +${v}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={bjBusy || bjStake === 0}
                    onClick={() => setBjStake(0)}
                    className="min-h-[44px] rounded-md border border-white/40 px-3 font-display text-xs uppercase tracking-widest text-white disabled:opacity-35"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    disabled={bjBusy || bjStake < BJ.MIN_BET}
                    onClick={bjDeal}
                    className="min-h-[44px] rounded-md bg-yellow-400 px-5 font-display text-sm uppercase tracking-widest text-black disabled:opacity-35"
                  >
                    Deal ${bjStake}
                  </button>
                </>
              )}
              {bjPhase === "playing" && bjActs.stand && (
                <>
                  <button
                    type="button"
                    disabled={bjBusy || !bjActs.hit}
                    onClick={() => bjCall("hit")}
                    className="min-h-[44px] min-w-[84px] rounded-md bg-emerald-500 px-4 font-display text-sm uppercase tracking-widest text-white disabled:opacity-35"
                  >
                    Hit
                  </button>
                  <button
                    type="button"
                    disabled={bjBusy}
                    onClick={() => bjCall("stay")}
                    className="min-h-[44px] min-w-[84px] rounded-md bg-red-600 px-4 font-display text-sm uppercase tracking-widest text-white disabled:opacity-35"
                  >
                    Stand
                  </button>
                  <button
                    type="button"
                    disabled={bjBusy || !bjActs.double}
                    onClick={() => bjCall("double")}
                    className="min-h-[44px] rounded-md bg-blue-600 px-4 font-display text-xs uppercase tracking-widest text-white disabled:opacity-35"
                  >
                    Double
                  </button>
                  <button
                    type="button"
                    disabled={bjBusy || !bjActs.split}
                    onClick={() => bjCall("split")}
                    className="min-h-[44px] rounded-md bg-purple-600 px-4 font-display text-xs uppercase tracking-widest text-white disabled:opacity-35"
                  >
                    Split
                  </button>
                </>
              )}
              {!(bjPhase === "betting" && !bjMineReady) && !(bjPhase === "playing" && bjActs.stand) && (
                <p className="px-2 py-1 text-center text-sm font-medium text-white/80">
                  {statusLine(bjTable, sRef.current.selfId) || "Waiting…"}
                </p>
              )}
              <button
                type="button"
                disabled={bjBusy}
                onClick={() => bjCall("stand")}
                title="Leave the table. A hand already dealt still plays out and still pays."
                className="min-h-[44px] rounded-md border border-white/40 px-3 font-display text-xs uppercase tracking-widest text-white disabled:opacity-35"
              >
                Leave Table
              </button>
            </div>
          </div>
        )}
        {/* The arcade (milestone 17). The Fast Food Place
            cabinet, full-screen: the REAL Deep Threat game —
            same component and leaderboard as the /deep-threat
            page — over the world, blackjack-overlay style
            (absolute inset-0, z-30). The room keeps running
            underneath, heartbeats included, so peers just see
            you standing at the machine. Kept light in both
            themes on purpose: the game is styled for a light
            page, and the glow reads as the cabinet’s own
            light. */}
        {arcadeOpen && (
          <div className="absolute inset-0 z-30 flex flex-col bg-gray-100">
            <div className="flex items-center justify-between gap-2 border-b-2 border-espn bg-white px-3 py-2">
              <p className="font-display text-base font-semibold uppercase tracking-widest text-gray-900">
                Deep Threat
              </p>
              <button
                type="button"
                onClick={() => setArcadeOpen(false)}
                className="min-h-[44px] rounded-md border border-espn bg-white px-3 font-display text-xs uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white"
              >
                ✕ Back to the Restaurant
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-3">
              <div className="mx-auto w-full max-w-3xl">
                <DeepThreatGame names={ARCADE_NAMES} />
              </div>
            </div>
          </div>
        )}
        {keypad && (
          <KeypadOverlay
            act={keypad}
            onSuccess={keypadUnlocked}
            onClose={() => setKeypad(null)}
          />
        )}
      </div>
      {/* World chat bar — its own row BELOW the canvas so it never
          covers floor or door hotspots. Same ref: the visualViewport
          hook still lifts it above a mobile keyboard. */}
      {!atTable && (
        <form
          ref={chatBarRef}
          onSubmit={handleChatSubmit}
          className="mt-2 flex items-center gap-2"
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
      )}
    </div>
  );
}
