import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood, sameOrigin } from "@/lib/neighborhoodAccess";
import {
  TABLE,
  PLAYER_ID_RE,
  activeBan,
} from "@/lib/neighborhood/multiplayerServer";
import * as SLOTS from "@/lib/neighborhood/slots";

export const dynamic = "force-dynamic";

// ============================================================
// POST /api/neighborhood/slots — the slot machines (m32).
// ------------------------------------------------------------
// SERVER-AUTHORITATIVE, the same way blackjack and HSPN Downs
// are. A client sends an INTENT ("spin $5"), never a result.
// This route rolls the outcome with a crypto RNG, moves the
// money, and returns the reels the client must land on. A
// client CANNOT force a win because it never rolls one — the
// 1% jackpot lives here and nowhere else.
//
// WHY THERE IS NO STATE TABLE. Unlike blackjack (a shared hand)
// and the racetrack (a shared race), slots are INDIVIDUAL and
// INSTANT: one request is one whole spin. So there is nothing
// to persist between requests, no clock to pull, and no
// optimistic lock. The only shared thing a spin touches is the
// wallet, and that is moved by the same atomic
// neighborhood_wallet_delta the racetrack uses — so a slot
// spin and a blackjack bet racing in two tabs cannot spend the
// same chips.
//
// THE ORDER OF EVENTS IS THE SAFETY ARGUMENT. Debit the stake
// FIRST, atomically (the SQL floors the balance at zero, so a
// player who cannot cover the bet gets NULL back and is refused
// before a single reel is rolled). Only then roll, and only
// then credit any win. A dropped credit is a lost payout, never
// a minted one — and the stake can never be taken without the
// spin happening, nor the spin happen without the stake.
//
// MONEY. Play money, and only play money. The SAME wallet as
// the blackjack table and the racetrack (neighborhood_wallets)
// — one bankroll per player for the whole casino.
// ============================================================

const CASINO_FLOOR = "casino-floor";
const WALLETS = "neighborhood_wallets";

const ACTIONS = new Set(["spin"]);

// The same crypto RNG the blackjack shoe and the race winner
// come off — never Math.random for anything that decides money.
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

    // Must be a real player, standing on the casino floor, not
    // banned. The same checks /blackjack and /horses make.
    const { data: row, error: readErr } = await supabase
      .from(TABLE)
      .select("id, username, room, kicked_until")
      .eq("id", playerId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row) return fail("Join the room first.", "not_joined", 404);
    const ban = activeBan(row);
    if (ban) return fail(ban.message, "kicked", 403);
    if (row.room !== CASINO_FLOOR) {
      return fail("The slots are on the casino floor.", "wrong_room", 403);
    }

    // The bet — exactly $1, $5 or $10. A hand-crafted amount is
    // refused here, before any money moves.
    const bet = Number(body.bet);
    if (!Number.isInteger(bet) || !SLOTS.isValidBet(bet)) {
      return fail("Bets are $1, $5 or $10.", "bad_bet", 400);
    }

    const now = Date.now();

    // ---- rate limit ----------------------------------------
    // Anti-spam only; the money math is safe without it. A
    // missing function is not worth refusing a spin over.
    const { data: gate, error: gateErr } = await supabase.rpc("neighborhood_record_slot", {
      p_id: playerId,
      p_now_ms: now,
    });
    if (gateErr) {
      const missing =
        gateErr.code === "42883" ||
        gateErr.code === "PGRST202" ||
        /could not find the function|does not exist/i.test(gateErr.message || "");
      if (!missing) throw gateErr;
    } else if (gate === "rate_limited") {
      return fail("Easy — let the reels stop first.", "rate_limited", 429);
    } else if (gate === "not_joined") {
      return fail("Join the room first.", "not_joined", 404);
    }

    // ---- take the stake, atomically ------------------------
    // The SQL guard refuses to go below zero, so this is also
    // the balance check: NULL means either no wallet yet or not
    // enough chips. Nothing is rolled until the stake is in.
    const debited = await walletDelta(supabase, playerId, -bet);
    if (debited === null) {
      const bal = await balanceOf(supabase, playerId);
      if (bal === null) {
        return fail("Walk into the casino first.", "no_wallet", 409);
      }
      return NextResponse.json(
        {
          ok: false,
          code: "insufficient",
          error: "Not enough chips for that.",
          balance: bal,
          serverNow: now,
        },
        { status: 409 }
      );
    }

    // ---- roll the spin, server-side ------------------------
    const rng = cryptoRng();
    const spin = SLOTS.rollSpin(rng);
    const payout = SLOTS.payoutFor(spin.category, bet);

    // ---- credit any win ------------------------------------
    let balance = debited;
    if (payout > 0) {
      const paid = await walletDelta(supabase, playerId, payout);
      // A credit only fails if the wallet row vanished mid-spin
      // (it will not, in practice) — fall back to reporting the
      // post-debit balance rather than lying about a payout.
      if (paid !== null) balance = paid;
      else balance = await balanceOf(supabase, playerId);
    }

    return NextResponse.json({
      ok: true,
      reels: spin.reels,
      category: spin.category,
      jackpot: spin.jackpot,
      win: spin.win,
      bet,
      payout,
      balance,
      serverNow: now,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
