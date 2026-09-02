// ============================================================
// HSPNeighborhood — blackjack engine (milestone 14)
// ------------------------------------------------------------
// A PURE module: no I/O, no Date.now(), no randomness of its
// own. Every entry point takes the current table state plus an
// explicit `now` (ms) and returns a NEW state. That is what
// makes it testable (npm run test:blackjack) and what makes
// the API route trustworthy — the route is the only thing that
// ever calls these, and clients only ever render the state the
// route broadcasts.
//
// Same design rule as pathing/movement: one definition of the
// rules, imported by both sides. The client imports the pure
// READ helpers (handValue, canSplit, ...) to grey out buttons;
// it never calls the mutators, and even if it did, its answer
// would never leave the browser. The server re-checks every
// legality question before it moves a card.
//
// ---- HOUSE RULES, as implemented -------------------------
//   Shoe            6 decks, shuffled by the caller's RNG.
//                   Cut card at 75% penetration: when the shoe
//                   passes it, the NEXT hand starts fresh.
//   Dealer          stands on all 17s, including soft 17 (S17).
//   Blackjack       pays 3:2. Only on the first two cards of
//                   an UNSPLIT hand. 21 after a split is just
//                   21 and pays 1:1.
//   Push            bet returned, including player BJ vs
//                   dealer BJ.
//   Double down     any first two cards of a hand, including
//                   after a split. Exactly one more card, then
//                   the hand stands.
//   Split           any two cards of EQUAL VALUE (so K-Q may
//                   be split, as in most houses). Up to 3
//                   splits = 4 hands.
//   Split aces      get exactly ONE card each and then stand.
//                   No re-splitting aces, no doubling them.
//   Insurance       not offered. Not implemented anywhere.
//   Seats           3. Turn order is seat 0, 1, 2.
//   Bets            $5 min, $100 max, in whole dollars.
// ============================================================

export const SEAT_COUNT = 3;
export const DECKS = 6;
export const MIN_BET = 5;
export const MAX_BET = 100;
export const MAX_SPLITS = 3; // → up to 4 hands per seat
export const PENETRATION = 0.75; // reshuffle once this much of the shoe is gone
export const STARTING_BALANCE = 100;

// Phase clocks (ms). Every one of these is enforced by the
// server against a stored deadline, so an AFK player can never
// hang the table — see `tick()`.
export const BET_MS = 20_000; // betting window
export const TURN_MS = 25_000; // one player's decision
export const DEAL_PAUSE_MS = 900; // beat after the deal before play
export const DEALER_STEP_MS = 900; // beat between dealer cards
export const PAYOUT_MS = 6_000; // results on screen before the next hand
export const IDLE_MS = 4_000; // pause between hands when nobody has bet

export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const SUITS = ["S", "H", "D", "C"];

// ---- cards -------------------------------------------------
// A card is the compact string "<rank><suit>", e.g. "AS",
// "10D", "QH". Compact because the whole table state is a
// jsonb column that gets broadcast on every change.

export function cardRank(card) {
  return String(card).slice(0, -1);
}

export function cardSuit(card) {
  return String(card).slice(-1);
}

export function cardValue(card) {
  const r = cardRank(card);
  if (r === "A") return 11;
  if (r === "K" || r === "Q" || r === "J" || r === "10") return 10;
  const n = parseInt(r, 10);
  return Number.isFinite(n) ? n : 0;
}

// Best total for a hand, plus whether an ace is still counted
// as 11 (a "soft" hand).
export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards || []) {
    const v = cardValue(c);
    total += v;
    if (v === 11) aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0, busted: total > 21 };
}

export function isBlackjack(hand) {
  return (
    !!hand &&
    !hand.split &&
    (hand.cards || []).length === 2 &&
    handValue(hand.cards).total === 21
  );
}

// ---- shoe --------------------------------------------------

export function freshShoe(rng) {
  const cards = [];
  for (let d = 0; d < DECKS; d += 1) {
    for (const s of SUITS) for (const r of RANKS) cards.push(`${r}${s}`);
  }
  // Fisher-Yates with the caller's RNG (the route hands us a
  // crypto-backed one, so the shoe is not guessable from the
  // cards already on the table).
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = cards[i];
    cards[i] = cards[j];
    cards[j] = t;
  }
  return cards;
}

