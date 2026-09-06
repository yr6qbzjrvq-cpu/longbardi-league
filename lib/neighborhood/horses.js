// ============================================================
// HSPNeighborhood — HSPN Downs, the horse race (milestone 24)
// ------------------------------------------------------------
// A pure module, exactly like lib/neighborhood/blackjack.js and
// for the same reason: the API route and the browser import the
// SAME file, so the race the server settled and the race you
// watched cannot be two different races. No I/O, no Date.now(),
// no randomness of its own — every entry point takes the state
// plus an explicit `now` (and, where a new race is minted, an
// explicit rng) and returns a new state.
//
// HOW A RACE IS DECIDED. The winner is drawn UNIFORMLY at
// random from the four horses by the server, at the moment the
// betting window OPENS — before anybody has put a chip down.
// That ordering is the fairness argument: the result cannot
// depend on who bet what, because it already existed. It is
// also why toWire() strips `winner` and `seed` while the
// window is open (the blackjack hole-card rule, applied to a
// racetrack) and hands them over the instant the gate does.
//
// HOW A RACE IS ANIMATED. The gallop is client THEATRE built
// from (seed, winner) — but it is deterministic theatre. Four
// speed profiles are generated from the seed, each a
// piecewise-linear curve of surges and fades, and the profile
// that reaches the wire first is SWAPPED into the winner's
// lane. So the drama (lead changes, a closer coming from last,
// a photo finish) is genuinely random, while first place is
// whatever the server already decided.
//
// WHY THERE IS NO Math.sin IN HERE. Every viewer must compute
// bit-identical positions or two people would watch different
// races. +, -, *, / and Math.floor are correctly rounded by
// the ECMAScript spec on every engine; Math.sin, Math.pow and
// friends are NOT (implementations may differ in the last
// bits). So the speed curves are built out of arithmetic and
// linear interpolation only, and the seeded RNG is integer
// math. That is the whole reason this file looks the way it
// does.
//
// PLAY MONEY. Same wallet as the blackjack table
// (neighborhood_wallets); `balance` is a score. Nothing here
// can be bought, sold, deposited or withdrawn.
// ============================================================

// ---- the field ---------------------------------------------
// Four horses, fixed, in lane order. Names are league
// furniture: the waiver wire, the casino marquee's own boast,
// the arcade cabinet in the Fast Food Place, and the painting
// on the wall three feet from where you are standing.
export const HORSES = [
  { id: 0, name: "Waiver Wire", short: "WAIVER", color: "#c8203c", silk: "#f7f0dc", note: "claims late, runs early" },
  { id: 1, name: "Loose Slots", short: "SLOTS", color: "#f2c81b", silk: "#2b2620", note: "pays out eventually" },
  { id: 2, name: "Deep Threat", short: "THREAT", color: "#3fae5f", silk: "#101a14", note: "all go, no route tree" },
  { id: 3, name: "Three Wolf Moon", short: "WOLVES", color: "#7b5cff", silk: "#ffe9a8", note: "howls at the wire" },
];

export const HORSE_COUNT = HORSES.length;

// ---- the clock ---------------------------------------------
// One shared cadence for the whole room. 55 seconds a lap.
export const BET_MS = 30_000;
export const RACE_MS = 18_000;
export const RESULT_MS = 7_000;
export const CYCLE_MS = BET_MS + RACE_MS + RESULT_MS;

// ---- the money ---------------------------------------------
// PAYOUT_MULT is a TOTAL RETURN, not a profit multiple: back a
// winner with $10 and $40 lands in your wallet (your $10 came
// out of it when you bet). Net +$30 on a win, -$10 on a loss.
// With four equally likely horses that is a zero-edge book —
// the house neither takes a cut nor tops anybody up here. See
// README-neighborhood.md, "Paying 4 to 1".
export const PAYOUT_MULT = 4;
export const MIN_BET = 5;
export const MAX_BET = 100;
export const CHIPS = [5, 25, 100];

// ---- the simulation ----------------------------------------
const SAMPLES = 192; // speed samples across RACE_MS
const CONTROL = 8; // control points per speed curve
const FINISH_AT = 0.9; // wire sits at 90% of the slowest horse's run
const RUNOUT = 1.4; // hard ceiling on how far past the wire we track

