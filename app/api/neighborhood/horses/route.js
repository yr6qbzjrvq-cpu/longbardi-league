import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood, sameOrigin } from "@/lib/neighborhoodAccess";
import {
  TABLE,
  PLAYER_ID_RE,
  activeBan,
  broadcastToRoom,
} from "@/lib/neighborhood/multiplayerServer";
import * as HR from "@/lib/neighborhood/horses";

export const dynamic = "force-dynamic";

// ============================================================
// POST /api/neighborhood/horses — HSPN Downs (milestone 24).
// ------------------------------------------------------------
// SERVER-AUTHORITATIVE, the same way the blackjack route is and
// for the same reason: clients cannot publish on the gameplay
// Realtime topic (RLS, supabase/neighborhood_realtime_auth.sql),
// so a race only exists because this route ran it. A client
// sends an INTENT ("$25 on horse 2"), never a result, and the
// winner never leaves this file until the gate has already
// opened — HR.toWire() strips `winner` and `seed` for exactly
// as long as they could be acted on.
//
// THE ORDER OF EVENTS IS THE FAIRNESS ARGUMENT. The winner is
// drawn uniformly at random when the BETTING WINDOW OPENS,
// before anybody has bet. It cannot depend on what the room
// puts its money on, because it already existed.
//
// WHY THERE IS NO CRON. Same answer as blackjack: Vercel
// functions do not run between requests, so the clock is
// pulled. Every client standing in a casino room posts `sync`
// on a timer and HR.tick() advances the meeting by comparing
// `now` to the deadline stored in the state. tick() is
// idempotent, so it does not matter who calls it or how often.
//
// CONCURRENCY. Read (state, version) → compute → write
// `where version = <what we read>`. Zero rows updated means
// somebody else got there first; re-read and retry. Exactly
// one lambda therefore settles a race, which is what stops a
// winner being paid twice.
//
// MONEY. Play money, and only play money. The SAME wallet as
// the blackjack table (neighborhood_wallets) — one bankroll per
// player for the whole casino. A stake is debited the moment
// the bet lands and a winner is credited PAYOUT_MULT times it
// at the wire. Both movements are single atomic SQL updates
// (neighborhood_wallet_delta), never a read-then-write, so two
// tabs cannot spend the same $10 twice.
// ============================================================

const TABLE_ID = "casino-floor:track";
const CASINO_FLOOR = "casino-floor";
const CASINO_STRIP = "casino-strip";
const CASINO_ROOMS = new Set([CASINO_FLOOR, CASINO_STRIP]);
const WALLETS = "neighborhood_wallets";
const RACES = "neighborhood_horse_races";
const MAX_ATTEMPTS = 4;

const ACTIONS = new Set(["sync", "bet"]);

// The seed for a race comes off the same crypto source the
// blackjack shoe is shuffled with, not Math.random: the whole
// point of hiding the seed during the betting window is lost if
// it can be guessed from the last one.
function cryptoRng() {
  const buf = new Uint32Array(64);
  let i = buf.length;
  return () => {
    if (i >= buf.length) {
      globalThis.crypto.getRandomValues(buf);
      i = 0;
    }
    return buf[i++] / 4294967296;
  };
}

function fail(message, code, status) {
  return NextResponse.json({ error: message, code }, { status });
}

async function readMeeting(supabase, rng, now) {
  const { data, error } = await supabase
    .from(RACES)
    .select("state, version")
    .eq("id", TABLE_ID)
    .maybeSingle();
  if (error) throw error;
  if (data && data.state) return { state: data.state, version: Number(data.version) || 0 };
  const fresh = HR.emptyState(rng, now);
  const { error: insErr } = await supabase
    .from(RACES)
    .insert({ id: TABLE_ID, state: fresh, version: 0 });
  if (insErr) {
    // A parallel lambda got there first — re-read rather than
    // fight it.
    const { data: again } = await supabase
      .from(RACES)
      .select("state, version")
      .eq("id", TABLE_ID)
      .maybeSingle();
    if (again && again.state) {
      return { state: again.state, version: Number(again.version) || 0 };
    }
    throw insErr;
  }
  return { state: fresh, version: 0 };
}