export function shoeSpent(state) {
  const total = DECKS * 52;
  return (total - (state.shoe ? state.shoe.length : 0)) / total;
}

// Draw one card, refilling mid-hand if the shoe somehow runs
// dry (it cannot at 75% penetration with 3 seats, but a table
// that throws instead of dealing is a hung table).
function draw(state, rng) {
  if (!state.shoe || state.shoe.length === 0) {
    state.shoe = freshShoe(rng);
    state.shuffled = true;
  }
  return state.shoe.pop();
}

// ---- state -------------------------------------------------
//
// {
//   v: 1,
//   phase: "idle" | "betting" | "dealing" | "playing"
//          | "dealer" | "payout",
//   deadline: ms | null,      when the phase auto-advances
//   handNo: int,
//   shoe: [card],
//   dealer: { cards: [card], hole: card|null },
//   seats: [ seat|null ] x SEAT_COUNT,
//   turn: { seat: int, hand: int } | null,
//   log: [ short strings for the felt ],
//   shuffled: bool            set on the hand a fresh shoe
//                             was cut in (the UI says so)
// }
//
// seat = {
//   playerId, username, avatar,
//   balance,                  mirrored from the wallet so one
//                             broadcast carries everything the
//                             table needs to draw
//   bet: int,                 this hand's base bet (0 = sitting out)
//   hands: [ hand ],
//   result: string|null,      set during payout for the badge
//   net: int|null,            payout delta, for the badge
//   leaving: bool             stood up mid-hand; seat frees at payout
// }
//
// hand = {
//   cards: [card], bet, done, busted, doubled, split,
//   fromAces, outcome, net
// }

export function emptyState(rng) {
  return {
    v: 1,
    phase: "idle",
    deadline: null,
    handNo: 0,
    shoe: freshShoe(rng),
    dealer: { cards: [], hole: null },
    seats: new Array(SEAT_COUNT).fill(null),
    turn: null,
    log: [],
    shuffled: false,
  };
}

function newHand(bet, extra) {
  return {
    cards: [],
    bet,
    done: false,
    busted: false,
    doubled: false,
    split: false,
    fromAces: false,
    outcome: null,
    net: null,
    ...(extra || {}),
  };
}

function note(state, text) {
  state.log = [...(state.log || []), text].slice(-6);
}

export function seatOf(state, playerId) {
  const seats = state.seats || [];
  for (let i = 0; i < seats.length; i += 1) {
    if (seats[i] && seats[i].playerId === playerId) return i;
  }
  return -1;
}

export function occupiedSeats(state) {
  return (state.seats || []).filter(Boolean).length;
}

// A hand is "live" when it still belongs to the current deal.
function activeSeats(state) {
  return (state.seats || []).filter((s) => s && s.bet > 0 && s.hands && s.hands.length);
}

// ---- legality ----------------------------------------------
// The client uses these to grey out buttons; the server uses
// the SAME ones to refuse an action. Never duplicated.

export function isSeatTurn(state, seatIndex, handIndex) {
  return (
    state.phase === "playing" &&
    !!state.turn &&
    state.turn.seat === seatIndex &&
    (handIndex === undefined || state.turn.hand === handIndex)
  );
}

export function canHit(hand) {
  if (!hand || hand.done || hand.busted) return false;
  if (hand.fromAces) return false; // split aces get one card, then stand
  return handValue(hand.cards).total < 21;
}

export function canDouble(hand, balance) {
  if (!hand || hand.done || hand.busted) return false;
  if (hand.fromAces) return false;
  if ((hand.cards || []).length !== 2) return false;
  if (hand.doubled) return false;
  return (balance || 0) >= hand.bet;
}

export function canSplit(state, seat, hand) {
  if (!seat || !hand || hand.done || hand.busted) return false;
  if ((hand.cards || []).length !== 2) return false;
  if (hand.fromAces) return false; // no re-splitting aces
  if ((seat.hands || []).length > MAX_SPLITS) return false;
  if (cardValue(hand.cards[0]) !== cardValue(hand.cards[1])) return false;
  return (seat.balance || 0) >= hand.bet;
}

// ---- seating -----------------------------------------------