// mulberry32. Integer ops and one exact division, so every
// engine produces the identical stream from the identical seed.
export function rngFromSeed(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One horse's speed curve: CONTROL control points, linearly
// interpolated between. Three things are drawn per lane:
//
//   base   how good the horse is. Kept to a narrow band, so
//          the field finishes together and the wire is worth
//          watching.
//   style  running style, from a front-runner (+1: fast early,
//          empty late) to a closer (-1: sits in last and eats
//          them up in the stretch). The tilt is symmetric
//          about halfway, so it moves a horse around the pack
//          WITHOUT deciding the race.
//   noise  per-segment surges and fades. This is where a
//          two-length lead appears out of nowhere and then
//          evaporates.
//
// The last control point gets an extra kick-or-fade on top, so
// the stretch run is the least predictable part of the race —
// which is the point.
function speedCurve(rnd) {
  const base = 0.95 + rnd() * 0.1;
  const style = rnd() * 2 - 1;
  const k = new Array(CONTROL);
  for (let i = 0; i < CONTROL; i += 1) {
    const f = i / (CONTROL - 1);
    const wild = i === 0 ? 0.1 : 0.34;
    const noise = 1 - wild + rnd() * wild * 2;
    const tilt = 1 + style * (0.5 - f) * 0.86;
    k[i] = base * noise * tilt;
  }
  k[CONTROL - 1] = k[CONTROL - 1] * (0.78 + rnd() * 0.5);
  return k;
}

function speedAt(k, u) {
  const f = u * (CONTROL - 1);
  let i = Math.floor(f);
  if (i < 0) i = 0;
  if (i > CONTROL - 2) i = CONTROL - 2;
  const w = f - i;
  return k[i] + (k[i + 1] - k[i]) * w;
}

// Cumulative distance at every sample, so drawing a frame is an
// array lookup and a lerp rather than a re-integration.
function integrate(k) {
  const d = new Array(SAMPLES + 1);
  d[0] = 0;
  for (let s = 0; s < SAMPLES; s += 1) {
    d[s + 1] = d[s] + speedAt(k, (s + 0.5) / SAMPLES) / SAMPLES;
  }
  return d;
}

// Where (in fractional sample units) this lane crosses `D`.
// SAMPLES + 1 means "did not get there inside the window",
// which FINISH_AT makes impossible for every lane but is worth
// not crashing on.
function crossingAt(d, D) {
  for (let s = 1; s <= SAMPLES; s += 1) {
    if (d[s] >= D) {
      const span = d[s] - d[s - 1];
      const w = span > 0 ? (D - d[s - 1]) / span : 0;
      return s - 1 + w;
    }
  }
  return SAMPLES + 1;
}

// Build the whole race. Deterministic in (seed, winner) — this
// is the function that makes "everyone watches the same race"
// true, and it is called by the browser to draw and by the
// route to work out the placings.
export function buildRace(seed, winner) {
  const rnd = rngFromSeed(seed);
  const curves = [];
  for (let i = 0; i < HORSE_COUNT; i += 1) curves.push(speedCurve(rnd));
  const dists = curves.map(integrate);

  // The wire: 90% of the shortest total, so every horse is home
  // inside RACE_MS and there is a run-out past the post.
  let shortest = dists[0][SAMPLES];
  for (let i = 1; i < HORSE_COUNT; i += 1) {
    if (dists[i][SAMPLES] < shortest) shortest = dists[i][SAMPLES];
  }
  const D = shortest * FINISH_AT;

  let finish = dists.map((d) => crossingAt(d, D));

  // The swap. The fastest profile belongs to the horse the
  // server already picked; everything else about the race —
  // who led at halfway, who faded, how close it was — is left
  // exactly as the seed drew it.
  let fastest = 0;
  for (let i = 1; i < HORSE_COUNT; i += 1) if (finish[i] < finish[fastest]) fastest = i;
  const w = Math.min(Math.max(winner | 0, 0), HORSE_COUNT - 1);
  if (fastest !== w) {
    const td = dists[fastest];
    dists[fastest] = dists[w];
    dists[w] = td;
    const tf = finish[fastest];
    finish[fastest] = finish[w];
    finish[w] = tf;
  }

  // Dead heats are the one thing the wire cannot show. If the
  // seed produced two identical crossings, lean on the winner
  // by a hair so the picture agrees with the result.
  for (let guard = 0; guard < 12; guard += 1) {
    let tied = false;
    for (let i = 0; i < HORSE_COUNT; i += 1) {
      if (i !== w && finish[i] <= finish[w]) tied = true;
    }
    if (!tied) break;
    const d = dists[w];
    for (let s = 0; s <= SAMPLES; s += 1) d[s] = d[s] * 1.0009;
    finish[w] = crossingAt(d, D);
  }

  const order = [0, 1, 2, 3].sort((a, b) => finish[a] - finish[b]);
  return { seed, winner: w, dists, D, finish, order };
}

// Every horse's progress at `u` (0 = gate, 1 = the whole race
// window elapsed). 1.0 is the wire; anything above that is the
// run-out past the post.
//
// PAST THE WIRE THEY ALL PULL UP AT THE SAME RATE, deliberately.
// Left to their own speed curves a closer that finished second
// would keep accelerating and sail past the winner ten strides
// after the line, which looks exactly like the wrong horse won.
// Beyond its own crossing every horse coasts at RUNOUT_RATE, so
// the picture after the post is frozen in FINISHING order.
const RUNOUT_RATE = 0.75;

export function progressAt(race, u) {
  const clamped = u < 0 ? 0 : u > 1 ? 1 : u;
  const f = clamped * SAMPLES;
  let s = Math.floor(f);
  if (s > SAMPLES - 1) s = SAMPLES - 1;
  const w = f - s;
  const out = new Array(HORSE_COUNT);
  for (let i = 0; i < HORSE_COUNT; i += 1) {
    const fu = race.finish[i] / SAMPLES;
    if (clamped > fu) {
      const v = 1 + (clamped - fu) * RUNOUT_RATE;
      out[i] = v > RUNOUT ? RUNOUT : v;
      continue;
    }
    const d = race.dists[i];
    out[i] = (d[s] + (d[s + 1] - d[s]) * w) / race.D;
  }
  return out;
}

// The instant the winner hits the wire, as a fraction of the
// race window. The results phase holds this frame: it is the
// photo.
export function photoAt(race) {
  return race.finish[race.winner] / SAMPLES;
}

// How hard a horse is running right now, as a multiple of its
// own average. Drives the gallop cadence and the little "surge"
// dust puffs, nothing else.
export function effortAt(race, u, i) {
  const clamped = u < 0 ? 0 : u > 1 ? 1 : u;
  const f = clamped * SAMPLES;
  let s = Math.floor(f);
  if (s > SAMPLES - 2) s = SAMPLES - 2;
  const d = race.dists[i];
  const inst = (d[s + 2] - d[s]) / 2;
  const avg = d[SAMPLES] / SAMPLES;
  return avg > 0 ? inst / avg : 1;
}

// Placings at the wire: [winnerIndex, second, third, fourth].
export function finishOrder(seed, winner) {
  return buildRace(seed, winner).order;
}

// ---- state --------------------------------------------------

function seed32(rng) {
  // rng() is a float in [0,1); this is the same shape the
  // blackjack shoe uses to turn one into a 32-bit integer.
  return Math.floor(rng() * 4294967296) >>> 0;
}

function pickWinner(rng) {
  const i = Math.floor(rng() * HORSE_COUNT);
  return i >= HORSE_COUNT ? HORSE_COUNT - 1 : i;
}

// A fresh betting window. The seed and the winner are minted
// HERE — before a single chip is down.
function openBetting(prev, at, rng) {
  return {
    raceId: (prev && prev.raceId ? prev.raceId : 0) + 1,
    phase: "betting",
    seed: seed32(rng),
    winner: pickWinner(rng),
    startedAt: at,
    deadline: at + BET_MS,
    bets: {},
    last: prev && prev.last ? prev.last : null,
  };
}

export function emptyState(rng, now) {
  return openBetting(null, now, rng);
}

export function betOf(state, playerId) {
  const b = state && state.bets ? state.bets[playerId] : null;
  return b || null;
}

export function potOf(state) {
  let n = 0;
  for (const k of Object.keys((state && state.bets) || {})) n += state.bets[k].amount;
  return n;
}

// Settle the race that just ran. Returns the results record
// plus the wallet CREDITS the route owes the winners (losers
// were debited when they bet, so a loss costs nothing here).
function settle(state) {
  const order = finishOrder(state.seed, state.winner);
  const results = [];
  const credits = [];
  const ids = Object.keys(state.bets || {}).sort();
  for (const id of ids) {
    const b = state.bets[id];
    const won = b.horse === state.winner;
    const payout = won ? b.amount * PAYOUT_MULT : 0;
    results.push({
      playerId: id,
      username: b.username,
      horse: b.horse,
      amount: b.amount,
      payout,
      won,
    });
    if (payout > 0) credits.push({ playerId: id, amount: payout });
  }
  return {
    last: {
      raceId: state.raceId,
      winner: state.winner,
      order,
      results,
      at: state.deadline,
    },
    credits,
  };
}

// The clock, pulled not pushed — identical to the blackjack
// table and for the identical reason (Vercel functions do not
// run between requests). tick() is idempotent and
// deadline-driven: it does not matter who calls it or how
// often, and the row's version guard means only one writer
// wins.
//
// A room that stood empty for ten minutes does not replay ten
// minutes of racing: the loop is capped, and anything still
// behind after that is simply a fresh betting window opened at
// `now`. The FIRST pass through the loop is the one that
// matters — it settles the race real people had money on.
const MAX_CATCHUP = 6;

export function tick(state, now, rng) {
  let s = state;
  let changed = false;
  const credits = [];
  for (let i = 0; i < MAX_CATCHUP; i += 1) {
    if (now < s.deadline) break;
    if (s.phase === "betting") {
      s = { ...s, phase: "running", startedAt: s.deadline, deadline: s.deadline + RACE_MS };
    } else if (s.phase === "running") {
      const done = settle(s);
      for (const c of done.credits) credits.push(c);
      s = {
        ...s,
        phase: "results",
        last: done.last,
        startedAt: s.deadline,
        deadline: s.deadline + RESULT_MS,
      };
    } else {
      s = openBetting(s, s.deadline, rng);
    }
    changed = true;
  }
  if (now >= s.deadline) {
    s = openBetting(s, now, rng);
    changed = true;
  }
  return { state: s, changed, credits };
}

// ---- the one thing a player can do --------------------------
// Put money on a horse. One bet per player per race, on
// purpose: it keeps the board readable, keeps the payout maths
// to one line, and means "did I bet?" is a yes or a no.
export function placeBet(state, entry, now) {
  const { playerId, username, horse, amount } = entry || {};
  if (state.phase !== "betting" || now >= state.deadline) {
    return { error: "closed" };
  }
  if (!playerId) return { error: "bad_player" };
  if (state.bets[playerId]) return { error: "already_bet" };
  const h = Number(horse);
  if (!Number.isInteger(h) || h < 0 || h >= HORSE_COUNT) return { error: "bad_horse" };
  const a = Number(amount);
  if (!Number.isInteger(a) || a < MIN_BET || a > MAX_BET) return { error: "bad_amount" };
  return {
    state: {
      ...state,
      bets: {
        ...state.bets,
        [playerId]: { horse: h, amount: a, username: String(username || "player"), at: now },
      },
    },
  };
}

// Undo a bet the wallet turned out not to cover. Only the route
// calls this, and only when its atomic debit refused.
export function cancelBet(state, playerId) {
  if (!state.bets || !state.bets[playerId]) return { state, changed: false };
  const bets = { ...state.bets };
  delete bets[playerId];
  return { state: { ...state, bets }, changed: true };
}

// ---- the wire -----------------------------------------------
// What the browser is allowed to know. `seed` and `winner` are
// withheld for exactly as long as they could be acted on, then
// handed over because the animation cannot exist without them.
export function toWire(state) {
  const open = state.phase === "betting";
  const bets = [];
  for (const id of Object.keys(state.bets || {}).sort()) {
    const b = state.bets[id];
    bets.push({ playerId: id, username: b.username, horse: b.horse, amount: b.amount });
  }
  return {
    raceId: state.raceId,
    phase: state.phase,
    startedAt: state.startedAt,
    deadline: state.deadline,
    seed: open ? null : state.seed,
    winner: open ? null : state.winner,
    bets,
    pot: potOf(state),
    last: state.last || null,
  };
}
