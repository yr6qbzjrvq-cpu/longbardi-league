import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood, sameOrigin } from "@/lib/neighborhoodAccess";
import { ROOMS, getRoom, screenRectFor } from "@/lib/neighborhood/rooms";
import { currentPosition, advanceAlongPath } from "@/lib/neighborhood/movement";
import {
  TABLE,
  PLAYER_ID_RE,
  activeBan,
  activeCutoffIso,
  broadcastToRoom,
} from "@/lib/neighborhood/multiplayerServer";
import {
  THROW_KINDS,
  THROW_COOLDOWN_MS,
  HAND_LIFT,
  BODY_LIFT,
  flightDurationMs,
  unit,
} from "@/lib/neighborhood/tomatoes";

export const dynamic = "force-dynamic";

// ============================================================
// POST /api/neighborhood/throw — "throw a tomato at that".
// ------------------------------------------------------------
// Same shape as /move, for the same reason: clients cannot
// publish on the gameplay topic, so a tomato only exists
// because this route validated one and broadcast it. The
// client sends a TARGET, never a trajectory — the server
// decides where the thrower is standing (from the stored path
// + timestamp, the deterministic walk math), how long the
// flight takes, and what everyone renders.
//
// Three kinds of target:
//   spot   — a world point inside the room's bounds
//   player — another active player in the SAME room; the
//            server aims at where they will be when the
//            tomato lands, and the splat then sticks to them
//   screen — a normalized point inside the room's screen rect
//            (Mission Control's board / the Sports Bar TV),
//            which the client paints on an overlay ABOVE the
//            live <video>
//
// Rate limit: one throw per 1.5s per player, enforced by the
// atomic row-locked SQL function neighborhood_record_throw —
// the same pattern as moves and chat, so parallel lambdas
// can't race past it. If that function has not been installed
// yet the route degrades to a per-lambda in-memory window
// (see FALLBACK below) rather than throwing 500s.
//
// MUTED PLAYERS MAY STILL THROW. Mute is a CHAT sanction; a
// tomato is not speech. A kick still blocks everything.
// Nothing is written to neighborhood_messages: throws are
// ephemeral, so they leave no moderation trail (noted in
// README-neighborhood.md).
// ============================================================

// FALLBACK rate limit, used only while neighborhood_record_throw
// is missing from the database. Per lambda instance, so it is
// weaker than the Postgres one (a cold start forgets it) — but
// it still stops the obvious hold-the-button spam, and the SQL
// function takes over the moment it exists.
const memoryThrows = new Map();
function memoryGate(playerId, now) {
  const times = (memoryThrows.get(playerId) || []).filter(
    (t) => t > now - THROW_COOLDOWN_MS
  );
  if (times.length >= 1) {
    memoryThrows.set(playerId, times);
    return "rate_limited";
  }
  times.push(now);
  memoryThrows.set(playerId, times);
  if (memoryThrows.size > 500) {
    for (const [k, v] of memoryThrows) {
      if (!v.length || v[v.length - 1] < now - 60_000) memoryThrows.delete(k);
    }
  }
  return "ok";
}