export function sit(state, { seatIndex, playerId, username, avatar, balance }, now) {
  const seats = state.seats || [];
  if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= SEAT_COUNT) {
    return { error: "bad_seat" };
  }
  if (seatOf(state, playerId) >= 0) return { error: "already_seated" };
  if (seats[seatIndex]) return { error: "seat_taken" };
  const next = clone(state);
  next.seats[seatIndex] = {
    playerId,
    username,
    avatar: avatar || null,
    balance,
    bet: 0,
    hands: [],
    result: null,
    net: null,
    leaving: false,
    joinedAt: now,
  };
  note(next, `${username} sits down at seat ${seatIndex + 1}.`);
  // A table sitting idle wakes up as soon as somebody sits.
  if (next.phase === "idle") {
    next.phase = "betting";
    next.deadline = now + BET_MS;
    next.shuffled = false;
  }
  return { state: next };
}

// Standing up. Mid-hand this does NOT forfeit the bet: the
// hands auto-stand and play out, any winnings still land in
// the wallet, and the seat frees at payout. That is the
// friendly reading and it keeps the table moving — a seat can
// never be stuck "in a hand" with nobody in it.
export function stand(state, playerId, now) {
  const i = seatOf(state, playerId);
  if (i < 0) return { error: "not_seated" };
  const next = clone(state);
  const seat = next.seats[i];
  const inHand =
    next.phase !== "idle" &&
    next.phase !== "betting" &&
    seat.bet > 0 &&
    (seat.hands || []).some((h) => !h.done && !h.busted);
  if (inHand) {
    seat.leaving = true;
    for (const h of seat.hands) h.done = true;
    note(next, `${seat.username} left the table — hands stand.`);
    // No refund and no wallet write: the bet is live, and the
    // hand is settled (and paid) at payout like anyone else's.
    return { state: advance(next, now), refund: null, wallets: [] };
  }
  // Not mid-hand: the seat empties immediately. A bet placed
  // for a hand that has not been dealt is refunded.
  const refund = next.phase === "betting" ? seat.bet || 0 : 0;
  const finalBalance = (seat.balance || 0) + refund;
  next.seats[i] = null;
  note(next, `${seat.username} left the table.`);
  const settled = occupiedSeats(next) === 0 ? goIdle(next, now) : advance(next, now);
  return {
    state: settled,
    refund: refund ? { playerId, amount: refund } : null,
    wallets: [{ playerId, balance: finalBalance }],
  };
}

function goIdle(state, now) {
  state.phase = "idle";
  state.deadline = null;
  state.turn = null;
  state.dealer = { cards: [], hole: null };
  return state;
}

// ---- betting -----------------------------------------------

export function bet(state, playerId, amount, now) {
  if (state.phase !== "betting") return { error: "not_betting" };
  const i = seatOf(state, playerId);
  if (i < 0) return { error: "not_seated" };
  const seat = state.seats[i];
  if (seat.ready) return { error: "already_in" }; // locked once you hit Deal
  const amt = Math.floor(Number(amount));
  if (!Number.isFinite(amt) || amt < MIN_BET || amt > MAX_BET) return { error: "bad_bet" };
  // The DELTA is what the wallet is charged; adjusting the bet
  // in the same window tops up or refunds, it never stacks. A
  // negative delta is a refund and is always allowed.
  const delta = amt - (seat.bet || 0);
  if (delta > (seat.balance || 0)) return { error: "insufficient" };
  const next = clone(state);
  next.seats[i].bet = amt;
  next.seats[i].balance -= delta;
  return { state: next, charge: { playerId, amount: delta } };
}

// "Deal me in." Chips go down with bet() as many times as you
// like; THIS is the commitment, and it is what lets a table of
// one deal instantly instead of staring at the clock. Once
// every occupied seat is ready the cards come out.
export function ready(state, playerId, now, rng) {
  if (state.phase !== "betting") return { error: "not_betting" };
  const i = seatOf(state, playerId);
  if (i < 0) return { error: "not_seated" };
  const seat = state.seats[i];
  if ((seat.bet || 0) < MIN_BET) return { error: "no_bet" };
  if (seat.ready) return { error: "already_in" };
  const next = clone(state);
  next.seats[i].ready = true;
  const seated = (next.seats || []).filter(Boolean);
  if (seated.length > 0 && seated.every((x) => x.ready)) {
    return { state: startDeal(next, now, rng) };
  }
  return { state: next };
}

// ---- the deal ----------------------------------------------

