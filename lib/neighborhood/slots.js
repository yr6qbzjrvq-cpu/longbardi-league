// ============================================================
// HSPNeighborhood milestone 32 — the slot machines
// ------------------------------------------------------------
// Austin's ask: "Can you make the slot machines actually work?
// $1, $5, $10 per spin. Spin for 4 seconds. 1% chance of grand
// prize. ...Make my head the grand prize if you get three in a
// row."
//
// This is the ONE definition of a slot spin: the symbols, the
// odds, and the paytable. It is a PURE module — no I/O, no
// Date.now(), no randomness of its own. Every entry point takes
// an explicit `rng` (a () => [0,1) function) and returns a
// plain object. That is what makes scripts/test-slots.mjs
// possible, and it is the same discipline blackjack.js and
// horses.js keep: one definition of the rules, imported by both
// the gated route (which decides the outcome) and the client
// (which only animates a spin onto the result the route already
// rolled).
//
// SERVER-AUTHORITATIVE. The client sends an INTENT ("spin $5"),
// never a result. The route calls rollSpin() with a crypto RNG,
// moves the money, and returns the reels. A client cannot force
// a win because it never rolls one — exactly like the blackjack
// shoe and the horse-race winner.
//
// OUTCOME-FIRST. A real reel-strip simulation would make the
// jackpot odds an accident of the strip layout. Instead we roll
// the OUTCOME (jackpot / triple / two-heads / lose) against a
// fixed weight table, then paint reels that read as that
// outcome. This is how the 1% is exactly 1% and the RTP is
// exactly what the table says.
//
// PLAY MONEY ONLY. The stake and the payout move the SAME
// neighborhood_wallets balance the blackjack table and HSPN
// Downs use — one bankroll for the whole casino. `balance` is a
// score; nothing here can be bought, sold or cashed out.
// ============================================================

// ---- the bets ----------------------------------------------
// Exactly three, whole dollars. The route rejects anything not
// in this set, so a hand-crafted "$7 bet" or "$1000 bet" gets a
// 400 and never reaches the reels.
export const BETS = [1, 5, 10];
export const MIN_BET = 1;
export const MAX_BET = 10;

export function isValidBet(amount) {
  return BETS.includes(amount);
}

// ---- the spin length ---------------------------------------
// Austin asked for a 4-second spin. The client animates for
// this long and then reveals exactly the reels the server sent.
export const SPIN_MS = 4000;

// ---- the reel symbols --------------------------------------
// Index 0 is Austin's head — the jackpot symbol, served as an
// <img> (public/neighborhood/slot-head.webp) on the reel and,
// bigger, in the celebration. The other six are drawn as emoji
// glyphs so they need no art.
export const HEAD = 0;

export const SYMBOLS = [
  { id: 0, key: "head", glyph: "🧑", label: "Austin", isHead: true, img: "/neighborhood/slot-head.webp" },
  { id: 1, key: "football", glyph: "🏈", label: "Football", isHead: false },
  { id: 2, key: "trophy", glyph: "🏆", label: "Trophy", isHead: false },
  { id: 3, key: "money", glyph: "💰", label: "Money Bag", isHead: false },
  { id: 4, key: "bell", glyph: "🔔", label: "Bell", isHead: false },
  { id: 5, key: "cherry", glyph: "🍒", label: "Cherry", isHead: false },
  { id: 6, key: "seven", glyph: "7️⃣", label: "Lucky 7", isHead: false },
];

export const SYMBOL_COUNT = SYMBOLS.length;   // 7
export const NON_HEAD = SYMBOLS.filter((s) => !s.isHead).map((s) => s.id); // [1..6]
export const NON_HEAD_COUNT = NON_HEAD.length; // 6
export const REELS = 3;

// ---- the outcome table (the whole game, in four numbers) ---
// Weights are out of 10000 so the jackpot is EXACTLY 100/10000
// = 1.00%, as asked. Multiplier is the TOTAL return on the
// stake (a 50x jackpot on a $10 bet pays $500 and, netting the
// $10 stake, the player is up $490).
//
//   category    chance   pays   contribution to RTP
//   ---------   ------   ----   -------------------
//   jackpot      1.00%    50x    0.500
//   triple       6.00%     5x    0.300
//   two_heads    5.00%     2x    0.100
//   lose        88.00%     0x    0.000
//                                -----
//                          RTP = 0.900  (90%)
//
// 90% RTP: a friendly-but-not-infinite machine. Money is
// play-money and a busted player is refilled to $100 on their
// next casino visit, so the house edge is only there to keep a
// spin feeling like a gamble, not to take anyone's rent.
export const OUTCOMES = [
  { key: "jackpot", weight: 100, mult: 50 },
  { key: "triple", weight: 600, mult: 5 },
  { key: "two_heads", weight: 500, mult: 2 },
  { key: "lose", weight: 8800, mult: 0 },
];

