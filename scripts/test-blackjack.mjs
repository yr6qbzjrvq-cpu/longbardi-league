// Rules harness for lib/neighborhood/blackjack.js.
// Run: node scripts/test-blackjack.mjs
import * as BJ from "../lib/neighborhood/blackjack.js";

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; console.log("  FAIL " + name + (extra ? "  << " + JSON.stringify(extra) : "")); }
}
function eq(name, a, b) { ok(name + ` (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b)); }

// A deterministic RNG so any failure is reproducible.
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Stack the shoe. `draw` pops, so the FIRST card dealt is the
// LAST element — this reverses for you.
function stack(state, cards) {
  const filler = [];
  while (filler.length + cards.length < 312) filler.push("2C");
  state.shoe = [...filler, ...[...cards].reverse()]; // pop() draws cards[0] first
  return state;
}
// Apply a mutator and blow up loudly if it was refused.
function apply(res, what) {
  if (!res || res.error) throw new Error(`${what} refused: ${res && res.error}`);
  return res.state;
}
// Run the clock forward until the hand settles (the dealer draws
// one card per tick on purpose, so the felt can animate).
function runOut(state, rng) {
  let s = state;
  for (let i = 0; i < 40; i += 1) {
    if (s.phase === "payout" || !s.deadline) break;
    s = BJ.tick(s, s.deadline, rng).state;
  }
  return s;
}

function seatUp(state, n, now) {
  let s = state;
  for (let i = 0; i < n; i += 1) {
    const r = BJ.sit(s, { seatIndex: i, playerId: `p${i}`, username: `P${i}`, avatar: null, balance: 100 }, now);
    if (r.error) throw new Error("sit failed: " + r.error);
    s = r.state;
  }
  return s;
}

// Sit, stack, bet, and advance to the first decision. Handles
// BOTH paths into a deal: everyone betting (which deals early)
// and the betting clock running out.
function beginHand(state, bets, cards, now, rng) {
  let s = stack(state, cards);
  for (const [pid, amt] of bets) s = apply(BJ.bet(s, pid, amt, now), `bet ${pid}`);
  for (const [pid] of bets) s = apply(BJ.ready(s, pid, now, rng), `ready ${pid}`);
  if (s.phase === "betting") s = BJ.tick(s, s.deadline, rng).state;
  if (s.phase === "dealing") s = BJ.tick(s, s.deadline, rng).state;
  return s;
}

console.log("\n— hand values —");
eq("A+K is 21 soft", BJ.handValue(["AS", "KH"]).total, 21);
ok("A+K is soft", BJ.handValue(["AS", "KH"]).soft);
eq("A+A+9 is 21", BJ.handValue(["AS", "AH", "9D"]).total, 21);
eq("A+6+10 is 17 hard", BJ.handValue(["AS", "6H", "10D"]).total, 17);
ok("A+6+10 is not soft", !BJ.handValue(["AS", "6H", "10D"]).soft);
eq("K+Q+5 busts at 25", BJ.handValue(["KS", "QH", "5D"]).total, 25);
ok("bust flag", BJ.handValue(["KS", "QH", "5D"]).busted);

console.log("\n— blackjack detection —");
ok("2-card 21 is BJ", BJ.isBlackjack({ cards: ["AS", "KH"], split: false }));
ok("21 after split is NOT BJ", !BJ.isBlackjack({ cards: ["AS", "KH"], split: true }));
ok("3-card 21 is NOT BJ", !BJ.isBlackjack({ cards: ["7S", "7H", "7D"], split: false }));

console.log("\n— shoe —");
const shoe = BJ.freshShoe(lcg(42));
eq("6 decks = 312 cards", shoe.length, 312);
eq("24 aces in the shoe", shoe.filter((c) => BJ.cardRank(c) === "A").length, 24);
eq("96 ten-valued cards", shoe.filter((c) => BJ.cardValue(c) === 10).length, 96);

console.log("\n— seating —");
let now = 1_000_000;
let st = BJ.emptyState(lcg(7));
eq("starts idle", st.phase, "idle");
st = seatUp(st, 1, now);
eq("one sitter opens betting", st.phase, "betting");
eq("seat 0 taken", st.seats[0].username, "P0");
ok("same player cannot take a second seat", !!BJ.sit(st, { seatIndex: 1, playerId: "p0", username: "P0", balance: 100 }, now).error);
ok("a taken seat is refused", !!BJ.sit(st, { seatIndex: 0, playerId: "pX", username: "PX", balance: 100 }, now).error);
st = BJ.sit(st, { seatIndex: 1, playerId: "p1", username: "P1", balance: 100 }, now).state;
st = BJ.sit(st, { seatIndex: 2, playerId: "p2", username: "P2", balance: 100 }, now).state;
eq("three seats full", BJ.occupiedSeats(st), 3);
ok("a 4th player is refused every seat", [0,1,2].every((i) => !!BJ.sit(st, { seatIndex: i, playerId: "p9", username: "P9", balance: 100 }, now).error));
ok("a 4th seat index is refused", !!BJ.sit(st, { seatIndex: 3, playerId: "p9", username: "P9", balance: 100 }, now).error);

console.log("\n— betting —");
let r = BJ.bet(st, "p0", 3, now);
ok("below the $5 minimum is refused", r.error === "bad_bet");
r = BJ.bet(st, "p0", 500, now);
ok("above the $100 maximum is refused", r.error === "bad_bet");
r = BJ.bet(st, "p0", 25, now);
eq("a $25 bet charges the wallet $25", r.charge.amount, 25);
eq("and the mirrored balance drops", r.state.seats[0].balance, 75);
const rebet = BJ.bet(r.state, "p0", 40, now);
eq("re-betting charges only the delta", rebet.charge.amount, 15);
eq("and the balance is right", rebet.state.seats[0].balance, 60);
ok("re-betting up to the full stake is allowed", !BJ.bet(rebet.state, "p0", 100, now).error);
const brokeSeat = BJ.sit(BJ.emptyState(lcg(99)), { seatIndex: 0, playerId: "pb", username: "PB", balance: 4 }, now).state;
ok("betting more than the wallet holds is refused", BJ.bet(brokeSeat, "pb", 25, now).error === "insufficient");

console.log("\n— a full hand: blackjack pays 3:2 —");
now = 2_000_000;
st = BJ.emptyState(lcg(1));
st = seatUp(st, 1, now);
// Deal order is player, dealer-up, player, dealer-hole.
st = beginHand(st, [["p0", 20]], ["AS", "9H", "KD", "7C", "5S"], now, lcg(1)); // balance 80
eq("player has A + K", st.seats[0].hands[0].cards, ["AS", "KD"]);
eq("dealer shows 9", st.dealer.cards, ["9H"]);
// Player has a natural, so it auto-stands; dealer 9+7 = 16, must hit.
st = runOut(st, lcg(1));
eq("dealer stood/settled into payout", st.phase, "payout");
eq("dealer drew to 21? no — 9+7+5", st.dealer.cards, ["9H", "7C", "5S"]);
eq("dealer total 21", BJ.handValue(st.dealer.cards).total, 21);
eq("player natural beats a 3-card 21", st.seats[0].hands[0].outcome, "blackjack");
eq("3:2 on $20 is +$30", st.seats[0].hands[0].net, 30);
eq("payout credits stake + winnings = $50", BJ.payoutsFor(st)[0].amount, 50);

console.log("\n— dealer stands on SOFT 17 (S17) —");
now = 3_000_000;
st = BJ.emptyState(lcg(2));
st = seatUp(st, 1, now);
st = beginHand(st, [["p0", 10]], ["10S", "AH", "8D", "6C", "9S", "9D"], now, lcg(2));
eq("player 18", BJ.handValue(st.seats[0].hands[0].cards).total, 18);
st = apply(BJ.stay(st, "p0", now), "stand");
st = runOut(st, lcg(2));
eq("dealer holds A + 6 = soft 17", st.dealer.cards, ["AH", "6C"]);
eq("dealer did NOT draw", st.dealer.cards.length, 2);
eq("player 18 beats soft 17", st.seats[0].hands[0].outcome, "win");

console.log("\n— double down —");
now = 4_000_000;
st = BJ.emptyState(lcg(3));
st = seatUp(st, 1, now);
st = beginHand(st, [["p0", 25]], ["6S", "10H", "5D", "7C", "10S", "4D"], now, lcg(3)); // balance 75
eq("player has 11", BJ.handValue(st.seats[0].hands[0].cards).total, 11);
ok("double is legal on 11", BJ.canDouble(st.seats[0].hands[0], st.seats[0].balance));
const dbl = BJ.double(st, "p0", now, lcg(3));
eq("double charges a second $25", dbl.charge.amount, 25);
st = dbl.state;
eq("hand bet is now $50", st.seats[0].hands[0].bet, 50);
eq("exactly one card came", st.seats[0].hands[0].cards.length, 3);
eq("6+5+10 = 21", BJ.handValue(st.seats[0].hands[0].cards).total, 21);
ok("the hand is closed after a double", st.seats[0].hands[0].done);
eq("balance mirrored down to $50", st.seats[0].balance, 50);
st = runOut(st, lcg(3));
eq("dealer 10+7 = 17, stands", BJ.handValue(st.dealer.cards).total, 17);
eq("21 beats 17", st.seats[0].hands[0].outcome, "win");
eq("a won double pays +$50", st.seats[0].hands[0].net, 50);
eq("credit is stake+win = $100", BJ.payoutsFor(st)[0].amount, 100);

console.log("\n— split —");
now = 5_000_000;
st = BJ.emptyState(lcg(4));
st = seatUp(st, 1, now);
st = beginHand(st, [["p0", 20]], ["8S", "10H", "8D", "6C", "3S", "9D", "10D", "4H"], now, lcg(4)); // balance 80
eq("player was dealt a pair of 8s", st.seats[0].hands[0].cards, ["8S", "8D"]);
ok("split is legal", BJ.canSplit(st, st.seats[0], st.seats[0].hands[0]));
const sp = BJ.split(st, "p0", now, lcg(4));
eq("split charges a matching $20", sp.charge.amount, 20);
st = sp.state;
eq("now two hands", st.seats[0].hands.length, 2);
eq("hand 1 = 8 + 3", st.seats[0].hands[0].cards, ["8S", "3S"]);
eq("hand 2 = 8 + 9", st.seats[0].hands[1].cards, ["8D", "9D"]);
eq("both bets $20", [st.seats[0].hands[0].bet, st.seats[0].hands[1].bet], [20, 20]);
eq("balance mirrored to $60", st.seats[0].balance, 60);
eq("turn is on the first split hand", st.turn, { seat: 0, hand: 0 });
st = apply(BJ.hit(st, "p0", now, lcg(4)), "hit");   // 8+3+10 = 21
eq("hand 1 hits to 21", BJ.handValue(st.seats[0].hands[0].cards).total, 21);
eq("turn moved to hand 2", st.turn, { seat: 0, hand: 1 });
st = apply(BJ.stay(st, "p0", now), "stand");          // stand 17
st = runOut(st, lcg(4));
eq("dealer 10+6+4 = 20", BJ.handValue(st.dealer.cards).total, 20);
eq("split hand 1 (21) wins", st.seats[0].hands[0].outcome, "win");
eq("split hand 2 (17) loses", st.seats[0].hands[1].outcome, "lose");
eq("net for the seat is 0", st.seats[0].net, 0);
eq("credit back is just the winning stake+win = $40", BJ.payoutsFor(st)[0].amount, 40);
ok("21 on a split hand is NOT paid 3:2", st.seats[0].hands[0].net === 20);

console.log("\n— split aces get one card each and stand —");
now = 6_000_000;
st = BJ.emptyState(lcg(5));
st = seatUp(st, 1, now);
st = beginHand(st, [["p0", 10]], ["AS", "10H", "AD", "8C", "9S", "KD", "3H"], now, lcg(5));
eq("a pair of aces", st.seats[0].hands[0].cards, ["AS", "AD"]);
st = apply(BJ.split(st, "p0", now, lcg(5)), "split aces");
eq("two ace hands", st.seats[0].hands.length, 2);
eq("each got exactly one card", [st.seats[0].hands[0].cards.length, st.seats[0].hands[1].cards.length], [2, 2]);
ok("both are closed", st.seats[0].hands[0].done && st.seats[0].hands[1].done);
ok("neither may be hit", !BJ.canHit(st.seats[0].hands[0]) && !BJ.canHit(st.seats[0].hands[1]));
ok("neither may be re-split", !BJ.canSplit(st, st.seats[0], st.seats[0].hands[0]));
ok("neither may be doubled", !BJ.canDouble(st.seats[0].hands[0], st.seats[0].balance));
ok("A+9 = 20 is not scored as a blackjack", !st.seats[0].hands[0].blackjack);

console.log("\n— split cap: 4 hands max —");
st = BJ.emptyState(lcg(6));
const capSeat = { hands: [1, 2, 3, 4].map(() => ({ cards: ["8S", "8D"], bet: 10 })), balance: 100 };
ok("a 4th split is refused", !BJ.canSplit(st, capSeat, capSeat.hands[0]));
const okSeat = { hands: [1, 2, 3].map(() => ({ cards: ["8S", "8D"], bet: 10 })), balance: 100 };
ok("a 3rd split is allowed", BJ.canSplit(st, okSeat, okSeat.hands[0]));
ok("K-Q splits (equal value)", BJ.canSplit(st, { hands: [{}], balance: 100 }, { cards: ["KS", "QD"], bet: 10 }));
ok("K-9 does not split", !BJ.canSplit(st, { hands: [{}], balance: 100 }, { cards: ["KS", "9D"], bet: 10 }));

console.log("\n— dealer blackjack —");
now = 7_000_000;
st = BJ.emptyState(lcg(8));
st = seatUp(st, 2, now);
// p0:10,K  p1:9,3  dealer A,10
st = beginHand(st, [["p0", 10], ["p1", 20]], ["10S", "9D", "AH", "10C", "3S", "KD"], now, lcg(8));
eq("dealer turned over A + K", st.dealer.cards, ["AH", "KD"]);
eq("p0 holds 20", BJ.handValue(st.seats[0].hands[0].cards).total, 20);
eq("dealer natural settles immediately", st.phase, "payout");
eq("no player ever got a turn", st.turn, null);
eq("p0 (20) loses to the natural", st.seats[0].hands[0].outcome, "lose");
eq("p1 (12) loses too", st.seats[1].hands[0].outcome, "lose");
eq("nothing is paid out", BJ.payoutsFor(st).length, 0);

console.log("\n— player BJ vs dealer BJ pushes —");
now = 8_000_000;
st = BJ.emptyState(lcg(9));
st = seatUp(st, 1, now);
st = beginHand(st, [["p0", 30]], ["AS", "AH", "KD", "10C"], now, lcg(9));
eq("push", st.seats[0].hands[0].outcome, "push");
eq("net zero", st.seats[0].hands[0].net, 0);
eq("stake comes back", BJ.payoutsFor(st)[0].amount, 30);

console.log("\n— turn timer auto-stands —");
now = 9_000_000;
st = BJ.emptyState(lcg(10));
st = seatUp(st, 2, now);
st = beginHand(st, [["p0", 10], ["p1", 10]], ["5S", "6H", "9D", "10C", "7S", "2D", "8H", "4C"], now, lcg(10));
eq("p0 is up", st.turn, { seat: 0, hand: 0 });
const beforeCards = st.seats[0].hands[0].cards.length;
st = BJ.tick(st, st.deadline, lcg(10)).state;  // p0's clock runs out
eq("p0 got no extra card", st.seats[0].hands[0].cards.length, beforeCards);
ok("p0's hand is closed", st.seats[0].hands[0].done);
ok("p0 did NOT bust from the timeout", !st.seats[0].hands[0].busted);
eq("turn passed to p1", st.turn, { seat: 1, hand: 0 });
st = BJ.tick(st, st.deadline, lcg(10)).state;  // p1's clock too
eq("table moved on to the dealer", st.phase, "dealer");
const finished = runOut(st, lcg(10));
ok("and the hand finishes on its own", finished.phase === "payout");

console.log("\n— stand up mid-hand does not hang the table —");
now = 10_000_000;
st = BJ.emptyState(lcg(11));
st = seatUp(st, 2, now);
st = beginHand(st, [["p0", 10], ["p1", 10]], ["5S", "6H", "9D", "10C", "7S", "2D", "8H", "4C"], now, lcg(11));
eq("p0 is up before leaving", st.turn, { seat: 0, hand: 0 });
const left = BJ.stand(st, "p0", now);
st = left.state;
ok("the leaver is flagged, seat still there for the hand", st.seats[0].leaving);
eq("turn handed straight to p1", st.turn, { seat: 1, hand: 0 });
eq("no refund mid-hand (the bet plays)", left.refund, null);
st = apply(BJ.stay(st, "p1", now), "stand p1");
st = runOut(st, lcg(11));
eq("hand resolved", st.phase, "payout");
ok("the leaver's hand was still scored", st.seats[0].hands[0].outcome !== null);
const paid = BJ.payoutsFor(st);
const settleTick = BJ.tick(st, st.deadline, lcg(11));
st = settleTick.state;
eq("their seat is freed at payout", st.seats[0], null);
ok("but their final balance was captured for the wallet",
   settleTick.wallets.some((w) => w.playerId === "p0"));
ok("the table reopened for betting", st.phase === "betting");
ok("winnings still credit a player who left", Array.isArray(paid));

console.log("\n— winnings land in the balance, and persist —");
now = 14_000_000;
st = BJ.emptyState(lcg(21));
st = seatUp(st, 1, now);
eq("wallet starts at $100", st.seats[0].balance, 100);
st = beginHand(st, [["p0", 20]], ["AS", "9H", "KD", "7C", "5S"], now, lcg(21));
eq("stake left the balance", st.seats[0].balance, 80);
st = runOut(st, lcg(21));
eq("blackjack scored", st.seats[0].hands[0].outcome, "blackjack");
const payTick = BJ.tick(st, st.deadline, lcg(21));
eq("balance = 80 + 20 stake + 30 win = 130", payTick.state.seats[0].balance, 130);
eq("and that absolute number is what gets persisted",
   payTick.wallets.find((w) => w.playerId === "p0").balance, 130);
eq("snapshot agrees", BJ.walletSnapshot(payTick.state), [{ playerId: "p0", balance: 130 }]);
const resync = BJ.syncBalances(payTick.state, { p0: 55 });
eq("a wallet resync overrides the mirror", resync.seats[0].balance, 55);

console.log("\n— leaving during betting refunds the bet —");
now = 11_000_000;
st = BJ.emptyState(lcg(12));
st = seatUp(st, 1, now);
st = BJ.sit(st, { seatIndex: 1, playerId: "p1", username: "P1", balance: 100 }, now).state;
st = apply(BJ.bet(st, "p0", 35, now), "bet");
eq("still in the betting window", st.phase, "betting");
const outNow = BJ.stand(st, "p0", now);
eq("bet refunded", outNow.refund, { playerId: "p0", amount: 35 });
eq("and the wallet is told the FINAL balance", outNow.wallets, [{ playerId: "p0", balance: 100 }]);
eq("seat freed at once", outNow.state.seats[0], null);
eq("the other seat keeps the table awake", outNow.state.phase, "betting");
const lastOut = BJ.stand(outNow.state, "p1", now);
eq("the last player leaving goes idle", lastOut.state.phase, "idle");

console.log("\n— an idle table never spins —");
st = BJ.emptyState(lcg(13));
eq("idle has no deadline", st.deadline, null);
const idleTick = BJ.tick(st, now + 10_000_000, lcg(13));
ok("ticking an idle table changes nothing", !idleTick.changed);

console.log("\n— everyone ready deals early —");
now = 12_000_000;
st = BJ.emptyState(lcg(14));
st = seatUp(st, 2, now);
st = apply(BJ.bet(st, "p0", 10, now), "bet p0");
st = apply(BJ.ready(st, "p0", now, lcg(14)), "ready p0");
eq("still betting while p1 thinks", st.phase, "betting");
ok("a locked-in bet cannot be changed", BJ.bet(st, "p0", 50, now).error === "already_in");
ok("Deal with no chips down is refused", BJ.ready(st, "p1", now, lcg(14)).error === "no_bet");
st = apply(BJ.bet(st, "p1", 10, now), "bet p1");
st = apply(BJ.ready(st, "p1", now, lcg(14)), "ready p1");
eq("both in -> deal starts without waiting", st.phase, "dealing");

console.log("\n— the wire hides the shoe and the hole card —");
now = 13_000_000;
st = BJ.emptyState(lcg(15));
st = seatUp(st, 1, now);
st = stack(st, ["5S", "6H", "9D", "KC"]);
st = apply(BJ.bet(st, "p0", 10, now), "bet");
st = apply(BJ.ready(st, "p0", now, lcg(15)), "ready"); // lone seat deals at once
eq("dealing, hole card face down", st.phase, "dealing");
const wire = BJ.toWire(st);
ok("no shoe on the wire", wire.shoe === undefined);
eq("hole card is a boolean, not a card", wire.dealer.hole, true);
eq("only the up card is sent", wire.dealer.cards, ["6H"]);
ok("wire JSON has no hidden card anywhere", !JSON.stringify(wire).includes("KC"));
eq("cardsLeft is a count only", typeof wire.cardsLeft, "number");

console.log("\n— reshuffle at the cut card —");
st = BJ.emptyState(lcg(16));
st.shoe = st.shoe.slice(0, 70); // 70/312 left => 77% spent, past the 75% cut
ok("shoe is past the cut", BJ.shoeSpent(st) >= BJ.PENETRATION);
st = seatUp(st, 1, now);
st = apply(BJ.bet(st, "p0", 10, now), "bet");
st = apply(BJ.ready(st, "p0", now, lcg(16)), "ready");
ok("a fresh shoe was cut in", st.shuffled);
ok("and it is full again (minus the deal)", st.shoe.length > 300);

console.log("\n— the route's step order pays winners (regression) —");
// The blackjack route re-seeds the mirrored balances from the
// wallet table, then ticks. Doing those two the other way round
// silently ate every payout in live testing: tick() credits the
// win into seat.balance, and a re-seed AFTER it overwrites that
// with the stale wallet row, which then gets persisted.
now = 15_000_000;
st = BJ.emptyState(lcg(31));
st = seatUp(st, 1, now);
st = beginHand(st, [["p0", 20]], ["AS", "9H", "KD", "7C", "5S"], now, lcg(31));
st = runOut(st, lcg(31));
eq("blackjack, ready to be paid", st.seats[0].hands[0].outcome, "blackjack");
// The wallet still holds the PRE-payout number: the stake left it
// when the bet was placed and the win has not been written yet.
const walletRow = { p0: st.seats[0].balance };
eq("wallet is mid-hand (stake already gone)", walletRow.p0, 80);

// RIGHT order: re-seed, then tick.
let right = BJ.syncBalances(st, walletRow);
right = BJ.tick(right, right.deadline, lcg(31)).state;
eq("right order pays 80 + 20 stake + 30 win = 130", right.seats[0].balance, 130);
eq("and that is what would be persisted", BJ.walletSnapshot(right), [{ playerId: "p0", balance: 130 }]);

// WRONG order: tick, then re-seed. Kept as an executable record
// of the bug, so nobody reintroduces it.
let wrong = BJ.tick(st, st.deadline, lcg(31)).state;
eq("tick alone credits correctly", wrong.seats[0].balance, 130);
wrong = BJ.syncBalances(wrong, walletRow);
eq("but re-seeding after the tick eats the win", wrong.seats[0].balance, 80);
ok("so the route must re-seed BEFORE it ticks", right.seats[0].balance > wrong.seats[0].balance);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