function startDeal(state, now, rng) {
  const players = (state.seats || []).filter((s) => s && s.bet > 0);
  if (players.length === 0) {
    // Nobody bet: sit the table back down for a beat, then
    // open a fresh betting window.
    state.phase = "betting";
    state.deadline = now + BET_MS;
    for (const s of state.seats) if (s) s.ready = false;
    return state;
  }
  // Cut card: a shoe past 75% is replaced BETWEEN hands, never
  // mid-hand, which is how a real shoe works.
  state.shuffled = false;
  if (shoeSpent(state) >= PENETRATION) {
    state.shoe = freshShoe(rng || Math.random);
    state.shuffled = true;
    note(state, "Shuffling a fresh six-deck shoe.");
  }
  state.handNo = (state.handNo || 0) + 1;
  state.dealer = { cards: [], hole: null };
  for (const s of state.seats) {
    if (!s) continue;
    s.result = null;
    s.net = null;
    s.ready = false;
    s.hands = s.bet > 0 ? [newHand(s.bet)] : [];
  }
  const rand = rng || Math.random;
  // Two rounds, players then dealer, exactly like a real deal.
  for (let round = 0; round < 2; round += 1) {
    for (const s of state.seats) {
      if (!s || s.bet <= 0) continue;
      s.hands[0].cards.push(draw(state, rand));
    }
    if (round === 0) state.dealer.cards.push(draw(state, rand));
    else state.dealer.hole = draw(state, rand);
  }
  state.phase = "dealing";
  state.deadline = now + DEAL_PAUSE_MS;
  state.turn = null;
  return state;
}

// After the deal beat: if the dealer has a natural the hand is
// over before anyone acts; otherwise play passes to the first
// seat that still has a decision to make.
function afterDeal(state, now) {
  const dealerCards = [...state.dealer.cards, state.dealer.hole];
  const dealerBJ = handValue(dealerCards).total === 21;
  if (dealerBJ) {
    state.dealer.cards = dealerCards;
    state.dealer.hole = null;
    note(state, "Dealer has blackjack.");
    return settle(state, now);
  }
  // Naturals stand themselves.
  for (const s of state.seats) {
    if (!s || s.bet <= 0) continue;
    for (const h of s.hands) if (isBlackjack(h)) h.done = true;
  }
  state.phase = "playing";
  return nextTurn(state, now, -1, -1);
}

// Find the next hand that still needs a decision, in seat
// order, starting AFTER (fromSeat, fromHand).
function nextTurn(state, now, fromSeat, fromHand) {
  const seats = state.seats || [];
  for (let i = 0; i < seats.length; i += 1) {
    const s = seats[i];
    if (!s || s.bet <= 0 || !s.hands) continue;
    if (i < fromSeat) continue;
    for (let h = 0; h < s.hands.length; h += 1) {
      if (i === fromSeat && h <= fromHand) continue;
      const hand = s.hands[h];
      if (hand.done || hand.busted) continue;
      state.turn = { seat: i, hand: h };
      state.phase = "playing";
      state.deadline = now + TURN_MS;
      return state;
    }
  }
  // Everybody has acted — the dealer plays.
  state.turn = null;
  state.phase = "dealer";
  state.deadline = now + DEALER_STEP_MS;
  return state;
}

// Re-derive where play should be. Called after any action and
// after a stand-up, so a seat leaving in the middle of its own
// turn hands the turn straight on instead of stalling.
function advance(state, now) {
  if (state.phase !== "playing") return state;
  const t = state.turn;
  if (t) {
    const seat = state.seats[t.seat];
    const hand = seat && seat.hands && seat.hands[t.hand];
    if (seat && hand && !hand.done && !hand.busted) return state; // turn still valid
    return nextTurn(state, now, t.seat, t.hand);
  }
  return nextTurn(state, now, -1, -1);
}

// ---- player actions ----------------------------------------
// Each returns { state } or { error }, plus a `charge` when the
// wallet must move (double/split take a second bet).

function requireTurn(state, playerId) {
  const i = seatOf(state, playerId);
  if (i < 0) return { error: "not_seated" };
  if (state.phase !== "playing") return { error: "not_your_turn" };
  if (!state.turn || state.turn.seat !== i) return { error: "not_your_turn" };
  const seat = state.seats[i];
  const hand = seat.hands[state.turn.hand];
  if (!hand || hand.done || hand.busted) return { error: "not_your_turn" };
  return { i, seat, hand };
}

