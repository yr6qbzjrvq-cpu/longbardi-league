# HSPNeighborhood

A Club Penguin-style browser world for the league, living at `/neighborhood`
on the HSPN site (longbardi-league.vercel.app, a.k.a. hspn.vercel.app). Make a
character, walk the Town Square, step through doors into the Grocery Store, the
Fast Food Place and the Sports Bar, and chat with whoever's around — realtime
multiplayer, original procedural art (every pixel drawn in canvas code, no
image assets), phone-friendly.

Built across milestones 1–7; this file is the operator's manual.

---

## Where everything lives

| Piece | Path |
| --- | --- |
| Page (admin-gated, 404s when denied) | `app/neighborhood/page.jsx` |
| Screen flow (creator / room / full / removed) | `components/NeighborhoodClient.jsx` |
| Room engine (canvas, walking, doors, chat UI) | `components/NeighborhoodRoom.jsx` |
| Avatar creator | `components/NeighborhoodAvatarCreator.jsx` |
| Avatar drawing + normalization | `lib/neighborhoodAvatar.js` |
| Per-browser identity + username rules | `lib/neighborhoodPlayer.js` |
| Access gate (flag OR admin cookie) | `lib/neighborhoodAccess.js` |
| Room registry — **one config object per room** | `lib/neighborhood/rooms.js` |
| Pathfinding (nav grid, A*, smoothing) | `lib/neighborhood/pathing.js` |
| Shared constant-speed walk math | `lib/neighborhood/movement.js` |
| Chat text rules (sanitize, cap, filter) | `lib/neighborhood/chat.js` |
| Server helpers + Realtime broadcast | `lib/neighborhood/multiplayerServer.js` |
| Client realtime transport | `lib/neighborhood/realtime.js` |
| Gameplay APIs | `app/api/neighborhood/{join,move,heartbeat,leave,chat}/route.js` |
| Moderation API (admin-only) | `app/api/neighborhood/admin/route.js` |
| Moderation screen | `app/admin/neighborhood/page.jsx` + `components/NeighborhoodModeration.jsx` |

Design rule that makes the whole thing hold together: **pathing, movement and
chat rules are pure modules imported by both the client and the API routes**,
so the server validates with the exact math the client renders with, and every
client computes identical positions from `(x, y, path, path_started_at)`.

## Local dev

```bash
npm install
npm run dev        # Next.js 15 App Router, http://localhost:3000
```

`.env.local` needs:

```
NEXT_PUBLIC_SUPABASE_URL=...        # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=...   # anon key (Realtime subscribe + public reads)
SUPABASE_SERVICE_ROLE_KEY=...       # server-only; all neighborhood writes
ADMIN_PASSWORD=...                  # commissioner login (cookie-based, lib/auth.js)
```

Without the Supabase vars the world still loads and you can walk solo — the
join API answers `not_configured` and the client shows "Multiplayer is
offline". Log in at `/admin` first (the neighborhood 404s for everyone else
while `NEIGHBORHOOD_PUBLIC` is false), then open `/neighborhood`.

## How deploys work

Push (or web-edit) to `main` on GitHub → Vercel builds and deploys
automatically. There is no staging branch; the admin gate is the safety net.
Env vars above must also exist in Vercel's project settings. Verify a deploy by
loading `/neighborhood` logged-in and watching two browsers see each other.

## Supabase inventory

Everything lives in the one HSPN Supabase project (the same one articles use).
RLS is ON with **zero policies** on both neighborhood tables — the house
pattern: nothing is readable or writable with the anon key; every access goes
through the gated API routes using the service-role client.

### Table `neighborhood_players`

One row per active player (row is deleted on clean leave and pruned when
stale). Doubles as the ban record after a kick.

| column | type | meaning |
| --- | --- | --- |
| `id` | text | per-browser player id (localStorage UUID), primary key |
| `username` | text | display name; case-insensitive unique index |
| `avatar` | jsonb | normalized avatar config |
| `room` | text | room id from `lib/neighborhood/rooms.js` |
| `x`, `y` | double | position at the start of the current path |
| `path` | jsonb | validated waypoint list (may be `[]`) |
| `path_started_at` | timestamptz | when the walk started; with `x/y/path` this fully determines the current position |
| `move_times` | jsonb | recent move timestamps (rate-limit window) |
| `chat_times` | jsonb | recent chat timestamps (rate-limit window) |
| `last_seen` | timestamptz | heartbeat every 30s; younger than 75s = active |
| `muted` | boolean | chat blocked server-side when true |
| `kicked_until` | timestamptz | live timed ban; the row survives prune/leave while this is in the future |
| `created_at` | timestamptz | when this visit's row was first inserted ("joined") |

