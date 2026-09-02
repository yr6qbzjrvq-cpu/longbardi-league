// ============================================================
// HSPNeighborhood — client-side dealing choreography (m20)
// ------------------------------------------------------------
// The server resolves a deal or a draw ATOMICALLY and
// broadcasts the finished state; this module is the theater on
// top. It diffs each broadcast against the last one it saw and
// turns "six cards appeared" into "six cards slide out of the
// shoe, one at a time, in casino order": first card to each
// player in seat order, then the dealer's up card; second card
// around, then the hole card face down. Hits, doubles, split
// cards and the dealer's playout get the same one-card slide,
// and the hole card turns over with a flip.
//
// Nothing here decides anything, and nothing here ever
// invents a card. The animator only HIDES a card the server
// has already dealt, for a few hundred milliseconds — the
// drawn state always converges to the wire, and once the queue
// is empty (frame() returns null) the felt is exactly the
// plain wire again. Scheduling runs on Date.now(), not the rAF
// clock, so a hidden tab (where rAF freezes but the wall clock
// does not) simply finds every event finished when it wakes
// up: it snaps to the current state, it never replays a stale
// queue. Every client sees the same wire transitions, so every
// client schedules the same sequence.
// ============================================================

export const DEAL_STEP_MS = 240; // launch-to-launch stagger on the opening deal
export const FLIGHT_MS = 300; // one card's trip from shoe to felt
export const FLIP_MS = 380; // the hole card turning over
export const DRAW_STEP_MS = 300; // stagger when one action lands several cards

export const DEALER_KEY = "d";
const keyOf = (si, hi) => `s${si}h${hi}`;

// Cards a target is showing in a wire state. The dealer's hole
// card counts as a card — it has a position in the fan — so
// the opening deal schedules it like any other, just face down.
function countsOf(wire) {
  const map = new Map();
  if (!wire) return map;
  const d = wire.dealer || {};
  map.set(DEALER_KEY, (d.cards || []).length + (d.hole ? 1 : 0));
  (wire.seats || []).forEach((seat, si) => {
    if (!seat) return;
    (seat.hands || []).forEach((hand, hi) => {
      map.set(keyOf(si, hi), (hand.cards || []).length);
    });
  });
  return map;
}