export function hit(state, playerId, now, rng) {
  const t = requireTurn(state, playerId);
  if (t.error) return t;
  if (!canHit(t.hand)) return { error: "cannot_hit" };
  const next = clone(state);
  const seat = next.seats[t.i];
  const hand = seat.hands[next.turn.hand];
  hand.cards.push(draw(next, rng || Math.random));
  const val = handValue(hand.cards);
  if (val.busted) {
    hand.busted = true;
    hand.done = true;
    note(next, `${seat.username} busts with ${val.total}.`);
  } else if (val.total === 21) {
    hand.done = true;
  }
  if (hand.done) return { state: nextTurn(next, now, next.turn.seat, next.turn.hand) };
  next.deadline = now + TURN_MS;
  return { state: next };
}

export function stay(state, playerId, now) {
  const t = requireTurn(state, playerId);
  if (t.error) return t;
  const next = clone(state);
  next.seats[t.i].hands[next.turn.hand].done = true;
  return { state: nextTurn(next, now, next.turn.seat, next.turn.hand) };
}

export function double(state, playerId, now, rng) {
  const t = requireTurn(state, playerId);
  if (t.error) return t;
  if (!canDouble(t.hand, t.seat.balance)) return { error: "cannot_double" };
  const next = clone(state);
  const seat = next.seats[t.i];
  const hand = seat.hands[next.turn.hand];
  const extra = hand.bet;
  seat.balance -= extra;
  hand.bet += extra;
  hand.doubled = true;
  hand.cards.push(draw(next, rng || Math.random));
  const val = handValue(hand.cards);
  if (val.busted) {
    hand.busted = true;
    note(next, `${seat.username} doubles and busts with ${val.total}.`);
  } else {
    note(next, `${seat.username} doubles down for $${hand.bet}.`);
  }
  hand.done = true;
  return {
    state: nextTurn(next, now, next.turn.seat, next.turn.hand),
    charge: { playerId, amount: extra },
  };
}

export function split(state, playerId, now, rng) {
  const t = requireTurn(state, playerId);
  if (t.error) return t;
  if (!canSplit(state, t.seat, t.hand)) return { error: "cannot_split" };
  const next = clone(state);
  const seat = next.seats[t.i];
  const idx = next.turn.hand;
  const hand = seat.hands[idx];
  const aces = cardRank(hand.cards[0]) === "A";
  const moved = hand.cards.pop();
  const extra = hand.bet;
  seat.balance -= extra;
  const rand = rng || Math.random;

  hand.split = true;
  hand.fromAces = aces;
  hand.cards.push(draw(next, rand));

  const second = newHand(extra, { split: true, fromAces: aces });
  second.cards.push(moved, draw(next, rand));

  seat.hands.splice(idx + 1, 0, second);
  note(next, `${seat.username} splits ${cardRank(moved)}s.`);

  // Split aces take one card each and stand. Everything else
  // keeps playing the first of the two new hands.
  if (aces) {
    hand.done = true;
    second.done = true;
    return {
      state: nextTurn(next, now, t.i, idx + 1),
      charge: { playerId, amount: extra },
    };
  }
  for (const h of [hand, second]) {
    if (handValue(h.cards).total === 21) h.done = true;
  }
  if (hand.done) {
    return {
      state: nextTurn(next, now, t.i, idx),
      charge: { playerId, amount: extra },
    };
  }
  next.deadline = now + TURN_MS;
  return { state: next, charge: { playerId, amount: extra } };
}

// ---- dealer ------------------------------------------------
// One card per call, so the felt animates instead of jumping.
// S17: the dealer stands on every 17, soft included.

function dealerStep(state, now, rng) {
  if (state.dealer.hole) {
    state.dealer.cards.push(state.dealer.hole);
    state.dealer.hole = null;
    state.deadline = now + DEALER_STEP_MS;
    return state;
  }
  // Nobody left to beat? The dealer does not draw for an
  // audience of busted hands.
  const live = activeSeats(state).some((s) =>
    s.hands.some((h) => !h.busted)
  );
  const val = handValue(state.dealer.cards);
  if (!live || val.total >= 17) return settle(state, now);
  state.dealer.cards.push(draw(state, rng || Math.random));
  state.deadline = now + DEALER_STEP_MS;
  if (handValue(state.dealer.cards).total > 21) return settle(state, now);
  return state;
}