### Table `neighborhood_messages`

The chat trail: `id` (uuid), `player_id`, `username`, `room`, `text`,
`created_at`. Backs the chat-log backfill (last 50 per room) and the
moderation view (last 40 overall). Text is sanitized to plain text before
insert; deletes happen only through the moderation API.

### SQL functions (Database → Functions in the Supabase dashboard)

Both are `plpgsql`, `SECURITY DEFINER`, `SET search_path TO 'public'`, and
implement atomic sliding-window rate limits by locking the player row
(`select ... for update`) so parallel serverless lambdas can't race past the
cap. Both return `'ok'`, `'rate_limited'` or `'not_joined'`.

- `neighborhood_record_move(p_id text, p_now_ms numeric)` — keeps timestamps
  in `move_times` newer than `p_now_ms - 1000`; refuses when 3+ remain
  (~3 moves/sec).
- `neighborhood_record_chat(p_id text, p_now_ms numeric)` — same shape on
  `chat_times` with a 2000ms window and a cap of 1 (~1 message / 2s).

### Realtime channels

One public broadcast channel per room: topic **`neighborhood:<roomId>`**
(e.g. `neighborhood:town-square`). Clients subscribe with the anon key;
API routes broadcast server-side over Supabase's HTTP endpoint
(`POST <url>/realtime/v1/api/broadcast`) — see `broadcastToRoom()` in
`lib/neighborhood/multiplayerServer.js`.

Events on the wire:

| event | payload | meaning |
| --- | --- | --- |
| `move` | wire player (`id, username, avatar, x, y, path, startedAt`) | server-validated walk started |
| `leave` | `{ id }` | player left / hopped rooms — drop the avatar |
| `chat` | `{ id, playerId, username, text, at }` | stored message echo |
| `chat_delete` | `{ id, playerId }` | commissioner deleted a message |
| `kicked` | `{ id, until, message }` | the named player was removed; their client shows the removed screen, everyone else treats it as a leave |

Presence is keyed by `playerId`, so reconnects replace the old entry instead
of ghosting.

## API routes

All gameplay routes answer **404** unless `NEIGHBORHOOD_PUBLIC` is true or the
admin cookie is present; the moderation route answers 404 unless the admin
cookie is present, full stop.

- `POST /api/neighborhood/join` — claim username (ci-unique among active),
  enforce capacity, upsert row, handle door hops; rejects `bad_name`,
  `name_taken`, `room_full`, `kicked`.
- `POST /api/neighborhood/move` — client sends a destination only; server
  computes the current position deterministically, runs the same A*, stores +
  broadcasts. Implicit speed cap. Rate-limited in Postgres.
- `POST /api/neighborhood/heartbeat` — bumps `last_seen` (never for banned
  rows).
