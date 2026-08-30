// ============================================================
// HSPNeighborhood — walkable-area navigation (pure module)
// ------------------------------------------------------------
// No DOM, no canvas, no window: the client uses this for
// click-to-walk today, and the milestone-4 API routes can
// import the exact same functions to validate positions and
// paths a client reports (event-level authority server-side).
//
// Approach: rasterize a room's walkable polygon minus prop
// footprints into a coarse grid (built once per room and
// cached), A* across it (8-way, corner cutting disallowed),
// then straighten the result with line-of-sight smoothing so
// avatars walk natural diagonals instead of grid staircases.
// ============================================================

export const NAV_CELL = 20; // world px per nav-grid cell
const CLEARANCE = 8; // keep feet this far from walls and props
const SQRT2 = Math.SQRT2;

// Standard ray-cast point-in-polygon test.
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const hit =
      (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function rectContains(r, x, y, pad) {
  return (
    x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad
  );
}

// Can feet stand at (x, y)? Inside the walkable polygon (with a
// little clearance so sprites don't visually clip the edge) and
// outside every prop footprint.
export function isWalkablePoint(room, x, y) {
  if (x < 0 || y < 0 || x > room.width || y > room.height) return false;
  if (!pointInPolygon(x, y, room.walkable)) return false;
  for (const d of [
    [CLEARANCE, 0],
    [-CLEARANCE, 0],
    [0, CLEARANCE],
    [0, -CLEARANCE],
  ]) {
    if (!pointInPolygon(x + d[0], y + d[1], room.walkable)) return false;
  }
  for (const p of room.props) {
    if (p.footprint && rectContains(p.footprint, x, y, CLEARANCE)) return false;
  }
  return true;
}

// ---- Nav grid ----------------------------------------------

const gridCache = new Map();

// Rasterized walkability for one room, cached by room id. A
// cell is open when its center passes isWalkablePoint.
export function getNavGrid(room) {
  const hit = gridCache.get(room.id);
  if (hit) return hit;
  const cols = Math.ceil(room.width / NAV_CELL);
  const rows = Math.ceil(room.height / NAV_CELL);
  const walk = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * NAV_CELL;
      const cy = (r + 0.5) * NAV_CELL;
      walk[r * cols + c] = isWalkablePoint(room, cx, cy) ? 1 : 0;
    }
  }
  const grid = { cols, rows, walk };
  gridCache.set(room.id, grid);
  return grid;
}

function cellOf(grid, x, y) {
  return {
    c: Math.min(Math.max(Math.floor(x / NAV_CELL), 0), grid.cols - 1),
    r: Math.min(Math.max(Math.floor(y / NAV_CELL), 0), grid.rows - 1),
  };
}

function cellCenter(grid, idx) {
  const c = idx % grid.cols;
  const r = (idx / grid.cols) | 0;
  return { x: (c + 0.5) * NAV_CELL, y: (r + 0.5) * NAV_CELL };
}

// Snap an arbitrary point (e.g. a tap on the fountain) to the
// nearest standable spot, or null if the room has none. BFS
// ring search over the grid from the tapped cell.
//
// Milestone-7 dead-band fix: a target only counts as "already
// fine" when the point itself AND its nav cell are open. The
// clearance sliver beside a prop is full of points that pass
// isWalkablePoint while sitting inside a closed cell — the old
// early-return handed those straight to A*, whose goal cell
// was then unreachable, so taps there did nothing. Now they
// snap to the nearest OPEN cell's center like any blocked tap.
export function nearestWalkable(room, grid, x, y) {
  const { cols, rows, walk } = grid;
  const start = cellOf(grid, x, y);
  const startIdx = start.r * cols + start.c;
  if (walk[startIdx] && isWalkablePoint(room, x, y)) return { x, y };
  const seen = new Uint8Array(cols * rows);
  const queue = [startIdx];
  seen[startIdx] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const idx = queue[qi];
    if (walk[idx]) return cellCenter(grid, idx);
    const c = idx % cols;
    const r = (idx / cols) | 0;
    if (c > 0 && !seen[idx - 1]) (seen[idx - 1] = 1), queue.push(idx - 1);
    if (c < cols - 1 && !seen[idx + 1]) (seen[idx + 1] = 1), queue.push(idx + 1);
    if (r > 0 && !seen[idx - cols]) (seen[idx - cols] = 1), queue.push(idx - cols);
    if (r < rows - 1 && !seen[idx + cols]) (seen[idx + cols] = 1), queue.push(idx + cols);
  }
  return null;
}