// ---- settlement --------------------------------------------
// Returns the state with every hand's outcome + net filled in.
// `payouts` (what the wallet must be CREDITED) is derived from
// the state by payoutsFor(), so the route never has to trust a
// second code path.

function settle(state, now) {
  if (state.dealer.hole) {
    state.dealer.cards.push(state.dealer.hole);
    state.dealer.hole = null;
  }
  const dv = handValue(state.dealer.cards);
  const dealerBJ = state.dealer.cards.length === 2 && dv.total === 21;
  for (const seat of state.seats) {
    if (!seat || seat.bet <= 0 || !seat.hands) continue;
    let net = 0;
    for (const h of seat.hands) {
      const hv = handValue(h.cards);
      const bj = isBlackjack(h);
      if (h.busted) {
        h.outcome = "bust";
        h.net = -h.bet;
      } else if (bj && dealerBJ) {
        h.outcome = "push";
        h.net = 0;
      } else if (bj) {
        h.outcome = "blackjack";
        // 3:2. Bets are whole dollars and the min is $5, so
        // this is exact for every legal bet except odd ones,
        // which round DOWN in the house's favour — spelled out
        // in README-neighborhood.md.
        h.net = Math.floor((h.bet * 3) / 2);
      } else if (dealerBJ) {
        h.outcome = "lose";
        h.net = -h.bet;
      } else if (dv.busted) {
        h.outcome = "win";
        h.net = h.bet;
      } else if (hv.total > dv.total) {
        h.outcome = "win";
        h.net = h.bet;
      } else if (hv.total < dv.total) {
        h.outcome = "lose";
        h.net = -h.bet;
      } else {
        h.outcome = "push";
        h.net = 0;
      }
      net += h.net;
    }
    seat.net = net;
    seat.result = net > 0 ? "win" : net < 0 ? "lose" : "push";
  }
  state.phase = "payout";
  state.turn = null;
  state.deadline = now + PAYOUT_MS;
  return state;
}

// What each seat gets BACK from the house: the stake already
// left the wallet when the bet was placed, so a push returns
// the stake and a win returns stake + winnings.
export function payoutsFor(state) {
  const out = [];
  for (const seat of state.seats || []) {
    if (!seat || !seat.hands || seat.bet <= 0) continue;
    let credit = 0;
    for (const h of seat.hands) {
      if (h.outcome === "bust" || h.outcome === "lose") continue;
      credit += h.bet + (h.net || 0);
    }
    if (credit > 0) out.push({ playerId: seat.playerId, amount: credit });
  }
  return out;
}

// Clear the felt and open the next betting window. Seats that
// stood up mid-hand are freed HERE, which is why a disconnect
// can never wedge the table.
function nextHand(state, now) {
  for (let i = 0; i < state.seats.length; i += 1) {
    const s = state.seats[i];
    if (!s) continue;
    if (s.leaving) {
      state.seats[i] = null;
      continue;
    }
    s.bet = 0;
    s.hands = [];
    s.ready = false;
  }
  state.dealer = { cards: [], hole: null };
  state.turn = null;
  if (occupiedSeats(state) === 0) return goIdle(state, now);
  state.phase = "betting";
  state.deadline = now + BET_MS;
  return state;
}

// ---- the clock ---------------------------------------------
// The ONE function that moves a table forward on time rather
// than on a tap. Idempotent and driven purely by `now` vs the
// stored deadline, so it is safe for every client in the room
// to call it — and safe for two lambdas to call it at once,
// because the write is version-guarded.
//
// Returns { state, changed, charges, payouts }.