// Optimistic write. True means we won the race to move the row.
async function writeMeeting(supabase, version, state) {
  const { data, error } = await supabase
    .from(RACES)
    .update({ state, version: version + 1, updated_at: new Date().toISOString() })
    .eq("id", TABLE_ID)
    .eq("version", version)
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function balanceOf(supabase, playerId) {
  const { data } = await supabase.from(WALLETS).select("balance").eq("id", playerId).maybeSingle();
  return data ? Number(data.balance) || 0 : null;
}

// One atomic +/- on a wallet. Returns the new balance, or null
// when the row does not exist or the money is not there.
async function walletDelta(supabase, playerId, delta) {
  const { data, error } = await supabase.rpc("neighborhood_wallet_delta", {
    p_id: playerId,
    p_delta: delta,
  });
  if (error) throw error;
  return data === null || data === undefined ? null : Number(data);
}

// Pay the winners of a race this request just settled. Only
// ever called by the lambda that WON the version guard, so
// nobody is paid twice.
async function payWinners(supabase, credits) {
  for (const c of credits || []) {
    if (!c || !c.playerId || !(c.amount > 0)) continue;
    try {
      await walletDelta(supabase, c.playerId, Math.round(c.amount));
    } catch {
      // A dropped credit is a lost payout, not a corrupted one.
      // Better to finish paying the rest of the field.
    }
  }
}

export async function POST(request) {
  if (!(await canSeeNeighborhood())) {
    return fail("Not found.", "not_found", 404);
  }
  if (!sameOrigin(request)) {
    return fail("Bad origin.", "bad_origin", 403);
  }
  try {
    const supabase = getAdminClient();
    if (!supabase) {
      return fail("Multiplayer is not configured.", "not_configured", 503);
    }

    const body = await request.json();
    const playerId = String(body.playerId || "");
    if (!PLAYER_ID_RE.test(playerId)) {
      return fail("Bad player id.", "bad_player", 400);
    }
    const action = String(body.action || "");
    if (!ACTIONS.has(action)) {
      return fail("Unknown action.", "bad_action", 400);
    }

    // Must be a real player, standing in the casino, not banned.
    // The same three checks /move, /throw and /blackjack make.
    const { data: row, error: readErr } = await supabase
      .from(TABLE)
      .select("id, username, room, kicked_until")
      .eq("id", playerId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row) return fail("Join the room first.", "not_joined", 404);
    const ban = activeBan(row);
    if (ban) return fail(ban.message, "kicked", 403);
    if (!CASINO_ROOMS.has(row.room)) {
      return fail("You're not in the casino.", "wrong_room", 403);
    }
    // You can watch a race from the strip, but the betting
    // window is inside, at the window.
    if (action === "bet" && row.room !== CASINO_FLOOR) {
      return fail("The betting window is inside.", "wrong_room", 403);
    }

    const now = Date.now();
    const rng = cryptoRng();

    // ---- rate limit ----------------------------------------
    // `sync` is deliberately free: every client in the room
    // calls it, and it is what makes the clock move at all.
    if (action === "bet") {
      const { data: gate, error: gateErr } = await supabase.rpc("neighborhood_record_horse", {
        p_id: playerId,
        p_now_ms: now,
      });
      if (gateErr) {
        const missing =
          gateErr.code === "42883" ||
          gateErr.code === "PGRST202" ||
          /could not find the function|does not exist/i.test(gateErr.message || "");
        // The one-bet-per-race rule in the engine is the real
        // limit here; this is anti-spam. A missing function is
        // not worth refusing a bet over.
        if (!missing) throw gateErr;
      } else if (gate === "rate_limited") {
        return fail("Easy — one at a time.", "rate_limited", 429);
      } else if (gate === "not_joined") {
        return fail("Join the room first.", "not_joined", 404);
      }
    }

    let amount = 0;
    let horse = -1;
    if (action === "bet") {
      amount = Number(body.amount);
      horse = Number(body.horse);
      if (!Number.isInteger(amount) || amount < HR.MIN_BET || amount > HR.MAX_BET) {
        return fail(`Bets are $${HR.MIN_BET}–$${HR.MAX_BET}.`, "bad_amount", 400);
      }
      if (!Number.isInteger(horse) || horse < 0 || horse >= HR.HORSE_COUNT) {
        return fail("That horse isn't in this race.", "bad_horse", 400);
      }
    }

    // ---- read, advance, act, write -------------------------
    let lastError = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const { state: stored, version } = await readMeeting(supabase, rng, now);

      // 1. Run the clock forward. This is where a race is
      //    settled and where the credits for it come from.
      const ticked = HR.tick(stored, now, rng);
      let state = ticked.state;
      const credits = ticked.credits || [];

      // 2. The bet itself, against the state AFTER the clock —
      //    so a bet that arrived a beat late meets a closed
      //    window rather than the one it was aiming at.
      let placed = null;
      if (action === "bet") {
        const bal = await balanceOf(supabase, playerId);
        if (bal === null) {
          return fail("Walk into the casino first.", "no_wallet", 409);
        }
        if (bal < amount) {
          return NextResponse.json(
            {
              ok: false,
              code: "insufficient",
              error: "Not enough chips for that.",
              race: HR.toWire(state),
              balance: bal,
              serverNow: now,
            },
            { status: 409 }
          );
        }
        placed = HR.placeBet(
          state,
          { playerId, username: row.username, horse, amount },
          now
        );
        if (placed.error) {
          // A refused bet still owes the caller the truth about
          // the board — their button was stale, not evil.
          return NextResponse.json(
            {
              ok: false,
              code: placed.error,
              error: reasonFor(placed.error),
              race: HR.toWire(state),
              balance: bal,
              serverNow: now,
            },
            { status: 409 }
          );
        }
        state = placed.state;
      }

      const changed = ticked.changed || !!placed;
      if (!changed) {
        // Nothing moved: don't burn a write or a broadcast.
        return NextResponse.json({
          ok: true,
          race: HR.toWire(state),
          balance: await balanceOf(supabase, playerId),
          serverNow: now,
        });
      }

      const won = await writeMeeting(supabase, version, state);
      if (!won) {
        lastError = "contended";
        continue; // somebody else moved the board; re-read
      }

      // 3. Money, only ever after the write we won. Winners
      //    first: a settled race that failed to pay would be
      //    the one unforgivable bug in here.
      await payWinners(supabase, credits);

      let balance = null;
      if (placed) {
        // Take the stake. Atomic and floored at zero in SQL, so
        // the only way this refuses is that the money genuinely
        // went somewhere else between the check above and here
        // (a blackjack bet in another tab). In that case the bet
        // comes straight back off the board.
        balance = await walletDelta(supabase, playerId, -amount);
        if (balance === null) {
          const undone = HR.cancelBet(state, playerId);
          for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
            const cur = await readMeeting(supabase, rng, now);
            const back = HR.cancelBet(cur.state, playerId);
            if (!back.changed) break;
            if (await writeMeeting(supabase, cur.version, back.state)) break;
          }
          await broadcastToRoom(CASINO_FLOOR, "horses", HR.toWire(undone.state));
          return NextResponse.json(
            {
              ok: false,
              code: "insufficient",
              error: "Not enough chips for that.",
              race: HR.toWire(undone.state),
              balance: await balanceOf(supabase, playerId),
              serverNow: now,
            },
            { status: 409 }
          );
        }
      } else {
        balance = await balanceOf(supabase, playerId);
      }

      const wire = HR.toWire(state);
      await broadcastToRoom(CASINO_FLOOR, "horses", wire);

      return NextResponse.json({
        ok: true,
        race: wire,
        balance,
        serverNow: now,
      });
    }

    return fail("The board is busy — try that again.", lastError || "busy", 503);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Engine error codes are terse on purpose; the player gets a
// sentence.
function reasonFor(code) {
  switch (code) {
    case "closed":
      return "Betting is closed for this race.";
    case "already_bet":
      return "You've already got money on this race.";
    case "bad_horse":
      return "That horse isn't in this race.";
    case "bad_amount":
      return `Bets are $${HR.MIN_BET}–$${HR.MAX_BET}.`;
    default:
      return "That bet isn't allowed right now.";
  }
}
