import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood, sameOrigin } from "@/lib/neighborhoodAccess";
import {
  TABLE,
  PLAYER_ID_RE,
  activeBan,
  activeCutoffIso,
  broadcastToRoom,
} from "@/lib/neighborhood/multiplayerServer";
import { CASINO_TABLE_SEATS } from "@/lib/neighborhood/rooms";
import * as BJ from "@/lib/neighborhood/blackjack";

export const dynamic = "force-dynamic";

// ============================================================
// POST /api/neighborhood/blackjack — the whole card game.
// ------------------------------------------------------------
// SERVER-AUTHORITATIVE, in the same sense as /move and /throw
// and for the same reason: clients cannot publish on the
// gameplay Realtime topic (RLS, supabase/neighborhood_realtime
// _auth.sql), so a hand only exists because this route dealt
// it. A client sends an INTENT ("hit"), never an outcome, and
// never a card. The shoe never leaves this file — BJ.toWire()
// strips it, along with the dealer's hole card, before
// anything is broadcast.
//
// WHY THERE IS NO CRON. Blackjack needs a clock (a betting
// window closes, a turn times out, the dealer draws), and
// Vercel functions do not run between requests. So the clock
// is pulled, not pushed: every client in the casino posts
// `sync` on a timer, and BJ.tick() advances the table by
// comparing `now` to the deadline STORED IN THE STATE. tick()
// is idempotent and deadline-driven, so it does not matter who
// calls it, how often, or whether two lambdas call it at once
// — the version guard below means only one of them wins, and
// the loser re-reads a table that has already moved on.
//
// CONCURRENCY. Read (state, version) → compute → write
// `where version = <what we read>`. Zero rows updated means
// somebody else got there first; re-read and retry. Bounded
// retries, no locks held across a request.
//
// MONEY. Play money, and only play money. Balances live in
// neighborhood_wallets (NOT on neighborhood_players, which is
// deleted on leave). Bets are debited by the engine into the
// seat's mirrored balance and persisted here as ABSOLUTE
// numbers, so a dropped write self-corrects on the next one
// instead of compounding.
// ============================================================

const TABLE_ID = "casino-floor:main";
const CASINO_FLOOR = "casino-floor";
const CASINO_STRIP = "casino-strip";
const CASINO_ROOMS = new Set([CASINO_FLOOR, CASINO_STRIP]);
const WALLETS = "neighborhood_wallets";
const GAMES = "neighborhood_blackjack";
const MAX_ATTEMPTS = 4;

// Actions that change something and therefore pay the rate
// limit. `sync` and `enter` are reads (plus the clock) and are
// deliberately cheap — every client in the room calls sync.
const MUTATIONS = new Set(["sit", "stand", "bet", "ready", "hit", "stay", "double", "split"]);
const ACTIONS = new Set([...MUTATIONS, "sync", "enter"]);