export function tick(state, now, rng) {
  let s = clone(state);
  let changed = false;
  const payouts = [];
  const wallets = [];
  const rand = rng || Math.random;
  // Loop, because one expiry can immediately produce another
  // (a deal beat rolls straight into the first turn). Bounded
  // so a bug can never spin here.
  for (let guard = 0; guard < 64; guard += 1) {
    if (!s.deadline || now < s.deadline) break;
    changed = true;
    if (s.phase === "betting") {
      // Anyone who did not bet in time sits the hand out.
      const anyBet = (s.seats || []).some((x) => x && x.bet > 0);
      if (!anyBet) {
        // Nothing to deal. Idle briefly, then reopen betting,
        // so an empty-but-occupied table is not a busy loop.
        if (occupiedSeats(s) === 0) {
          s = goIdle(s, now);
          break;
        }
        s.deadline = now + IDLE_MS;
        for (const x of s.seats) if (x) x.ready = false;
        break;
      }
      s = startDeal(s, now, rand);
    } else if (s.phase === "dealing") {
      s = afterDeal(s, now);
    } else if (s.phase === "playing") {
      // Turn timer: auto-STAND, which is the safe default and
      // never spends more of an absent player's money.
      const t = s.turn;
      if (!t) {
        s = nextTurn(s, now, -1, -1);
      } else {
        const seat = s.seats[t.seat];
        const hand = seat && seat.hands && seat.hands[t.hand];
        if (hand) {
          hand.done = true;
          if (seat) note(s, `${seat.username} timed out — standing.`);
        }
        s = nextTurn(s, now, t.seat, t.hand);
      }
    } else if (s.phase === "dealer") {
      const before = s.phase;
      s = dealerStep(s, now, rand);
      if (s.phase === before && !s.deadline) break;
    } else if (s.phase === "payout") {
      // Winnings land in the mirrored balance FIRST, so the
      // number the route persists is the same number the felt
      // is showing. Seats about to be freed (players who stood
      // up mid-hand) are captured here or their winnings would
      // vanish with the seat.
      for (const p of payoutsFor(s)) {
        payouts.push(p);
        const idx = seatOf(s, p.playerId);
        if (idx >= 0) s.seats[idx].balance += p.amount;
      }
      for (const seat of s.seats) {
        if (seat) wallets.push({ playerId: seat.playerId, balance: seat.balance });
      }
      s = nextHand(s, now);
    } else {
      break;
    }
  }
  return { state: s, changed, payouts, wallets };
}

// ---- wire ---------------------------------------------------
// What clients are allowed to see. The SHOE never leaves the
// server — sending it would hand every player the future — and
// the dealer's hole card is withheld until the dealer turns it
// over. This is the only shape the broadcast ever carries.

// Every seated player's authoritative balance, for persisting
// to the wallet table after a successful state write. Absolute
// numbers, never deltas: a dropped write is then corrected by
// the next one instead of compounding.
export function walletSnapshot(state) {
  return (state.seats || [])
    .filter(Boolean)
    .map((s) => ({ playerId: s.playerId, balance: s.balance }));
}

// Re-seed the mirrored balances from the wallet table. Called
// when a betting window opens, so money won or lost anywhere
// else (or a $100 top-up) shows up at the table.
export function syncBalances(state, byId) {
  const next = clone(state);
  for (const seat of next.seats || []) {
    if (!seat) continue;
    const v = byId[seat.playerId];
    if (Number.isFinite(v)) seat.balance = v;
  }
  return next;
}

export function toWire(state) {
  return {
    v: state.v,
    phase: state.phase,
    deadline: state.deadline || null,
    handNo: state.handNo || 0,
    shuffled: !!state.shuffled,
    cardsLeft: state.shoe ? state.shoe.length : 0,
    dealer: {
      cards: [...(state.dealer.cards || [])],
      // A boolean, not the card. There is nothing to peek at.
      hole: !!state.dealer.hole,
      value: handValue(state.dealer.cards || []),
    },
    seats: (state.seats || []).map((s) =>
      s
        ? {
            playerId: s.playerId,
            username: s.username,
            avatar: s.avatar || null,
            balance: s.balance,
            bet: s.bet || 0,
            ready: !!s.ready,
            leaving: !!s.leaving,
            result: s.result || null,
            net: s.net === undefined ? null : s.net,
            hands: (s.hands || []).map((h) => ({
              cards: [...h.cards],
              bet: h.bet,
              done: !!h.done,
              busted: !!h.busted,
              doubled: !!h.doubled,
              split: !!h.split,
              fromAces: !!h.fromAces,
              outcome: h.outcome || null,
              net: h.net === undefined ? null : h.net,
              value: handValue(h.cards),
              blackjack: isBlackjack(h),
            })),
          }
        : null
    ),
    turn: state.turn ? { ...state.turn } : null,
    log: [...(state.log || [])],
  };
}

function clone(state) {
  // structuredClone is available on Node 18+ and every browser
  // the site supports; the JSON fallback keeps the module
  // usable anywhere the tests might run.
  if (typeof structuredClone === "function") return structuredClone(state);
  return JSON.parse(JSON.stringify(state));
}

export const __test = { startDeal, afterDeal, settle, nextHand, dealerStep, nextTurn, draw };