export async function POST(request) {
  if (!(await canSeeNeighborhood())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Bad origin." }, { status: 403 });
  }
  try {
    const supabase = getAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Multiplayer is not configured.", code: "not_configured" },
        { status: 503 }
      );
    }

    const body = await request.json();
    const playerId = String(body.playerId || "");
    if (!PLAYER_ID_RE.test(playerId)) {
      return NextResponse.json(
        { error: "Bad player id.", code: "bad_player" },
        { status: 400 }
      );
    }
    const kind = String(body.kind || "");
    if (!THROW_KINDS.includes(kind)) {
      return NextResponse.json(
        { error: "Bad throw target.", code: "bad_target" },
        { status: 400 }
      );
    }

    const { data: row, error: readErr } = await supabase
      .from(TABLE)
      .select(
        "id, username, room, x, y, path, path_started_at, kicked_until"
      )
      .eq("id", playerId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row || !ROOMS[row.room]) {
      return NextResponse.json(
        { error: "Join the room first.", code: "not_joined" },
        { status: 404 }
      );
    }
    const ban = activeBan(row);
    if (ban) {
      return NextResponse.json(
        { error: ban.message, code: "kicked", until: ban.until },
        { status: 403 }
      );
    }

    const room = getRoom(row.room);
    const now = Date.now();

    // Postgres sliding window (1 throw / 1.5s), with the
    // in-memory fallback if the function isn't installed.
    let gate = null;
    const { data: rpcGate, error: gateErr } = await supabase.rpc(
      "neighborhood_record_throw",
      { p_id: playerId, p_now_ms: now }
    );
    if (gateErr) {
      const missing =
        gateErr.code === "42883" ||
        gateErr.code === "PGRST202" ||
        /could not find the function|does not exist/i.test(gateErr.message || "");
      if (!missing) throw gateErr;
      gate = memoryGate(playerId, now);
    } else {
      gate = rpcGate;
    }
    if (gate === "rate_limited") {
      return NextResponse.json(
        { error: "One tomato at a time — let that one land.", code: "rate_limited" },
        { status: 429 }
      );
    }
    if (gate === "not_joined") {
      return NextResponse.json(
        { error: "Join the room first.", code: "not_joined" },
        { status: 404 }
      );
    }

    // Where the server says the thrower is standing right now.
    const from = currentPosition(row, now);
    const ox = from.x;
    const oy = from.y;

    let tx = 0;
    let ty = 0;
    let targetId = null;
    let sx = null;
    let sy = null;

    if (kind === "spot") {
      const rx = Number(body.x);
      const ry = Number(body.y);
      if (!Number.isFinite(rx) || !Number.isFinite(ry)) {
        return NextResponse.json(
          { error: "Bad throw target.", code: "bad_target" },
          { status: 400 }
        );
      }
      // Sane == inside the room. Anything else is a client bug
      // or someone poking the API; clamping is friendlier than
      // a 400 and can never land a splat outside the world.
      tx = Math.min(Math.max(rx, 0), room.width);
      ty = Math.min(Math.max(ry, 0), room.height);
    } else if (kind === "screen") {
      const rect = screenRectFor(room.id);
      if (!rect) {
        return NextResponse.json(
          { error: "No screen in this room.", code: "no_screen" },
          { status: 400 }
        );
      }
      sx = unit(body.sx);
      sy = unit(body.sy);
      if (sx === null || sy === null) {
        return NextResponse.json(
          { error: "Bad throw target.", code: "bad_target" },
          { status: 400 }
        );
      }
      tx = rect.x + sx * rect.w;
      ty = rect.y + sy * rect.h;
    } else {
      const wanted = String(body.targetId || "");
      if (!PLAYER_ID_RE.test(wanted)) {
        return NextResponse.json(
          { error: "Bad throw target.", code: "bad_target" },
          { status: 400 }
        );
      }
      const { data: victim, error: vErr } = await supabase
        .from(TABLE)
        .select("id, room, x, y, path, path_started_at, last_seen")
        .eq("id", wanted)
        .eq("room", row.room)
        .gte("last_seen", activeCutoffIso(now))
        .maybeSingle();
      if (vErr) throw vErr;
      if (!victim) {
        return NextResponse.json(
          { error: "They're not in the room anymore.", code: "no_target" },
          { status: 404 }
        );
      }
      targetId = victim.id;
      // Aim where they WILL be when it lands, using the same
      // walk sim every client renders with. A first guess sets
      // the flight time, then one refinement — good enough to
      // land on a walking avatar, and the splat sticks to the
      // player anyway so a stray step never misses.
      const here = currentPosition(victim, now);
      const guess = flightDurationMs(ox, oy - HAND_LIFT, here.x, here.y - BODY_LIFT);
      const lead = advanceAlongPath(here.x, here.y, here.path, guess / 1000);
      tx = lead.x;
      ty = lead.y;
    }

    const flightMs = flightDurationMs(
      ox,
      oy - HAND_LIFT,
      tx,
      kind === "player" ? ty - BODY_LIFT : ty
    );

    const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const wire = {
      id,
      playerId,
      username: row.username,
      kind,
      targetId,
      ox,
      oy,
      tx,
      ty,
      sx,
      sy,
      at: now,
      flightMs,
    };

    await supabase
      .from(TABLE)
      .update({ last_seen: new Date(now).toISOString() })
      .eq("id", playerId);

    await broadcastToRoom(row.room, "throw", wire);

    return NextResponse.json({ ok: true, throw: wire, serverNow: now });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