export function createDealAnimator() {
  let prev = null; // the last wire we diffed against
  let prevCounts = new Map();
  // key -> [{ index, t0, dur, kind: "slide" | "flip" }],
  // pushed in index order per key.
  let events = new Map();

  function push(key, index, t0, dur, kind) {
    let list = events.get(key);
    if (!list) {
      list = [];
      events.set(key, list);
    }
    list.push({ index, t0, dur, kind });
  }

  // Feed every table state the room applies through here —
  // broadcasts, route replies and sync pulses alike. Applying
  // the same state twice is a no-op (the counts match), so the
  // 2.5s sync heartbeat never re-triggers a deal.
  function update(wire, hidden) {
    const now = Date.now();
    const counts = countsOf(wire);
    if (!wire || !prev || hidden) {
      // First sight of the table, a reload, or a hidden tab:
      // no theater, just the truth.
      events = new Map();
      prev = wire;
      prevCounts = counts;
      return;
    }

    if (wire.handNo !== prev.handNo) {
      // A fresh hand. If we caught it at the deal, run the
      // full casino order; if we missed the deal broadcast
      // (slept through it), snap.
      events = new Map();
      if (wire.phase === "dealing") {
        let t = now;
        for (let round = 0; round < 2; round += 1) {
          for (let si = 0; si < (wire.seats || []).length; si += 1) {
            const seat = wire.seats[si];
            const hand = seat && seat.hands && seat.hands[0];
            if (!seat || !(seat.bet > 0) || !hand) continue;
            if ((hand.cards || []).length <= round) continue;
            push(keyOf(si, 0), round, t, FLIGHT_MS, "slide");
            t += DEAL_STEP_MS;
          }
          push(DEALER_KEY, round, t, FLIGHT_MS, "slide");
          t += DEAL_STEP_MS;
        }
      }
      prev = wire;
      prevCounts = counts;
      return;
    }

    // Same hand: something moved. Later launches queue behind
    // earlier ones so a multi-card transition still deals one
    // card at a time.
    let t = now;

    (wire.seats || []).forEach((seat, si) => {
      const prevSeat = (prev.seats || [])[si];
      if (!seat || !prevSeat || prevSeat.playerId !== seat.playerId) {
        // A chair emptied or changed hands — nothing to deal.
        for (let hi = 0; hi < 8; hi += 1) events.delete(keyOf(si, hi));
        return;
      }
      const nHands = (seat.hands || []).length;
      const pHands = (prevSeat.hands || []).length;
      if (nHands > pHands && pHands >= 1) {
        // A split: the two halves re-lay instantly (that is
        // the "cards separating" read), then each half that
        // just drew its second card receives it from the shoe.
        for (let hi = 0; hi < nHands; hi += 1) events.delete(keyOf(si, hi));
        const idx =
          prev.turn && prev.turn.seat === si
            ? Math.min(prev.turn.hand, nHands - 2)
            : 0;
        for (const hi of [idx, idx + 1]) {
          const hand = seat.hands[hi];
          if (hand && (hand.cards || []).length === 2) {
            push(keyOf(si, hi), 1, t, FLIGHT_MS, "slide");
            t += DRAW_STEP_MS;
          }
        }
        return;
      }
      for (let hi = 0; hi < Math.max(nHands, pHands); hi += 1) {
        const key = keyOf(si, hi);
        const n = hi < nHands ? (seat.hands[hi].cards || []).length : 0;
        const p =
          prevSeat.hands && prevSeat.hands[hi]
            ? (prevSeat.hands[hi].cards || []).length
            : 0;
        if (n > p && p > 0) {
          // A hit or a double — one slide per new card.
          for (let ci = p; ci < n; ci += 1) {
            push(key, ci, t, FLIGHT_MS, "slide");
            t += DRAW_STEP_MS;
          }
        } else if (n < p || n === 0) {
          // The felt was cleared (next hand) — snap.
          events.delete(key);
        }
      }
    });

    const pd = prev.dealer || {};
    const nd = wire.dealer || {};
    const pCount = prevCounts.get(DEALER_KEY) || 0;
    const nCount = counts.get(DEALER_KEY) || 0;
    if (pd.hole && !nd.hole && (nd.cards || []).length >= 2) {
      // The hole card turns over where it lies, then any cards
      // the dealer drew in the same broadcast slide in after.
      events.delete(DEALER_KEY);
      push(DEALER_KEY, 1, t, FLIP_MS, "flip");
      t += FLIP_MS;
      for (let ci = 2; ci < (nd.cards || []).length; ci += 1) {
        push(DEALER_KEY, ci, t, FLIGHT_MS, "slide");
        t += DRAW_STEP_MS;
      }
    } else if (nCount > pCount && pCount > 0) {
      for (let ci = pCount; ci < nCount; ci += 1) {
        push(DEALER_KEY, ci, t, FLIGHT_MS, "slide");
        t += DRAW_STEP_MS;
      }
    } else if (nCount < pCount) {
      events.delete(DEALER_KEY);
    }

    prev = wire;
    prevCounts = counts;
  }

  // One per drawn frame. Returns null when nothing is playing
  // — the fast path, and the guarantee that the settled felt
  // is the plain wire. Otherwise returns per-target queries
  // the table view uses while it paints.
  function frame() {
    const now = Date.now();
    for (const [key, list] of events) {
      const left = list.filter((e) => now < e.t0 + e.dur);
      if (left.length === 0) events.delete(key);
      else if (left.length !== list.length) events.set(key, left);
    }
    if (events.size === 0) return null;

    const q = (key, total) => {
      const list = events.get(key);
      if (!list || list.length === 0) return { show: total, flight: null };
      let first = list[0];
      for (const e of list) if (e.index < first.index) first = e;
      const show = Math.max(0, Math.min(total, first.index));
      const p = (now - first.t0) / first.dur;
      if (p < 0) return { show, flight: null }; // still in the shoe
      return {
        show,
        flight: { index: first.index, p: Math.min(1, p), kind: first.kind },
      };
    };

    return {
      hand: (si, hi, total) => q(keyOf(si, hi), total),
      dealer: (total) => q(DEALER_KEY, total),
      handSettled: (si, hi) => !events.has(keyOf(si, hi)),
      dealerSettled: () => !events.has(DEALER_KEY),
      allSettled: () => events.size === 0,
    };
  }

  return { update, frame };
}