- `POST /api/neighborhood/leave` — deletes the row + broadcasts (spares
  ban-record rows so a kicked client can't erase its own timeout).
- `GET/POST /api/neighborhood/chat` — history backfill / validated, muted-
  checked, rate-limited send.
- `GET/POST /api/neighborhood/admin` — moderation snapshot / actions `mute`,
  `kick` (default 10 min, max 24h), `unkick`, `delete_message`, `prune`.

## Moderation (commissioner only)

Dashboard → **Neighborhood Mod** (`/admin/neighborhood`):

- **Roster** of everyone active: room, joined, last seen, muted badge, with
  Mute/Unmute and **Kick 10m** buttons.
- **Kick**: stamps `kicked_until`, zeroes `last_seen` (out of rosters,
  capacity and name checks instantly), broadcasts `kicked` — the player's own
  client drops to a "You were removed" screen and every gameplay API refuses
  them until the ban lapses, whatever their client does. Lift early with
  **Lift ban**.
- **Mute**: flips the flag; the chat route answers the polite "you're muted"
  toast. Everything else (walking, doors) still works.
- **Recent messages** across all rooms, each with **Delete** — removal is
  broadcast so open chat logs and speech bubbles drop it live.

## Adding a room

A room is ONE entry in `ROOMS` in `lib/neighborhood/rooms.js` — the engine,
pathfinder, join API and moderation screen all read from it. No other file
needs to change. Recipe:

1. Write the config object (see the worked example below): id, name,
   capacity, world size, spawn, light+dark palettes, `walkable` polygon,
   `props` with footprints, `exits`, `drawBackground`.
2. Add it to the `ROOMS` export at the bottom.
3. Give players a door to it: add an exit to an existing room (e.g. the Town
   Square) whose `roomId` is your new room's id, and an exit back.

Worked example — a minimal "Arcade" off the square:

```js
const ARCADE = {
  id: "arcade",
  name: "Arcade",
  capacity: 10,
  width: 700,
  height: 800,
  spawn: { x: 350, y: 720 },
  palette: { light: ARCADE_LIGHT, dark: ARCADE_DARK }, // define both!
  walkable: [                       // clockwise floor polygon (feet space)
    { x: 40, y: 340 }, { x: 660, y: 340 },
    { x: 668, y: 770 }, { x: 32, y: 770 },
  ],
  exits: [{
    id: "town-square",
    label: "Town Square",
    roomId: "town-square",
    hotspot: { x: 256, y: 700, w: 188, h: 100 }, // tappable rect
    approach: { x: 350, y: 746 },   // walk here first
    arrive: { x: 480, y: 560 },     // where you appear in the target room
  }],
  props: [{
    id: "cabinet",
    x: 150, y: 480,                  // feet anchor (depth-sorts on y)
    draw: drawArcadeCabinet,         // (ctx, prop, P, theme, t) => ...
    footprint: { x: 100, y: 440, w: 100, h: 42 }, // blocks walking
  }],
  drawBackground: drawArcadeBackground, // walls/floor/signage, cached offscreen
};

export const ROOMS = { ...existing, [ARCADE.id]: ARCADE };
```

Then add to the Town Square's `exits` an entry with `roomId: "arcade"` (and an
`arrive` point on the arcade's floor). Conventions worth keeping: art is
procedural vectors in the flat-fill + soft-outline house style; `walkable` and
`footprint` describe FEET space (lower on screen = closer); spawn/arrive
points must sit inside the walkable polygon (the join API validates entry
points and falls back to spawn).

## Flipping NEIGHBORHOOD_PUBLIC — read before going league-wide

The flag lives in `lib/leagueData.js` (`NEIGHBORHOOD_PUBLIC = false`).
Flipping it to `true` opens `/neighborhood` and the gameplay APIs to everyone
with the link. **Do these first:**

1. **Harden the Realtime channels (the big one).** Today the per-room topics
   are public channels and clients subscribe with the anon key, which is fine
   only while the admin cookie gates everything. Once public, anyone can
   subscribe to `neighborhood:*` (read chat/positions) and — worse — publish
   spoofed `move`/`chat`/`kicked` events straight to other clients, bypassing
   the server. Before the flip, switch to **private channels with signed
   Realtime tokens** (Supabase Realtime authorization): the join API mints a
   scoped token for the player's current room, clients subscribe with it, and
   `private: true` goes on the server broadcasts. The seams are ready:
   client-side channel creation sits in one place (`lib/neighborhood/
   realtime.js`), server broadcast in one place (`broadcastToRoom`).
2. **Remember the trust model is leaderboard-grade.** Identity is a
   self-issued browser UUID; the APIs authenticate "a player id that joined",
   not a person. Event-level server authority stops teleporting/wall-clipping
   and rate-limits spam, but a motivated leaguemate can script their own
   client. That's the accepted bar for HSPN games (like the leaderboards) —
   fine for friends, not for strangers.
3. **Capacity + free-tier headroom.** Rooms cap at 24/12/12/16 by config.
   Every walk tap is an API call + broadcast; the Postgres instance is a
   nano and Supabase free tier caps Realtime concurrency and messages. A
   full league night is fine; a public link on the internet is not.
4. Give the moderation screen a once-over (it stays admin-only after the
   flip) and consider a shorter profanity leash — the filter is substring-
   based and friendly-league-grade.

## Known limitations

- **Peers see walks start ~150–300ms late** (serverless HTTP broadcast, no
  socket server). Your own avatar always moves instantly; the deterministic
  path math means everyone still ends up in exactly the same place.
- **Identity is per-browser.** Clearing site data = new character; the same
  person on two devices is two players. Deliberate (milestone-1 call).
- **No cross-visit position memory** — a clean leave deletes the row; you
  respawn at the room spawn next visit.
- **Chat history is shallow** by design: last 50 per room in the log, last 40
  in moderation; older rows stay in `neighborhood_messages` until manually
  cleared.
- **Ban records self-expire.** A kick's row disappears once `kicked_until`
  passes (next prune); there's no permanent ban list yet.
- **Profanity/name filter over-blocks** (substring on leetspeak-flattened
  text) and is English-only.
- **One shard per room.** A room at capacity bounces you; there are no
  parallel instances.