export const WEIGHT_TOTAL = OUTCOMES.reduce((a, o) => a + o.weight, 0); // 10000
export const JACKPOT_MULT = 50;
export const TRIPLE_MULT = 5;
export const TWO_HEAD_MULT = 2;

// The theoretical return-to-player, computed from the table so
// the README and the test can quote one source of truth.
export function rtp() {
  return OUTCOMES.reduce((a, o) => a + (o.weight / WEIGHT_TOTAL) * o.mult, 0);
}

// A tidy paytable for the UI and the README: the dollar prize
// at each bet, for each winning line.
export function payTable() {
  return {
    bets: BETS.slice(),
    rows: [
      { key: "jackpot", label: "3× Austin", grand: true, mult: JACKPOT_MULT, prizes: BETS.map((b) => b * JACKPOT_MULT) },
      { key: "triple", label: "3× any symbol", grand: false, mult: TRIPLE_MULT, prizes: BETS.map((b) => b * TRIPLE_MULT) },
      { key: "two_heads", label: "2× Austin", grand: false, mult: TWO_HEAD_MULT, prizes: BETS.map((b) => b * TWO_HEAD_MULT) },
    ],
  };
}

// The single advertised headline: the biggest prize on the
// machine, at the biggest bet. Drives the marquee and the sign.
export const GRAND_PRIZE_MAX = MAX_BET * JACKPOT_MULT; // $500
export const JACKPOT_CHANCE = OUTCOMES[0].weight / WEIGHT_TOTAL; // 0.01

// ---- rolling a spin ----------------------------------------
// Pick a category against the weight table, then paint three
// reels that READ as that category. Returns:
//   { category, mult, reels: [i,i,i], win: bool, jackpot: bool }
export function rollSpin(rng) {
  const roll = Math.floor(rng() * WEIGHT_TOTAL);
  let acc = 0;
  let cat = OUTCOMES[OUTCOMES.length - 1];
  for (const o of OUTCOMES) {
    acc += o.weight;
    if (roll < acc) {
      cat = o;
      break;
    }
  }
  const reels = reelsFor(cat.key, rng);
  return {
    category: cat.key,
    mult: cat.mult,
    reels,
    win: cat.mult > 0,
    jackpot: cat.key === "jackpot",
  };
}

// Dollars won for a category at a given bet. Whole dollars for
// every legal bet, because every multiplier is an integer.
export function payoutFor(category, bet) {
  const o = OUTCOMES.find((x) => x.key === category);
  return o ? o.mult * bet : 0;
}

// Paint the reels for a category. Deterministic given rng, and
// guaranteed to READ as exactly that category — a LOSE never
// accidentally shows three-of-a-kind or two heads, which would
// look like the server stiffed a winner.
export function reelsFor(category, rng) {
  const randNonHead = () => NON_HEAD[Math.floor(rng() * NON_HEAD_COUNT)];
  if (category === "jackpot") {
    return [HEAD, HEAD, HEAD];
  }
  if (category === "triple") {
    const s = randNonHead();
    return [s, s, s];
  }
  if (category === "two_heads") {
    // Exactly two heads and one non-head. Which reel holds the
    // odd symbol is random so it does not always land in the
    // same place.
    const odd = Math.floor(rng() * REELS);
    const r = [HEAD, HEAD, HEAD];
    r[odd] = randNonHead();
    return r;
  }
  // LOSE: any combination that is NOT a paying line. The only
  // paying lines are three-of-a-kind (head or non-head) and two
  // heads, so we need: at most one head, and not all three
  // equal.
  for (let tries = 0; tries < 64; tries += 1) {
    const r = [
      Math.floor(rng() * SYMBOL_COUNT),
      Math.floor(rng() * SYMBOL_COUNT),
      Math.floor(rng() * SYMBOL_COUNT),
    ];
    const heads = r.filter((x) => x === HEAD).length;
    const allEqual = r[0] === r[1] && r[1] === r[2];
    if (heads <= 1 && !allEqual) return r;
  }
  // Deterministic fallback that always reads as a loss.
  return [NON_HEAD[0], NON_HEAD[1], NON_HEAD[2]];
}

// Classify a set of reels the way the paytable would — used by
// the test to prove the painted reels match the rolled category.
export function classify(reels) {
  const heads = reels.filter((x) => x === HEAD).length;
  const allEqual = reels[0] === reels[1] && reels[1] === reels[2];
  if (heads === 3) return "jackpot";
  if (allEqual) return "triple";
  if (heads === 2) return "two_heads";
  return "lose";
}