// True when the straight segment a→b stays on walkable ground
// (sampled every ~7 px). Used for path smoothing and, later,
// server-side movement validation.
export function clearLine(room, ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(d / 7));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkablePoint(room, ax + (bx - ax) * t, ay + (by - ay) * t)) {
      return false;
    }
  }
  return true;
}

// ---- A* ----------------------------------------------------

// Tiny binary min-heap of [f, idx] pairs.
function heapPush(h, item) {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    const t = h[p];
    h[p] = h[i];
    h[i] = t;
    i = p;
  }
}

function heapPop(h) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      const t = h[m];
      h[m] = h[i];
      h[i] = t;
      i = m;
    }
  }
  return top;
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

// Waypoints from (sx, sy) to the nearest standable spot to
// (tx, ty). Returns [] when there is nowhere to go (already
// there, or unreachable). The result excludes the start point
// and ends exactly on the target.
export function findPath(room, grid, sx, sy, tx, ty) {
  const target = nearestWalkable(room, grid, tx, ty);
  if (!target) return [];
  if (Math.hypot(target.x - sx, target.y - sy) < 2) return [];
  // Straight shot? Skip the grid entirely.
  if (clearLine(room, sx, sy, target.x, target.y)) {
    return [{ x: target.x, y: target.y }];
  }

  const { cols, rows, walk } = grid;
  const startCell = cellOf(grid, sx, sy);
  let startIdx = startCell.r * cols + startCell.c;
  if (!walk[startIdx]) {
    const snapped = nearestWalkable(room, grid, sx, sy);
    if (!snapped) return [];
    const c2 = cellOf(grid, snapped.x, snapped.y);
    startIdx = c2.r * cols + c2.c;
  }
  const goalCell = cellOf(grid, target.x, target.y);
  const goalIdx = goalCell.r * cols + goalCell.c;

  const g = new Float64Array(cols * rows).fill(Infinity);
  const came = new Int32Array(cols * rows).fill(-1);
  const closed = new Uint8Array(cols * rows);
  const h = (idx) => {
    const dc = Math.abs((idx % cols) - goalCell.c);
    const dr = Math.abs(((idx / cols) | 0) - goalCell.r);
    return dc + dr + (SQRT2 - 2) * Math.min(dc, dr);
  };
  g[startIdx] = 0;
  const open = [];
  heapPush(open, [h(startIdx), startIdx]);

  let found = startIdx === goalIdx;
  while (open.length && !found) {
    const [, idx] = heapPop(open);
    if (closed[idx]) continue;
    closed[idx] = 1;
    if (idx === goalIdx) {
      found = true;
      break;
    }
    const c = idx % cols;
    const r = (idx / cols) | 0;
    for (const [dc, dr, cost] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const nIdx = nr * cols + nc;
      if (!walk[nIdx] || closed[nIdx]) continue;
      // No cutting corners diagonally past a blocked cell.
      if (dc !== 0 && dr !== 0) {
        if (!walk[r * cols + nc] || !walk[nr * cols + c]) continue;
      }
      const cand = g[idx] + cost;
      if (cand < g[nIdx]) {
        g[nIdx] = cand;
        came[nIdx] = idx;
        heapPush(open, [cand + h(nIdx), nIdx]);
      }
    }
  }
  if (!found) return [];

  // Cell path → world points, then greedy line-of-sight
  // smoothing so the walk looks natural.
  const cellPts = [];
  for (let idx = goalIdx; idx !== -1; idx = came[idx]) {
    cellPts.push(cellCenter(grid, idx));
    if (idx === startIdx) break;
  }
  cellPts.reverse();
  const pts = [{ x: sx, y: sy }, ...cellPts, { x: target.x, y: target.y }];
  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clearLine(room, pts[i].x, pts[i].y, pts[j].x, pts[j].y)) {
      j--;
    }
    out.push({ x: pts[j].x, y: pts[j].y });
    i = j;
  }
  return out;
}