// Cards come off a crypto-seeded shuffle, not Math.random, so
// the rest of the shoe is not predictable from what has
// already been dealt.
function cryptoRng() {
  const buf = new Uint32Array(128);
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

async function readTable(supabase, rng) {
  const { data, error } = await supabase
    .from(GAMES)
    .select("state, version")
    .eq("id", TABLE_ID)
    .maybeSingle();
  if (error) throw error;
  if (data && data.state) return { state: data.state, version: Number(data.version) || 0 };
  // First ever request: create the table.
  const fresh = BJ.emptyState(rng);
  const { error: insErr } = await supabase
    .from(GAMES)
    .insert({ id: TABLE_ID, state: fresh, version: 0 });
  // A parallel lambda may have created it first — re-read.
  if (insErr) {
    const { data: again } = await supabase
      .from(GAMES)
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

// Optimistic write. Returns true if we won the race.
async function writeTable(supabase, version, state) {
  const { data, error } = await supabase
    .from(GAMES)
    .update({ state, version: version + 1, updated_at: new Date().toISOString() })
    .eq("id", TABLE_ID)
    .eq("version", version)
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

// Absolute balances, upserted. Never deltas.
async function persistWallets(supabase, rows) {
  const byId = new Map();
  for (const r of rows || []) {
    if (!r || !r.playerId || !Number.isFinite(r.balance)) continue;
    byId.set(r.playerId, Math.max(0, Math.round(r.balance)));
  }
  if (byId.size === 0) return;
  const now = new Date().toISOString();
  await supabase.from(WALLETS).upsert(
    [...byId].map(([id, balance]) => ({ id, balance, updated_at: now })),
    { onConflict: "id" }
  );
}

async function loadBalances(supabase, ids) {
  const out = {};
  const list = [...new Set(ids.filter(Boolean))];
  if (list.length === 0) return out;
  const { data } = await supabase.from(WALLETS).select("id, balance").in("id", list);
  for (const row of data || []) out[row.id] = Number(row.balance) || 0;
  return out;
}

// Seats whose player has gone: row pruned, heartbeat stale, or
// they walked out of the room. THIS is what stops a
// disconnected player wedging a table — nobody has to press
// anything for the seat to come back.
async function reapAbsentSeats(supabase, state, now) {
  const ids = (state.seats || []).filter(Boolean).map((s) => s.playerId);
  if (ids.length === 0) return { state, wallets: [] };
  const { data } = await supabase
    .from(TABLE)
    .select("id, room, last_seen")
    .in("id", ids);
  const alive = new Set();
  // Parse, do not string-compare: Postgres hands back
  // "...+00:00" while activeCutoffIso() produces "...Z", and
  // those two sort against each other by luck, not by time.
  const cutoff = Date.parse(activeCutoffIso(now));
  for (const row of data || []) {
    const seen = row.last_seen ? Date.parse(row.last_seen) : NaN;
    if (row.room === CASINO_FLOOR && Number.isFinite(seen) && seen >= cutoff) {
      alive.add(row.id);
    }
  }
  let next = state;
  const wallets = [];
  for (const id of ids) {
    if (alive.has(id)) continue;
    const res = BJ.stand(next, id, now);
    if (res.error) continue;
    next = res.state;
    for (const w of res.wallets || []) wallets.push(w);
  }
  return { state: next, wallets };
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

    // Must be a player, in the room, not banned. Exactly the
    // checks /move and /throw make, for exactly the reason.
    const { data: row, error: readErr } = await supabase
      .from(TABLE)
      .select("id, username, avatar, room, kicked_until")
      .eq("id", playerId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row) return fail("Join the room first.", "not_joined", 404);
    const ban = activeBan(row);
    if (ban) return fail(ban.message, "kicked", 403);
    if (!CASINO_ROOMS.has(row.room)) {
      return fail("You're not in the casino.", "wrong_room", 403);
    }
    // Everything except walking in the door needs you INSIDE.
    if (action !== "enter" && action !== "sync" && row.room !== CASINO_FLOOR) {
      return fail("You're not at the table.", "wrong_room", 403);
    }

    const now = Date.now();
    const rng = cryptoRng();

    // ---- the $100 ------------------------------------------
    // First ever visit grants the starting stack; a player who
    // busted below the table minimum is topped back up so
    // nobody is ever locked out of the only game in town.
    // Atomic in SQL, so two tabs cannot double-grant.
    if (action === "enter") {
      const { data: bal, error: grantErr } = await supabase.rpc(
        "neighborhood_casino_enter",
        { p_id: playerId, p_start: BJ.STARTING_BALANCE, p_floor: BJ.MIN_BET }
      );
      if (grantErr) throw grantErr;
      const { state } = await readTable(supabase, rng);
      return NextResponse.json({
        ok: true,
        balance: Number(bal) || 0,
        table: BJ.toWire(state),
        seats: CASINO_TABLE_SEATS,
        rules: {
          decks: BJ.DECKS,
          minBet: BJ.MIN_BET,
          maxBet: BJ.MAX_BET,
          seats: BJ.SEAT_COUNT,
          turnMs: BJ.TURN_MS,
          betMs: BJ.BET_MS,
        },
        serverNow: now,
      });
    }

    // ---- rate limit ----------------------------------------
    if (MUTATIONS.has(action)) {
      const { data: gate, error: gateErr } = await supabase.rpc(
        "neighborhood_record_bj",
        { p_id: playerId, p_now_ms: now }
      );
      if (gateErr) {
        const missing =
          gateErr.code === "42883" ||
          gateErr.code === "PGRST202" ||
          /could not find the function|does not exist/i.test(gateErr.message || "");
        // Unlike tomatoes there is no in-memory fallback worth
        // having here: the table's own phase machine already
        // refuses out-of-turn actions, so the limit is anti-spam
        // rather than anti-cheat. Missing function = carry on.
        if (!missing) throw gateErr;
      } else if (gate === "rate_limited") {
        return fail("Easy — one at a time.", "rate_limited", 429);
      } else if (gate === "not_joined") {
        return fail("Join the room first.", "not_joined", 404);
      }
    }

    // ---- read, advance, act, write -------------------------
    let lastError = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const { state: stored, version } = await readTable(supabase, rng);
      let state = stored;
      const wallets = [];

      // 1. Free any seat whose player is gone.
      if (action === "sync" || action === "sit") {
        const reaped = await reapAbsentSeats(supabase, state, now);
        state = reaped.state;
        for (const w of reaped.wallets) wallets.push(w);
      }

      // 2. Run the clock forward to now.
      const ticked = BJ.tick(state, now, rng);
      state = ticked.state;
      for (const w of ticked.wallets || []) wallets.push(w);

      // 3. Re-seed mirrored balances from the wallet whenever
      //    money is not in play, so a top-up or a win banked
      //    elsewhere shows up at the table.
      if (state.phase === "betting" || state.phase === "idle") {
        const seatedIds = (state.seats || []).filter(Boolean).map((s) => s.playerId);
        if (seatedIds.length) {
          state = BJ.syncBalances(state, await loadBalances(supabase, seatedIds));
        }
      }

      // 4. The action itself.
      let result = null;
      if (action === "sit") {
        const seatIndex = Number(body.seatIndex);
        const balances = await loadBalances(supabase, [playerId]);
        const balance = Number.isFinite(balances[playerId])
          ? balances[playerId]
          : BJ.STARTING_BALANCE;
        result = BJ.sit(
          state,
          {
            seatIndex,
            playerId,
            username: row.username,
            avatar: row.avatar || null,
            balance,
          },
          now
        );
      } else if (action === "stand") {
        result = BJ.stand(state, playerId, now);
      } else if (action === "bet") {
        result = BJ.bet(state, playerId, body.amount, now);
      } else if (action === "ready") {
        result = BJ.ready(state, playerId, now, rng);
      } else if (action === "hit") {
        result = BJ.hit(state, playerId, now, rng);
      } else if (action === "stay") {
        result = BJ.stay(state, playerId, now);
      } else if (action === "double") {
        result = BJ.double(state, playerId, now, rng);
      } else if (action === "split") {
        result = BJ.split(state, playerId, now, rng);
      }

      if (result && result.error) {
        // A refused action still owes the caller a fresh view
        // of the table — their button was stale, not evil.
        return NextResponse.json(
          {
            ok: false,
            code: result.error,
            error: reasonFor(result.error),
            table: BJ.toWire(state),
            balance: balanceOf(state, playerId),
            serverNow: now,
          },
          { status: 409 }
        );
      }
      if (result) {
        state = result.state;
        for (const w of result.wallets || []) wallets.push(w);
      }

      const changed = result || ticked.changed || wallets.length > 0;
      if (!changed) {
        // Nothing moved: don't burn a write or a broadcast.
        return NextResponse.json({
          ok: true,
          table: BJ.toWire(state),
          balance: await balanceFor(supabase, state, playerId),
          serverNow: now,
        });
      }

      const won = await writeTable(supabase, version, state);
      if (!won) {
        lastError = "contended";
        continue; // somebody else moved the table; re-read
      }

      // Persist every seated balance plus anyone whose seat was
      // just freed. Absolute values, so this is self-healing.
      await persistWallets(supabase, [...wallets, ...BJ.walletSnapshot(state)]);

      const wire = BJ.toWire(state);
      await broadcastToRoom(CASINO_FLOOR, "blackjack", wire);

      return NextResponse.json({
        ok: true,
        table: wire,
        balance: await balanceFor(supabase, state, playerId),
        serverNow: now,
      });
    }

    return fail("The table is busy — try that again.", lastError || "busy", 503);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function balanceOf(state, playerId) {
  const i = BJ.seatOf(state, playerId);
  return i >= 0 ? state.seats[i].balance : null;
}

async function balanceFor(supabase, state, playerId) {
  const seated = balanceOf(state, playerId);
  if (seated !== null) return seated;
  const b = await loadBalances(supabase, [playerId]);
  return Number.isFinite(b[playerId]) ? b[playerId] : null;
}

// Engine error codes are terse on purpose; the player gets a
// sentence.
function reasonFor(code) {
  switch (code) {
    case "seat_taken":
      return "Somebody just took that seat.";
    case "already_seated":
      return "You're already at the table.";
    case "not_seated":
      return "Sit down first.";
    case "bad_seat":
      return "That seat doesn't exist.";
    case "not_betting":
      return "Betting is closed for this hand.";
    case "already_in":
      return "Your bet is already locked in.";
    case "no_bet":
      return "Put some chips down first.";
    case "bad_bet":
      return `Bets are $${BJ.MIN_BET}–$${BJ.MAX_BET}.`;
    case "insufficient":
      return "Not enough chips for that.";
    case "not_your_turn":
      return "It's not your turn.";
    case "cannot_hit":
      return "You can't hit that hand.";
    case "cannot_double":
      return "You can't double that hand.";
    case "cannot_split":
      return "You can't split that hand.";
    default:
      return "That move isn't allowed right now.";
  }
}
