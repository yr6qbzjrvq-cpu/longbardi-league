import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood } from "@/lib/neighborhoodAccess";
import { getRoom, ROOMS } from "@/lib/neighborhood/rooms";
import { findPath, getNavGrid } from "@/lib/neighborhood/pathing";
import { currentPosition } from "@/lib/neighborhood/movement";
import {
  TABLE,
  broadcastToRoom,
  toWirePlayer,
} from "@/lib/neighborhood/multiplayerServer";

export const dynamic = "force-dynamic";

// ============================================================
// POST /api/neighborhood/move — "walk me to (x, y)".
// ------------------------------------------------------------
// Event-level server authority: the client sends ONLY a
// destination. This route
//   1. rate-limits (~3 moves/sec) with timestamps stored in
//      Postgres, so the limit survives serverless cold starts
//      and parallel lambda instances,
//   2. computes the player's current position from the stored
//      path + timestamp (same math the clients render with —
//      lib/neighborhood/movement), which is also the implicit
//      SPEED CAP: nobody can be anywhere their last validated
//      walk couldn't have reached at WALK_SPEED,
//   3. runs the exact same A* (lib/neighborhood/pathing) the
//      sender ran locally, so the validated path stays inside
//      the walkable polygon and around prop footprints,
//   4. stores the new path + start timestamp and broadcasts it
//      on the room channel; every peer runs the identical
//      constant-speed simulation.
// ============================================================

const MOVES_PER_WINDOW = 3;
const WINDOW_MS = 1000;

export async function POST(request) {
  if (!(await canSeeNeighborhood())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
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
    const tx = Number(body.x);
    const ty = Number(body.y);
    if (!playerId || !Number.isFinite(tx) || !Number.isFinite(ty)) {
      return NextResponse.json(
        { error: "Bad move request.", code: "bad_request" },
        { status: 400 }
      );
    }

    const { data: row, error: readErr } = await supabase
      .from(TABLE)
      .select("id, username, avatar, room, x, y, path, path_started_at, move_times")
      .eq("id", playerId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row || !ROOMS[row.room]) {
      return NextResponse.json(
        { error: "Join the room first.", code: "not_joined" },
        { status: 404 }
      );
    }

    const now = Date.now();

    // Postgres-backed sliding window rate limit.
    const times = (Array.isArray(row.move_times) ? row.move_times : [])
      .map(Number)
      .filter((t) => Number.isFinite(t) && now - t < WINDOW_MS);
    if (times.length >= MOVES_PER_WINDOW) {
      return NextResponse.json(
        { error: "Too many moves — slow down.", code: "rate_limited" },
        { status: 429 }
      );
    }
    times.push(now);

    const room = getRoom(row.room);
    const grid = getNavGrid(room);

    // Where the server says the player is right now.
    const cur = currentPosition(row, now);
    // Same snap + A* the sender ran locally; the result can
    // only ever land on walkable ground.
    const clampedX = Math.min(Math.max(tx, 0), room.width);
    const clampedY = Math.min(Math.max(ty, 0), room.height);
    const path = findPath(room, grid, cur.x, cur.y, clampedX, clampedY);

    const nowIso = new Date(now).toISOString();
    const { error: writeErr } = await supabase
      .from(TABLE)
      .update({
        x: cur.x,
        y: cur.y,
        path,
        path_started_at: path.length ? nowIso : null,
        move_times: times,
        last_seen: nowIso,
      })
      .eq("id", playerId);
    if (writeErr) throw writeErr;

    const wire = toWirePlayer({
      ...row,
      x: cur.x,
      y: cur.y,
      path,
      path_started_at: path.length ? nowIso : null,
    });
    if (path.length) {
      await broadcastToRoom(row.room, "move", wire);
    }

    return NextResponse.json({ ok: true, ...wire, serverNow: now });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
