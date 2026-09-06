// Rules harness for lib/neighborhood/horses.js.
// Run: node scripts/test-horses.mjs
import * as H from "../lib/neighborhood/horses.js";

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("  ok   " + name); }
  else { fail += 1; console.log("  FAIL " + name + (extra ? "  << " + JSON.stringify(extra) : "")); }
}
function eq(name, a, b) {
  ok(name + ` (${JSON.stringify(a)} === ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
}
// A deterministic RNG so any failure is reproducible.
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

console.log("\n-- the field --");
eq("four horses", H.HORSE_COUNT, 4);
ok("every horse has a name and a colour", H.HORSES.every((h, i) => h.id === i && h.name && /^#[0-9a-f]{6}$/i.test(h.color)));
eq("payout is a 4x total return", H.PAYOUT_MULT, 4);

console.log("\n-- the race is decided by the server, not the seed --");
{
  let allWin = true;
  for (let w = 0; w < 4; w += 1) {
    for (let s = 1; s <= 400; s += 1) {
      const r = H.buildRace(s * 2654435761 >>> 0, w);
      if (r.order[0] !== w) { allWin = false; console.log("   seed", s, "winner", w, "order", r.order); break; }
    }
  }
  ok("the designated winner wins every one of 1600 races", allWin);
}
{
  // The winner crosses first at the WIRE, and is in front on the
  // final frame the animation can draw.
  let good = true;
  for (let s = 1; s <= 300; s += 1) {
    const seed = (s * 40503) >>> 0;
    const w = s % 4;
    const r = H.buildRace(seed, w);
    const at1 = H.progressAt(r, 1);
    for (let i = 0; i < 4; i += 1) if (i !== w && at1[i] > at1[w]) good = false;
    if (r.finish.some((f, i) => i !== w && f <= r.finish[w])) good = false;
  }
  ok("no dead heats and the winner leads on the last frame", good);
}

console.log("\n-- the race is dramatic --");
{
  let leadChanges = 0;
  let closeFinishes = 0;
  let comeFromBehind = 0;
  const N = 300;
  for (let s = 1; s <= N; s += 1) {
    const seed = (s * 2246822519) >>> 0;
    const w = s % 4;
    const r = H.buildRace(seed, w);
    let leader = -1;
    let changes = 0;
    for (let k = 1; k <= 60; k += 1) {
      const p = H.progressAt(r, k / 60);
      let best = 0;
      for (let i = 1; i < 4; i += 1) if (p[i] > p[best]) best = i;
      if (leader !== -1 && best !== leader) changes += 1;
      leader = best;
    }
    if (changes > 0) leadChanges += 1;
    // margin at the wire, in sample units
    const sorted = [...r.finish].sort((a, b) => a - b);
    if (sorted[1] - sorted[0] < 3) closeFinishes += 1;
    // was the winner out of the lead at halfway?
    const half = H.progressAt(r, 0.5);
    let bestHalf = 0;
    for (let i = 1; i < 4; i += 1) if (half[i] > half[bestHalf]) bestHalf = i;
    if (bestHalf !== w) comeFromBehind += 1;
  }
  console.log(`   lead changes in ${leadChanges}/${N}, close finishes ${closeFinishes}/${N}, winner not leading at halfway ${comeFromBehind}/${N}`);
  ok("most races change the lead at least once", leadChanges > N * 0.6, { leadChanges, N });
  ok("plenty of races are decided late", closeFinishes > N * 0.15, { closeFinishes, N });
  ok("the winner is often behind at halfway", comeFromBehind > N * 0.28, { comeFromBehind, N });
}
{
  const r = H.buildRace(123456789, 2);
  const at0 = H.progressAt(r, 0);
  ok("everybody starts at the gate", at0.every((p) => p === 0));
  let monotone = true;
  let prev = H.progressAt(r, 0);
  for (let k = 1; k <= 200; k += 1) {
    const p = H.progressAt(r, k / 200);
    for (let i = 0; i < 4; i += 1) if (p[i] < prev[i] - 1e-12) monotone = false;
    prev = p;
  }
  ok("no horse ever runs backwards", monotone);
  ok("every horse is home by the end of the window", H.progressAt(r, 1).every((p) => p >= 1));
}
{
  // Bit-for-bit repeatability is the whole trust story for the
  // animation: two browsers must compute the identical numbers.
  const a = H.buildRace(987654321, 1);
  const b = H.buildRace(987654321, 1);
  let same = true;
  for (let k = 0; k <= 100; k += 1) {
    const pa = H.progressAt(a, k / 100);
    const pb = H.progressAt(b, k / 100);
    for (let i = 0; i < 4; i += 1) if (pa[i] !== pb[i]) same = false;
  }
  ok("the same (seed, winner) is the same race to the last bit", same);
  ok("a different seed is a different race", JSON.stringify(H.progressAt(H.buildRace(987654322, 1), 0.5)) !== JSON.stringify(H.progressAt(a, 0.5)));
}

console.log("\n-- the clock --");
{
  const rng = lcg(7);
  const t0 = 1_000_000;
  const s0 = H.emptyState(rng, t0);
  eq("opens on a betting window", s0.phase, "betting");
  eq("betting closes after BET_MS", s0.deadline, t0 + H.BET_MS);
  ok("a winner exists before anybody has bet", Number.isInteger(s0.winner) && s0.winner >= 0 && s0.winner < 4);
  const wire0 = H.toWire(s0);
  eq("the wire hides the winner while betting", wire0.winner, null);
  eq("the wire hides the seed while betting", wire0.seed, null);
  ok("the wire JSON cannot be mined for the winner", !JSON.stringify(wire0).includes(String(s0.seed)));

  const a = H.tick(s0, t0 + 1000, rng);
  eq("nothing happens mid-window", a.changed, false);

  const b = H.tick(s0, t0 + H.BET_MS, rng);
  eq("the gate opens on time", b.state.phase, "running");
  eq("the race lasts RACE_MS", b.state.deadline, t0 + H.BET_MS + H.RACE_MS);
  const wire1 = H.toWire(b.state);
  eq("the wire hands over the winner once the gate opens", wire1.winner, s0.winner);
  eq("...and the seed with it", wire1.seed, s0.seed);
  eq("the race id did not change when the gate opened", b.state.raceId, s0.raceId);

  const c = H.tick(b.state, t0 + H.BET_MS + H.RACE_MS, rng);
  eq("results follow the race", c.state.phase, "results");
  const d = H.tick(c.state, t0 + H.CYCLE_MS, rng);
  eq("and then a new betting window", d.state.phase, "betting");
  eq("with a new race id", d.state.raceId, s0.raceId + 1);
  ok("and a new seed", d.state.seed !== s0.seed);
  eq("the deadlines never drift", d.state.deadline, t0 + H.CYCLE_MS + H.BET_MS);
  ok("last race is remembered into the next window", d.state.last && d.state.last.raceId === s0.raceId);
}
{
  // Nobody in the room for eleven minutes.
  const rng = lcg(11);
  const t0 = 5_000_000;
  const s0 = H.emptyState(rng, t0);
  const jumped = H.tick(s0, t0 + 11 * 60_000, rng);
  eq("a long-empty room lands on a fresh betting window", jumped.state.phase, "betting");
  ok("...that is not already expired", jumped.state.deadline > t0 + 11 * 60_000);
  ok("...and did not replay eleven minutes of racing", jumped.state.raceId <= s0.raceId + 7, { raceId: jumped.state.raceId });
}

console.log("\n-- betting --");
{
  const rng = lcg(3);
  const t0 = 2_000_000;
  let s = H.emptyState(rng, t0);
  const winner = s.winner;
  const loser = (winner + 1) % 4;

  eq("a bet below the minimum is refused", H.placeBet(s, { playerId: "p1", username: "Ann", horse: 0, amount: 4 }, t0).error, "bad_amount");
  eq("a bet above the maximum is refused", H.placeBet(s, { playerId: "p1", username: "Ann", horse: 0, amount: 101 }, t0).error, "bad_amount");
  eq("half a dollar is refused", H.placeBet(s, { playerId: "p1", username: "Ann", horse: 0, amount: 10.5 }, t0).error, "bad_amount");
  eq("a fifth horse is refused", H.placeBet(s, { playerId: "p1", username: "Ann", horse: 4, amount: 10 }, t0).error, "bad_horse");
  eq("a negative horse is refused", H.placeBet(s, { playerId: "p1", username: "Ann", horse: -1, amount: 10 }, t0).error, "bad_horse");

  s = H.placeBet(s, { playerId: "p1", username: "Ann", horse: winner, amount: 10 }, t0).state;
  s = H.placeBet(s, { playerId: "p2", username: "Bo", horse: loser, amount: 10 }, t0).state;
  eq("two players are on the same race", H.toWire(s).bets.length, 2);
  eq("the pot is the sum of the stakes", H.potOf(s), 20);
  eq("one bet per player per race", H.placeBet(s, { playerId: "p1", username: "Ann", horse: loser, amount: 5 }, t0).error, "already_bet");
  eq("...even on the same horse", H.placeBet(s, { playerId: "p1", username: "Ann", horse: winner, amount: 5 }, t0).error, "already_bet");

  const started = H.tick(s, t0 + H.BET_MS, rng).state;
  eq("betting closes when the gate opens", H.placeBet(started, { playerId: "p3", username: "Cy", horse: 0, amount: 10 }, t0 + H.BET_MS + 1).error, "closed");
  eq("...and a bet on the last tick of the window is closed too", H.placeBet(s, { playerId: "p3", username: "Cy", horse: 0, amount: 10 }, t0 + H.BET_MS).error, "closed");

  const done = H.tick(started, t0 + H.BET_MS + H.RACE_MS, rng);
  eq("only the winner is credited", done.credits.length, 1);
  eq("...and it is the player who backed the winner", done.credits[0].playerId, "p1");
  eq("$10 on the winner returns $40", done.credits[0].amount, 40);
  const res = done.state.last.results;
  eq("the loser is credited nothing", res.find((r) => r.playerId === "p2").payout, 0);
  eq("the results name the winning horse", done.state.last.winner, winner);
  eq("first place in the finishing order is the winner", done.state.last.order[0], winner);
  eq("all four horses are placed", [...done.state.last.order].sort().join(""), "0123");
}
{
  // The exact money question, spelled out with real numbers.
  const rng = lcg(99);
  const t0 = 9_000_000;
  let s = H.emptyState(rng, t0);
  const w = s.winner;
  s = H.placeBet(s, { playerId: "win", username: "W", horse: w, amount: 25 }, t0).state;
  s = H.placeBet(s, { playerId: "lose", username: "L", horse: (w + 2) % 4, amount: 25 }, t0).state;
  const out = H.tick(H.tick(s, t0 + H.BET_MS, rng).state, t0 + H.BET_MS + H.RACE_MS, rng);
  const credit = out.credits.find((c) => c.playerId === "win");
  eq("$25 on the winner is credited $100", credit.amount, 100);
  ok("net on a winning $25 bet is +$75 (100 back, 25 already debited)", credit.amount - 25 === 75);
  ok("net on a losing $25 bet is -$25", !out.credits.find((c) => c.playerId === "lose"));
}
{
  const rng = lcg(5);
  const t0 = 3_000_000;
  let s = H.emptyState(rng, t0);
  s = H.placeBet(s, { playerId: "p1", username: "Ann", horse: 0, amount: 20 }, t0).state;
  const back = H.cancelBet(s, "p1");
  eq("a refused debit takes the bet back off the board", H.potOf(back.state), 0);
  eq("...and says so", back.changed, true);
  eq("cancelling a bet nobody made is a no-op", H.cancelBet(s, "nobody").changed, false);
  eq("bets survive into the running phase", H.toWire(H.tick(s, t0 + H.BET_MS, rng).state).bets.length, 1);
}
{
  // tick() must be idempotent: the whole pulled-clock design
  // rests on it.
  const rng = lcg(21);
  const t0 = 4_000_000;
  let s = H.emptyState(rng, t0);
  s = H.placeBet(s, { playerId: "p1", username: "Ann", horse: s.winner, amount: 15 }, t0).state;
  const at = t0 + H.BET_MS + H.RACE_MS + 10;
  const a = H.tick(s, at, lcg(21));
  const b = H.tick(a.state, at, lcg(21));
  eq("a second tick at the same instant changes nothing", b.changed, false);
  eq("...and pays nobody twice", b.credits.length, 0);
  eq("the first tick paid once", a.credits.length, 1);
  eq("...the right amount", a.credits[0].amount, 60);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
