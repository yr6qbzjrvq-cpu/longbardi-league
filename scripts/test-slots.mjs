// Rules harness for lib/neighborhood/slots.js.
// Run: node scripts/test-slots.mjs
import * as S from "../lib/neighborhood/slots.js";

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

console.log("\n-- the machine --");
eq("three bets, $1/$5/$10", S.BETS, [1, 5, 10]);
eq("four second spin", S.SPIN_MS, 4000);
eq("seven symbols", S.SYMBOL_COUNT, 7);
ok("head is symbol 0 and is the jackpot symbol", S.HEAD === 0 && S.SYMBOLS[0].isHead === true && S.SYMBOLS[0].img === "/neighborhood/slot-head.webp");
ok("six non-head symbols, all with a glyph", S.NON_HEAD_COUNT === 6 && S.NON_HEAD.every((i) => S.SYMBOLS[i].glyph && !S.SYMBOLS[i].isHead));
eq("weights total 10000", S.WEIGHT_TOTAL, 10000);

console.log("\n-- the paytable (what Austin asked for) --");
eq("jackpot pays 50x", S.JACKPOT_MULT, 50);
eq("triple pays 5x", S.TRIPLE_MULT, 5);
eq("two heads pays 2x", S.TWO_HEAD_MULT, 2);
eq("$1 jackpot = $50", S.payoutFor("jackpot", 1), 50);
eq("$5 jackpot = $250", S.payoutFor("jackpot", 5), 250);
eq("$10 jackpot = $500 (the grand prize)", S.payoutFor("jackpot", 10), 500);
eq("$1 triple = $5", S.payoutFor("triple", 1), 5);
eq("$10 triple = $50", S.payoutFor("triple", 10), 50);
eq("$1 two-heads = $2", S.payoutFor("two_heads", 1), 2);
eq("$10 two-heads = $20", S.payoutFor("two_heads", 10), 20);
eq("a loss pays $0", S.payoutFor("lose", 10), 0);
eq("GRAND_PRIZE_MAX is $500", S.GRAND_PRIZE_MAX, 500);
ok("every prize at every bet is a whole dollar", S.payTable().rows.every((r) => r.prizes.every((p) => Number.isInteger(p))));

console.log("\n-- the jackpot chance is EXACTLY 1% --");
eq("JACKPOT_CHANCE", S.JACKPOT_CHANCE, 0.01);
{
  // Empirical: roll a big sample against a deterministic RNG and
  // confirm the jackpot rate lands on ~1%.
  const rng = lcg(0xC0FFEE);
  const N = 500000;
  const count = { jackpot: 0, triple: 0, two_heads: 0, lose: 0 };
  for (let i = 0; i < N; i += 1) count[S.rollSpin(rng).category] += 1;
  const jp = count.jackpot / N;
  const tr = count.triple / N;
  const th = count.two_heads / N;
  ok(`jackpot ~1% (${(jp * 100).toFixed(3)}%)`, Math.abs(jp - 0.01) < 0.0015, { jp });
  ok(`triple ~6% (${(tr * 100).toFixed(3)}%)`, Math.abs(tr - 0.06) < 0.003, { tr });
  ok(`two-heads ~5% (${(th * 100).toFixed(3)}%)`, Math.abs(th - 0.05) < 0.003, { th });
}

console.log("\n-- the painted reels always read as the rolled category --");
{
  const rng = lcg(0x1234);
  let good = true;
  let bad = null;
  for (let i = 0; i < 200000; i += 1) {
    const spin = S.rollSpin(rng);
    if (S.classify(spin.reels) !== spin.category) { good = false; bad = spin; break; }
  }
  ok("200000 spins: classify(reels) === category (a loss never shows a win, a win always shows its line)", good, bad);
}
{
  // The jackpot line is literally three heads.
  const rng = lcg(1);
  eq("jackpot reels are [0,0,0]", S.reelsFor("jackpot", rng), [0, 0, 0]);
  // A triple is three of one non-head symbol.
  const t = S.reelsFor("triple", lcg(2));
  ok("triple reels are three matching non-head symbols", t[0] === t[1] && t[1] === t[2] && t[0] !== S.HEAD);
  // Two-heads is exactly two heads.
  let allTwo = true;
  for (let i = 0; i < 1000; i += 1) {
    const r = S.reelsFor("two_heads", lcg(1000 + i));
    if (r.filter((x) => x === S.HEAD).length !== 2) { allTwo = false; break; }
  }
  ok("two_heads reels always have exactly two heads", allTwo);
}

console.log("\n-- RTP is a sane 90% --");
{
  const theo = S.rtp();
  ok(`theoretical RTP = 0.90 (${theo.toFixed(4)})`, Math.abs(theo - 0.90) < 1e-9, { theo });
  ok("RTP is in the friendly 85-95% band", theo >= 0.85 && theo <= 0.95);
  // Empirical dollars: play $1 a spin over a big sample and
  // confirm the return-per-dollar lands near 0.90.
  const rng = lcg(0xBEEF);
  const N = 500000;
  let wagered = 0;
  let returned = 0;
  for (let i = 0; i < N; i += 1) {
    wagered += 1;
    returned += S.payoutFor(S.rollSpin(rng).category, 1);
  }
  const emp = returned / wagered;
  ok(`empirical RTP ~0.90 (${emp.toFixed(4)})`, Math.abs(emp - 0.90) < 0.03, { emp });
}

console.log("\n-- bet validation --");
ok("$1/$5/$10 are valid", S.isValidBet(1) && S.isValidBet(5) && S.isValidBet(10));
ok("$0/$2/$7/$100/'5' are not", !S.isValidBet(0) && !S.isValidBet(2) && !S.isValidBet(7) && !S.isValidBet(100) && !S.isValidBet("5"));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
