// ============================================================
// HSPNeighborhood — the first-person blackjack view (m14)
// ------------------------------------------------------------
// Procedural canvas, same art rules as the rest of the world:
// flat bright fills, soft darker outlines, thick rounded
// shapes, no image assets. This module DRAWS; it decides
// nothing. Everything it paints comes from the wire state the
// server broadcast (lib/neighborhood/blackjack.js → toWire),
// so two players watching the same hand cannot see different
// cards.
//
// LAYOUT. One fluid virtual space rather than two hard-coded
// ones: the height is fixed at 600 and the width follows the
// real aspect ratio, clamped so a very wide desktop does not
// strand the felt in the middle and a narrow phone does not
// squash it. Every position below is expressed as a fraction
// of VW/VH, so portrait phones and desktops get the same
// drawing code and the same proportions.
//
// You are looking at the table FROM your seat: the dealer is
// across from you at the top, your hand is large at the bottom
// centre no matter which seat you actually took, and the other
// two players sit to your left and right.
// ============================================================

export const VH = 600;
export const MIN_VW = 430;
export const MAX_VW = 980;

export function virtualWidth(w, h) {
  const aspect = h > 0 ? w / h : 1.4;
  return Math.max(MIN_VW, Math.min(MAX_VW, VH * aspect));
}

const SUIT_GLYPH = { S: "♠", H: "♥", D: "♦", C: "♣" };

export const TABLE_LIGHT = {
  bg: "#123a2a",
  bgEdge: "#0b2a1e",
  felt: "#1f7a4d",
  feltDark: "#17603c",
  feltLine: "rgba(247,240,220,0.65)",
  rail: "#7a4a2c",
  railHi: "#a06a3e",
  card: "#fbf7ee",
  cardEdge: "#c9c0ac",
  cardBack: "#c8203c",
  cardBackAlt: "#8e1230",
  red: "#c8203c",
  black: "#22201c",
  text: "#f7f0dc",
  dim: "rgba(247,240,220,0.62)",
  gold: "#f2c81b",
  win: "#3fae5f",
  lose: "#e2543f",
  push: "#f2c81b",
  chipR: "#e2543f",
  chipG: "#3fae5f",
  chipB: "#2a7de1",
  chipK: "#2b2620",
  chipW: "#f7f0dc",
  turn: "#f2c81b",
  panel: "rgba(8,26,18,0.72)",
};

export const TABLE_DARK = {
  ...TABLE_LIGHT,
  bg: "#0a231a",
  bgEdge: "#061711",
  felt: "#186040",
  feltDark: "#114a30",
  rail: "#5f3822",
  railHi: "#7d4c2e",
  card: "#f2ece0",
  panel: "rgba(4,16,11,0.78)",
};

export function tablePalette(theme) {
  return theme === "dark" ? TABLE_DARK : TABLE_LIGHT;
}

// ---- primitives (local copies; this module is standalone) --

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
}

