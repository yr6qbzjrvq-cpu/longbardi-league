// ============================================================
// HSPNeighborhood — shared walk simulation (pure module)
// ------------------------------------------------------------
// The ONE definition of how an avatar moves: constant speed
// along a validated waypoint list, no easing. Imported by the
// client engine (components/NeighborhoodRoom) for rendering
// AND by the /api/neighborhood/move route for event-level
// server authority, so a position computed from
// (x, y, path, startedAt) is identical everywhere. Late
// joiners resync deterministically from the stored path +
// timestamp with the same math.
//
// SEAM (future upgrade): if the Supabase/Vercel backend is
// ever replaced by a dedicated socket server, that server
// imports this module unchanged — nothing here knows about
// Supabase, Next.js or the DOM.
// ============================================================

export const WALK_SPEED = 200; // world px/sec — constant, no easing

// Advance from (x, y) along `path` for `elapsed` seconds.
// Returns the current position, the waypoints still ahead and
// whether the walk has finished. Pure + deterministic.
export function advanceAlongPath(x, y, path, elapsed, speed = WALK_SPEED) {
  let remaining = Math.max(0, elapsed) * speed;
  let px = x;
  let py = y;
  let i = 0;
  const pts = Array.isArray(path) ? path : [];
  while (i < pts.length && remaining > 0) {
    const dx = pts[i].x - px;
    const dy = pts[i].y - py;
    const d = Math.hypot(dx, dy);
    if (d <= remaining) {
      px = pts[i].x;
      py = pts[i].y;
      remaining -= d;
      i++;
    } else {
      px += (dx / d) * remaining;
      py += (dy / d) * remaining;
      remaining = 0;
    }
  }
  return { x: px, y: py, path: pts.slice(i), done: i >= pts.length };
}

// Where is a stored player right now? `row` uses the DB shape
// from neighborhood_players: x/y at path start, path waypoint
// list, path_started_at ISO timestamp (server clock).
export function currentPosition(row, nowMs, speed = WALK_SPEED) {
  const path = sanitizePath(row.path);
  const startedAt = row.path_started_at ? Date.parse(row.path_started_at) : NaN;
  if (!Number.isFinite(startedAt) || path.length === 0) {
    return { x: row.x, y: row.y, path: [], done: true };
  }
  return advanceAlongPath(row.x, row.y, path, (nowMs - startedAt) / 1000, speed);
}

// Sanitize a waypoint list from the wire or the DB: finite
// numbers only, capped length so nobody stores runaway paths.
export function sanitizePath(path, maxPoints = 64) {
  if (!Array.isArray(path)) return [];
  const out = [];
  for (const p of path.slice(0, maxPoints)) {
    const x = Number(p && p.x);
    const y = Number(p && p.y);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
  }
  return out;
}