function ell(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.closePath();
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const t = f < 0 ? 0 : 255;
  const p = Math.abs(f);
  r = Math.round(r + (t - r) * p);
  g = Math.round(g + (t - g) * p);
  b = Math.round(b + (t - b) * p);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function paint(ctx, color, lw = 2.5) {
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = shade(color, -0.28);
  ctx.lineWidth = lw;
  ctx.lineJoin = "round";
  ctx.stroke();
}

// ---- cards -------------------------------------------------

export function drawCardBack(ctx, x, y, w, h, P) {
  rr(ctx, x, y, w, h, w * 0.11);
  paint(ctx, P.cardBack, 2);
  rr(ctx, x + w * 0.09, y + h * 0.07, w * 0.82, h * 0.86, w * 0.08);
  ctx.strokeStyle = P.cardBackAlt;
  ctx.lineWidth = Math.max(1.5, w * 0.035);
  ctx.stroke();
  // lattice
  ctx.save();
  rr(ctx, x + w * 0.09, y + h * 0.07, w * 0.82, h * 0.86, w * 0.08);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.20)";
  ctx.lineWidth = 1.4;
  const step = w * 0.22;
  for (let i = -h; i < w + h; i += step) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + h, y + h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + i + h, y);
    ctx.lineTo(x + i, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawCard(ctx, card, x, y, w, h, P) {
  if (!card) return drawCardBack(ctx, x, y, w, h, P);
  const rank = String(card).slice(0, -1);
  const suit = String(card).slice(-1);
  const red = suit === "H" || suit === "D";
  const ink = red ? P.red : P.black;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.30)";
  ctx.shadowBlur = Math.max(3, w * 0.09);
  ctx.shadowOffsetY = Math.max(2, w * 0.05);
  rr(ctx, x, y, w, h, w * 0.11);
  ctx.fillStyle = P.card;
  ctx.fill();
  ctx.restore();
  rr(ctx, x, y, w, h, w * 0.11);
  ctx.strokeStyle = P.cardEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const glyph = SUIT_GLYPH[suit] || "";
  ctx.fillStyle = ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const rs = Math.max(9, w * 0.27);
  ctx.font = `700 ${rs}px Oswald, 'Arial Narrow', sans-serif`;
  ctx.fillText(rank, x + w * 0.09, y + h * 0.05);
  ctx.font = `700 ${rs * 0.82}px system-ui, sans-serif`;
  ctx.fillText(glyph, x + w * 0.09, y + h * 0.05 + rs * 1.02);

  // big centre pip
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${w * 0.62}px system-ui, sans-serif`;
  ctx.globalAlpha = 0.92;
  ctx.fillText(glyph, x + w * 0.56, y + h * 0.6);
  ctx.globalAlpha = 1;

  // mirrored corner
  ctx.save();
  ctx.translate(x + w, y + h);
  ctx.rotate(Math.PI);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${rs}px Oswald, 'Arial Narrow', sans-serif`;
  ctx.fillText(rank, w * 0.09, h * 0.05);
  ctx.restore();
}

// ---- chips -------------------------------------------------

const CHIP_TIERS = [
  { v: 100, key: "chipK" },
  { v: 25, key: "chipG" },
  { v: 5, key: "chipR" },
];

export function chipStackFor(amount) {
  let left = Math.max(0, Math.round(amount));
  const out = [];
  for (const tier of CHIP_TIERS) {
    while (left >= tier.v && out.length < 14) {
      out.push(tier.key);
      left -= tier.v;
    }
  }
  return out;
}

export function drawChipStack(ctx, x, y, amount, P, r = 15) {
  const stack = chipStackFor(amount);
  if (stack.length === 0) return;
  const lift = r * 0.26;
  for (let i = 0; i < stack.length; i += 1) {
    const cy = y - i * lift;
    ell(ctx, x, cy, r, r * 0.42);
    paint(ctx, P[stack[i]] || P.chipR, 1.6);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(x, cy, r * 0.62, r * 0.26, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function drawChip(ctx, x, y, r, color, label, P) {
  circle(ctx, x, y, r);
  paint(ctx, color, 2);
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.setLineDash([r * 0.5, r * 0.42]);
  circle(ctx, x, y, r * 0.78);
  ctx.stroke();
  ctx.restore();
  circle(ctx, x, y, r * 0.56);
  ctx.fillStyle = "rgba(255,255,255,0.90)";
  ctx.fill();
  ctx.fillStyle = P.black;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${r * 0.66}px Oswald, 'Arial Narrow', sans-serif`;
  ctx.fillText(label, x, y + 1);
}

// ---- hand + seat blocks ------------------------------------

function handTotalLabel(hand) {
  if (!hand) return "";
  if (hand.blackjack) return "BLACKJACK";
  const v = hand.value || { total: 0, soft: false };
  if (hand.busted) return `BUST ${v.total}`;
  if (v.soft && v.total !== 21) return `${v.total - 10}/${v.total}`;
  return String(v.total);
}

function outcomeColor(outcome, P) {
  if (outcome === "win" || outcome === "blackjack") return P.win;
  if (outcome === "push") return P.push;
  if (outcome === "bust" || outcome === "lose") return P.lose;
  return null;
}

function drawHand(ctx, hand, cx, y, cw, P, opts) {
  const o = opts || {};
  const cards = hand.cards || [];
  const overlap = cw * 0.42;
  const ch = cw * 1.42;
  const totalW = cards.length > 0 ? cw + overlap * (cards.length - 1) : cw;
  let x = cx - totalW / 2;

  if (o.active) {
    // a soft gold pool under the hand whose turn it is
    ctx.save();
    ell(ctx, cx, y + ch * 0.5, totalW * 0.72, ch * 0.62);
    ctx.fillStyle = "rgba(242,200,27,0.16)";
    ctx.fill();
    ctx.restore();
  }

  for (let i = 0; i < cards.length; i += 1) {
    drawCard(ctx, cards[i], x, y, cw, ch, P);
    x += overlap;
  }
  if (cards.length === 0) {
    rr(ctx, cx - cw / 2, y, cw, ch, cw * 0.11);
    ctx.strokeStyle = P.dim;
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // total badge
  if (cards.length > 0) {
    const label = handTotalLabel(hand);
    const oc = outcomeColor(hand.outcome, P);
    ctx.font = `700 ${Math.max(11, cw * 0.28)}px Oswald, 'Arial Narrow', sans-serif`;
    const tw = ctx.measureText(label).width + cw * 0.28;
    const bh = Math.max(18, cw * 0.36);
    const bx = cx - tw / 2;
    const by = y + ch + cw * 0.1;
    rr(ctx, bx, by, tw, bh, bh / 2);
    paint(ctx, oc || (hand.busted ? P.lose : P.panel), 1.5);
    ctx.fillStyle = oc || hand.busted ? "#ffffff" : P.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, by + bh / 2 + 0.5);
    if (hand.doubled) {
      ctx.font = `700 ${Math.max(9, cw * 0.2)}px Oswald, 'Arial Narrow', sans-serif`;
      ctx.fillStyle = P.gold;
      ctx.fillText("DOUBLED", cx, by + bh + cw * 0.2);
    }
  }
  return ch;
}

// ---- the whole view ----------------------------------------
//
// draw(ctx, {
//   w, h, dpr, theme, table (wire), selfId, now
// })

export function drawTableView(ctx, opts) {
  const { w, h, dpr = 1, theme = "light", table, selfId, now = Date.now() } = opts;
  const P = tablePalette(theme);
  const VW = virtualWidth(w, h);
  const scale = Math.min(w / VW, h / VH);
  const ox = (w - VW * scale) / 2;
  const oy = (h - VH * scale) / 2;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = P.bgEdge;
  ctx.fillRect(0, 0, w * dpr, h * dpr);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);

  // ---- the room behind the table -------------------------
  const bg = ctx.createLinearGradient(0, 0, 0, VH);
  bg.addColorStop(0, P.bgEdge);
  bg.addColorStop(0.55, P.bg);
  bg.addColorStop(1, P.bgEdge);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VW, VH);

  // ---- the felt, seen from your chair --------------------
  // A big ellipse whose near edge runs off the bottom of the
  // view: that is what makes it read as "you are sitting here"
  // rather than "here is a table".
  const cxm = VW / 2;
  ell(ctx, cxm, VH * 0.98, VW * 0.86, VH * 0.72);
  paint(ctx, P.rail, 4);
  ell(ctx, cxm, VH * 1.0, VW * 0.80, VH * 0.67);
  paint(ctx, P.railHi, 2.5);
  ell(ctx, cxm, VH * 1.02, VW * 0.74, VH * 0.63);
  paint(ctx, P.felt, 3);

  // dealer's arc + the rules, printed on the felt
  ctx.save();
  ctx.strokeStyle = P.feltLine;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.ellipse(cxm, VH * 0.42, VW * 0.40, VH * 0.20, 0, Math.PI * 0.05, Math.PI * 0.95);
  ctx.stroke();
  ctx.globalAlpha = 0.75;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.feltLine;
  ctx.font = "700 15px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillText("BLACKJACK PAYS 3 TO 2", cxm, VH * 0.455);
  ctx.font = "700 11px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillText("DEALER STANDS ON ALL 17s  ·  NO INSURANCE", cxm, VH * 0.485);
  ctx.restore();

  if (!table) {
    ctx.fillStyle = P.text;
    ctx.textAlign = "center";
    ctx.font = "700 20px Oswald, 'Arial Narrow', sans-serif";
    ctx.fillText("Waiting for the table…", cxm, VH * 0.2);
    return;
  }

  // ---- the dealer ----------------------------------------
  const dealerCw = Math.max(38, VW * 0.072);
  const dealer = table.dealer || { cards: [], hole: false };
  const dCards = [...(dealer.cards || [])];
  const dealerY = VH * 0.10;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = P.dim;
  ctx.font = "700 13px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillText("DEALER", cxm, VH * 0.045);

  {
    const n = dCards.length + (dealer.hole ? 1 : 0);
    const overlap = dealerCw * 0.44;
    const totalW = n > 0 ? dealerCw + overlap * (n - 1) : dealerCw;
    let x = cxm - totalW / 2;
    for (const c of dCards) {
      drawCard(ctx, c, x, dealerY, dealerCw, dealerCw * 1.42, P);
      x += overlap;
    }
    if (dealer.hole) {
      drawCardBack(ctx, x, dealerY, dealerCw, dealerCw * 1.42, P);
    }
    if (n > 0 && !dealer.hole) {
      const v = dealer.value || { total: 0 };
      const label = v.total > 21 ? `BUST ${v.total}` : String(v.total);
      ctx.font = "700 15px Oswald, 'Arial Narrow', sans-serif";
      const tw = ctx.measureText(label).width + 20;
      const by = dealerY + dealerCw * 1.42 + 6;
      rr(ctx, cxm - tw / 2, by, tw, 22, 11);
      paint(ctx, v.total > 21 ? P.lose : P.panel, 1.5);
      ctx.fillStyle = P.text;
      ctx.fillText(label, cxm, by + 12);
    }
  }

  // ---- seats ----------------------------------------------
  // Your seat is always the one at the bottom centre. The
  // other two go left and right, in table order.
  const seats = table.seats || [];
  const selfIndex = seats.findIndex((s) => s && s.playerId === selfId);
  const order = [];
  for (let i = 0; i < seats.length; i += 1) order.push(i);
  const others = order.filter((i) => i !== selfIndex);

  const slots = [
    { i: others[0], cx: VW * 0.135, cy: VH * 0.50, cw: Math.max(26, VW * 0.048), small: true },
    { i: others[1], cx: VW * 0.865, cy: VH * 0.50, cw: Math.max(26, VW * 0.048), small: true },
    { i: selfIndex, cx: cxm, cy: VH * 0.60, cw: Math.max(46, VW * 0.098), small: false },
  ];

  for (const slot of slots) {
    if (slot.i === undefined || slot.i < 0) continue;
    const seat = seats[slot.i];
    const isSelf = slot.i === selfIndex;
    if (!seat) {
      if (!isSelf) {
        ctx.fillStyle = P.dim;
        ctx.font = "700 11px Oswald, 'Arial Narrow', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`SEAT ${slot.i + 1}`, slot.cx, slot.cy);
        ctx.fillText("OPEN", slot.cx, slot.cy + 14);
      }
      continue;
    }

    const isTurn = !!table.turn && table.turn.seat === slot.i;
    const hands = seat.hands || [];
    // Split hands sit side by side inside the slot.
    const n = Math.max(1, hands.length);
    const spread = slot.cw * (slot.small ? 1.5 : 1.9);
    const startX = slot.cx - (spread * (n - 1)) / 2;

    for (let hi = 0; hi < n; hi += 1) {
      const hand = hands[hi] || { cards: [], value: { total: 0 } };
      const hx = startX + hi * spread;
      const active = isTurn && table.turn.hand === hi;
      drawHand(ctx, hand, hx, slot.cy, slot.cw, P, { active });
      if (hand.bet) {
        drawChipStack(ctx, hx, slot.cy + slot.cw * 1.42 + (slot.small ? 44 : 62), hand.bet, P, slot.small ? 9 : 14);
      }
    }

    // name plate
    const plateY = slot.cy - slot.cw * (slot.small ? 0.55 : 0.62);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${slot.small ? 12 : 15}px Oswald, 'Arial Narrow', sans-serif`;
    const name = isSelf ? "YOU" : String(seat.username || "").toUpperCase();
    const nw = ctx.measureText(name).width + 18;
    rr(ctx, slot.cx - nw / 2, plateY - 11, nw, 22, 11);
    paint(ctx, isTurn ? P.turn : P.panel, 1.5);
    ctx.fillStyle = isTurn ? P.black : P.text;
    ctx.fillText(name, slot.cx, plateY);

    // balance + bet line
    ctx.font = `700 ${slot.small ? 10 : 12}px Oswald, 'Arial Narrow', sans-serif`;
    ctx.fillStyle = P.dim;
    const money = seat.bet ? `$${seat.balance} · BET $${seat.bet}` : `$${seat.balance}`;
    ctx.fillText(money, slot.cx, plateY + 18);

    if (seat.leaving) {
      ctx.fillStyle = P.lose;
      ctx.fillText("LEAVING", slot.cx, plateY + 32);
    } else if (table.phase === "betting" && seat.ready) {
      ctx.fillStyle = P.win;
      ctx.fillText("READY", slot.cx, plateY + 32);
    }

    // result badge after a hand
    if (table.phase === "payout" && seat.result) {
      const label =
        seat.net > 0 ? `+$${seat.net}` : seat.net < 0 ? `-$${Math.abs(seat.net)}` : "PUSH";
      ctx.font = `700 ${slot.small ? 14 : 20}px Oswald, 'Arial Narrow', sans-serif`;
      const bw = ctx.measureText(label).width + 24;
      const by = slot.cy + slot.cw * 1.42 + (slot.small ? 62 : 86);
      rr(ctx, slot.cx - bw / 2, by - 14, bw, 28, 14);
      paint(ctx, outcomeColor(seat.result, P) || P.panel, 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, slot.cx, by);
    }
  }

  // ---- status strip --------------------------------------
  const msg = statusLine(table, selfId);
  if (msg) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 16px Oswald, 'Arial Narrow', sans-serif";
    const tw = ctx.measureText(msg).width + 34;
    rr(ctx, cxm - tw / 2, VH * 0.30 - 16, tw, 32, 16);
    paint(ctx, P.panel, 1.5);
    ctx.fillStyle = P.text;
    ctx.fillText(msg, cxm, VH * 0.30);
  }

  // ---- the clock -----------------------------------------
  if (table.deadline && table.phase !== "idle" && table.phase !== "payout") {
    const total =
      table.phase === "betting" ? 20_000 : table.phase === "playing" ? 25_000 : 1_000;
    const left = Math.max(0, table.deadline - now);
    const frac = Math.max(0, Math.min(1, left / total));
    if (frac > 0 && (table.phase === "betting" || table.phase === "playing")) {
      const barW = VW * 0.34;
      const bx = cxm - barW / 2;
      const by = VH * 0.345;
      rr(ctx, bx, by, barW, 8, 4);
      ctx.fillStyle = "rgba(0,0,0,0.38)";
      ctx.fill();
      rr(ctx, bx, by, barW * frac, 8, 4);
      ctx.fillStyle = frac < 0.3 ? P.lose : P.gold;
      ctx.fill();
      ctx.fillStyle = P.dim;
      ctx.font = "700 11px Oswald, 'Arial Narrow', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${Math.ceil(left / 1000)}s`, cxm, by + 22);
    }
  }

  // shoe count, bottom right — a nod to the six-deck shoe
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.font = "700 10px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillStyle = P.dim;
  ctx.fillText(
    `${table.shuffled ? "FRESH SHOE · " : ""}${table.cardsLeft} CARDS`,
    VW - 12,
    VH - 8
  );
}

export function statusLine(table, selfId) {
  if (!table) return "";
  const seats = table.seats || [];
  const mine = seats.findIndex((s) => s && s.playerId === selfId);
  switch (table.phase) {
    case "idle":
      return "Table's open — place a bet to start a hand";
    case "betting": {
      const me = mine >= 0 ? seats[mine] : null;
      if (me && me.ready) return "Waiting on the other players…";
      return "Place your bet";
    }
    case "dealing":
      return "Dealing…";
    case "playing": {
      if (!table.turn) return "";
      const seat = seats[table.turn.seat];
      if (!seat) return "";
      if (seat.playerId === selfId) {
        const hands = seat.hands || [];
        return hands.length > 1 ? `Your move — hand ${table.turn.hand + 1}` : "Your move";
      }
      return `${seat.username}'s move…`;
    }
    case "dealer":
      return "Dealer plays";
    case "payout":
      return "Paying out…";
    default:
      return "";
  }
}

// Which buttons a seated player should be offered right now.
// Pure, and it reuses the ENGINE's legality helpers rather than
// re-deciding anything — the server checks the same ones again
// before it moves a card, so a mis-drawn button can only ever
// bounce.
export function actionsFor(table, selfId, engine) {
  const out = { hit: false, stand: false, double: false, split: false };
  if (!table || table.phase !== "playing" || !table.turn) return out;
  const seat = (table.seats || [])[table.turn.seat];
  if (!seat || seat.playerId !== selfId) return out;
  const hand = (seat.hands || [])[table.turn.hand];
  if (!hand) return out;
  out.hit = engine.canHit(hand);
  out.stand = !hand.done && !hand.busted;
  out.double = engine.canDouble(hand, seat.balance);
  out.split = engine.canSplit(table, seat, hand);
  return out;
}
