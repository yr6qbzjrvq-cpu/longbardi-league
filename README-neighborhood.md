# HSPNeighborhood

A Club Penguin-style browser world for the league, living at `/neighborhood`
on the HSPN site (longbardi-league.vercel.app, a.k.a. hspn.vercel.app). Make a
character, walk the Town Square, step through doors into the Grocery Store, the
Fast Food Place and the Sports Bar, follow the blinking arrow east to the
**casino** and play real multiplayer blackjack, chat with whoever's around, and
throw tomatoes at any of it — realtime multiplayer, original procedural art
(every pixel drawn in canvas code, no image assets), phone-friendly.

Built across milestones 1–10; this file is the operator's manual. **It is live
for the whole league** — `NEIGHBORHOOD_PUBLIC` is true, there is a
Neighborhood link in the site nav, and anyone with the link can make a
character and walk in. Moderation, and the ability to put a picture on the
Mission Control big board — and, since milestone 12, on the Sports Bar's
screen over the counter, which shows the same feed — stay commissioner-only.
(And if someone in the Sports Bar winks at you: yes, the rumors are true — see
"The secret room chain" below.)

---

## Where everything lives

| Piece | Path |
| --- | --- |
| Page (public; 404s if the flag is turned off) | `app/neighborhood/page.jsx` |
| Screen flow (creator / room / full / removed) | `components/NeighborhoodClient.jsx` |
| Room engine (canvas, walking, doors, chat UI) | `components/NeighborhoodRoom.jsx` |
| Avatar creator | `components/NeighborhoodAvatarCreator.jsx` |
| Avatar drawing + normalization | `lib/neighborhoodAvatar.js` |
| Per-browser identity + username rules | `lib/neighborhoodPlayer.js` |
| Access gate (flag OR admin cookie) + origin guard | `lib/neighborhoodAccess.js` |
| Room registry — **one config object per room** | `lib/neighborhood/rooms.js` |
| Pathfinding (nav grid, A*, smoothing) | `lib/neighborhood/pathing.js` |
| Shared constant-speed walk math | `lib/neighborhood/movement.js` |
| Tomato flight, splat timing + splat art | `lib/neighborhood/tomatoes.js` |
| Blackjack rules engine (pure, testable) | `lib/neighborhood/blackjack.js` |
| First-person table art + card/chip drawing | `lib/neighborhood/casinoTable.js` |
| Blackjack rules harness (`node scripts/test-blackjack.mjs`) | `scripts/test-blackjack.mjs` |
| Chat text rules (sanitize, cap, filter) | `lib/neighborhood/chat.js` |
| Server helpers + Realtime broadcast | `lib/neighborhood/multiplayerServer.js` |
| Client realtime transport | `lib/neighborhood/realtime.js` |
| Realtime topic names (shared) | `lib/neighborhood/topics.js` |
| Realtime token minting (server) | `lib/neighborhood/realtimeAuth.js` |
| Broadcaster grants (sign/verify) | `lib/neighborhood/broadcastGrant.js` |
| TURN relay credentials (server) | `lib/neighborhood/turnCredentials.js` |
| Channel RLS policies (run once) | `supabase/neighborhood_realtime_auth.sql` |
| Tomato rate limit + column (run once) | `supabase/neighborhood_tomatoes.sql` |
| Casino wallets + blackjack tables (run once) | `supabase/neighborhood_casino.sql` |
| Gameplay APIs | `app/api/neighborhood/{join,move,heartbeat,leave,chat,throw,token}/route.js` |
| Blackjack API (seats, bets, cards, money) | `app/api/neighborhood/blackjack/route.js` |
| Screen-share auth (admin-only mint) | `app/api/neighborhood/broadcast/route.js` |
| Screen-share grant check (any player) | `app/api/neighborhood/broadcast/verify/route.js` |
| ICE / TURN credentials (any player in a room with a screen) | `app/api/neighborhood/ice/route.js` |
| Moderation API (admin-only) | `app/api/neighborhood/admin/route.js` |
| Moderation screen | `app/admin/neighborhood/page.jsx` + `components/NeighborhoodModeration.jsx` |

Design rule that makes the whole thing hold together: **pathing, movement,
chat and tomato rules are pure modules imported by both the client and the API
routes**,
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
                                    # also derives the broadcaster-grant HMAC key
ADMIN_PASSWORD=...                  # commissioner login (cookie-based, lib/auth.js)
SUPABASE_JWT_SECRET=...             # OPTIONAL; Supabase > Settings > JWT Keys >
                                    # Legacy JWT Secret. Set it to upgrade
                                    # Realtime subscribes from "anon key" to
                                    # "token scoped to one room" (see
                                    # "Channel authorization")
CF_TURN_KEY_ID=...                  # OPTIONAL PAIR; Cloudflare TURN key. With
CF_TURN_API_TOKEN=...               # both set, the big board works for
                                    # viewers on cellular. Without them the
                                    # site behaves exactly as it did before
                                    # (STUN only) — see "Relay (TURN)"
```

Without the Supabase vars the world still loads and you can walk solo — the
join API answers `not_configured` and the client shows "Multiplayer is
offline". `/neighborhood` is open to everyone now; log in at `/admin` only for
the moderation screen and the Share My Screen button.

## How deploys work

Push (or web-edit) to `main` on GitHub → Vercel builds and deploys
automatically. There is no staging branch, and the admin gate is no longer the
safety net for gameplay — `NEIGHBORHOOD_PUBLIC` in `lib/leagueData.js` is the
kill switch: set it false and the world 404s for everyone but the commissioner
again, nav link included.
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
| `throw_times` | jsonb | recent tomato timestamps (rate-limit window) |
| `last_seen` | timestamptz | heartbeat every 30s; younger than 75s = active |
| `muted` | boolean | chat blocked server-side when true |
| `kicked_until` | timestamptz | live timed ban; the row survives prune/leave while this is in the future |
| `created_at` | timestamptz | when this visit's row was first inserted ("joined") |

### Table `neighborhood_messages`

The chat trail: `id` (uuid), `player_id`, `username`, `room`, `text`,
`created_at`. Backs the chat-log backfill (last 50 per room) and the
moderation view (last 40 overall). Text is sanitized to plain text before
insert; deletes happen only through the moderation API.

### Table `neighborhood_wallets` (milestone 14)

Play-money balances for the casino. `id` (player id, PK), `balance` (integer,
`>= 0`, default 100), `created_at`, `updated_at`. RLS on, zero policies.

**It is deliberately not a column on `neighborhood_players`.** That table is
deleted on a clean leave and pruned when a row goes stale, so a balance kept
there would be wiped every time somebody closed a tab. This one is never
pruned — the row is the player's bankroll.

### Table `neighborhood_blackjack` (milestone 14)

One row per table; today there is exactly one, `casino-floor:main`. Columns:
`id` (PK), `state` (jsonb — the entire game), `version` (bigint), `updated_at`.
RLS on, zero policies.

`version` is an optimistic lock. Every write is
`update ... set state = $1, version = version + 1 where id = $2 and version = $3`,
so two lambdas acting on the same hand cannot both win: the loser sees zero
rows updated, re-reads and retries (four attempts, then a 503 the client
retries on its next sync). No advisory locks and no transaction held open
across a request.

### SQL functions (Database → Functions in the Supabase dashboard)

All three are `plpgsql`, `SECURITY DEFINER`, `SET search_path TO 'public'`, and
implement atomic sliding-window rate limits by locking the player row
(`select ... for update`) so parallel serverless lambdas can't race past the
cap. All return `'ok'`, `'rate_limited'` or `'not_joined'`.

- `neighborhood_record_move(p_id text, p_now_ms bigint)` — keeps timestamps
  in `move_times` newer than `p_now_ms - 1000`; refuses when 3+ remain
  (~3 moves/sec).
- `neighborhood_record_chat(p_id text, p_now_ms bigint)` — same shape on
  `chat_times` with a 2000ms window and a cap of 1 (~1 message / 2s).
- `neighborhood_record_throw(p_id text, p_now_ms bigint)` — same shape on
  `throw_times` with a 1500ms window and a cap of 1 (~1 tomato / 1.5s).
  Source: `supabase/neighborhood_tomatoes.sql`. Unlike the other two, its
  PUBLIC execute grant is revoked — it is `SECURITY DEFINER`, so leaving the
  default in place would let anyone holding the anon key stamp `throw_times`
  on a player id they know. Worth doing to the older two as well.
- `neighborhood_record_bj(p_id text, p_now_ms bigint)` — same shape on
  `bj_times` with a 3000ms window and a cap of 6 (~2 table actions/sec).
  Anti-spam only: the table's own phase machine is what refuses an
  out-of-turn move. Execute is granted to `service_role` only.
- `neighborhood_casino_enter(p_id text, p_start integer, p_floor integer)` —
  the $100. One atomic upsert: creates the wallet on a first-ever visit, and
  tops a returning player back up to `p_start` if their balance has fallen
  below `p_floor`. Two tabs entering at once therefore cannot double-grant.
  Returns the balance. Execute is granted to `service_role` only. Source for
  both: `supabase/neighborhood_casino.sql`.

### Realtime channels

**Two private channels** (`lib/neighborhood/topics.js`) — a gameplay one per
room, and ONE screen-share one shared by every room that has a screen:

| topic | who writes | carries |
| --- | --- | --- |
| `neighborhood:<roomId>` | **the server only** | `move`, `leave`, `chat`, `chat_delete`, `kicked`, `throw` + presence |
| `neighborhood-rtc:big-board` | any player watching a screen | the five `rtc-*` screen-share events + presence |

The signaling topic was per-room until milestone 12. That quietly capped a
broadcast at the room it started in: a viewer in the Sports Bar was subscribed
to a different topic, so the broadcaster in Mission Control never heard its
hello and never offered it anything. Both rooms with a screen now share one
topic (`screenChannelFor()` in the room registry), so a single mesh spans both
rooms — no second connection, no second announcement, no second grant. **Rooms
with no screen open no signaling channel at all**, which is one fewer channel
per player than before in five of the seven rooms.

Both are opened with `private: true`, so Supabase runs the RLS policies in
`supabase/neighborhood_realtime_auth.sql` on every subscribe and every
client-side publish. API routes broadcast server-side over Supabase's HTTP
endpoint (`POST <url>/realtime/v1/api/broadcast`) with the service-role key,
which bypasses RLS — see `broadcastToRoom()` in
`lib/neighborhood/multiplayerServer.js`.

The split is the whole design. Clients can read the gameplay topic and track
presence on it, but **cannot publish to it**, so a forged `move`, `chat` or
`kicked` event is impossible: those can only come from a route that validated
them. The handshake topic has to be client-writable, so nothing on it is
trusted on identity alone — see "Broadcaster identity" below.

Events on the wire:

| event | payload | meaning |
| --- | --- | --- |
| `move` | wire player (`id, username, avatar, x, y, path, startedAt`) | server-validated walk started |
| `leave` | `{ id }` | player left / hopped rooms — drop the avatar |
| `chat` | `{ id, playerId, username, text, at }` | stored message echo |
| `throw` | `{ id, playerId, username, kind, targetId, ox, oy, tx, ty, sx, sy, at, flightMs }` | server-validated tomato; every client replays the same arc |
| `chat_delete` | `{ id, playerId }` | commissioner deleted a message |
| `kicked` | `{ id, until, message }` | the named player was removed; their client shows the removed screen, everyone else treats it as a leave |

Presence is keyed by `playerId`, so reconnects replace the old entry instead
of ghosting.

### Channel authorization

Before subscribing, the client asks `POST /api/neighborhood/token` for a
credential. Two modes, decided by the server:

- **`scoped`** — `SUPABASE_JWT_SECRET` is set, so the route mints a one-hour
  HS256 token carrying an `nb_room` claim (`lib/neighborhood/realtimeAuth.js`)
  and the client hands it to `supabase.realtime.setAuth()`. The RLS policy
  pins that browser to the one room it asked for. A room with a screen also
  gets an `nb_screen` claim naming the shared board channel — **re-run
  `supabase/neighborhood_realtime_auth.sql` before turning the secret on**, or
  a scoped browser cannot subscribe to the signaling topic and both screens
  sit on AWAITING FEED. The transport re-mints on
  the heartbeat, ten minutes before expiry, so a long visit never drops.
- **`shared`** — no signing secret configured. The browser presents the
  project anon key instead, which the read policy also accepts. It can read
  any neighborhood topic, which is no worse than walking into the room.

**Either way the write rules are identical**, and the write rules are what
stop forgery. The token narrows *which room you may listen to*; it is not the
thing keeping people honest. Turning the secret on is therefore an
upgrade, not a prerequisite — and the last step of it (dropping the anon
fallback from the policy so only minted tokens can subscribe at all) is a
one-statement SQL change documented at the bottom of the `.sql` file.

A kicked player gets no token: the route refuses while a ban is live, so they
cannot even listen in on the room they were removed from.

### Broadcaster identity

Signaling is client-writable, so "the offer says it's from Austin" proves
nothing on its own. Every WebRTC offer therefore carries a **grant**
(`lib/neighborhood/broadcastGrant.js`) that only the admin-cookie-gated
`POST /api/neighborhood/broadcast` can mint, and the viewer checks it at
`POST /api/neighborhood/broadcast/verify` **before it looks at the SDP**.

Replay is closed by binding each grant to a nonce the *viewer* invented for
its own page load: the viewer puts the nonce in its `rtc-hello`, the
broadcaster gets a grant minted for exactly that nonce, and verification fails
if the nonce doesn't match. So a captured grant is worthless at anyone else,
and stale ones die with the page (and in five minutes regardless).

`rtc-live` carries no authority at all: a forged "I'm live" only makes viewers
say hello, and a forged "I stopped" is ignored unless it comes from the
broadcaster that viewer actually verified.

Sharing the channel across two rooms (milestone 12) moved none of this. The
grant still names Mission Control, because "may this browser put a picture on
the board" is one permission and not one per room, and the viewer still checks
it against its own nonce before it looks at the SDP. What the channel decides
is who can be *reached*; what the grant decides is who is *believed*. The
broadcaster's own sanity check — refuse any id that is not present — now reads
presence on the shared board channel (everyone watching, in either room)
instead of one room's roster. That check is a HINT, not a gate: this
deployment's Realtime currently reports no presence at all (see "Known
limitations"), so when presence says nothing the broadcaster answers the hello
anyway. It has to be that way round — presence is a claim a client publishes,
while the grant is a signature only the server can make.

### Relay (TURN) — how the big board works on cellular

STUN only tells each side what its own public address looks like; the two
peers still have to reach each other directly. On home wifi they can. On
**cellular they usually can't**: carrier-grade NAT is symmetric, so the phone
gets a different public port for every destination and the address STUN
learned is useless to the broadcaster. That connection sat at "connecting",
then failed, then toasted "that connection needs a relay". Milestone 11 adds
the relay.

- **Where the credential comes from.** `POST /api/neighborhood/ice` calls
  Cloudflare's TURN API (`rtc.live.cloudflare.com/v1/turn/keys/<id>/
  credentials/generate-ice-servers`) with the two env vars and hands the
  browser back a short-lived username/password plus the relay URLs. The key
  itself never leaves the server.
- **Who may ask.** The gameplay gate + same-origin, then a player id with an
  **active, unbanned row standing in the room it asked for, and that room must
  have a screen** (Mission Control or the Sports Bar). Plus a sliding-window
  rate limit (12 per player / 40 per IP per 5 min, per lambda). Farming it is
  pointless anyway: the server mints **one** credential set with a 4h TTL and
  serves the same cached copy to everyone, so a thousand calls cost Cloudflare
  one API call.
- **Who asks.** Both halves of the mesh, right before building a peer
  connection (`fetchIceServers()` in `lib/neighborhood/screenshare.js`),
  cached for the page. Viewers pre-warm it when they walk in and when a
  broadcast starts, so no handshake waits on it.
- **When it isn't configured** — no env vars, Cloudflare down, timeout, rate
  limited, Supabase unreachable — every path returns the plain STUN list,
  which is byte-for-byte what shipped before TURN existed. `GET
  /api/neighborhood/ice` answers `{ configured: false }` and the wifi path is
  untouched. This is a strict addition; nothing regresses without the vars.
- **Cost.** $0.05/GB with the first 1,000 GB per month free. Relay is used
  only for peers that can't connect directly, and only for the megabytes that
  actually flow — a league night is comfortably inside the free tier.
- **The toast now says two different things.** Failure with no relay
  configured still says "that connection needs a relay" (accurate: it does).
  Failure *with* a relay is a fluke, so it says to walk out and back in.

## API routes

Gameplay routes answer **404** unless `NEIGHBORHOOD_PUBLIC` is true or the
admin cookie is present — which, now that the flag is true, means they answer
everyone. What replaced the cookie as the gate is validation, unchanged from
before and now doing the real work: a well-formed `playerId`, a room that
exists in the registry, a destination the pathfinder agrees with, no live ban,
and the Postgres sliding-window rate limits. They also refuse a request whose
`Origin` header names another site, so a third-party page can't drive a
visitor's session (a bare script with no Origin is still allowed — the
validation above, not the header, is the authority).

The moderation route and the broadcast **mint** answer 404 unless the admin
cookie is present, full stop. `broadcast/verify` is deliberately open to any
player: it only ever says yes or no about a grant the caller already holds.

- `POST /api/neighborhood/join` — claim username (ci-unique among active),
  enforce capacity, upsert row, handle door hops; rejects `bad_name`,
  `name_taken`, `room_full`, `kicked`.
- `POST /api/neighborhood/move` — client sends a destination only; server
  computes the current position deterministically, runs the same A*, stores +
  broadcasts. Implicit speed cap. Rate-limited in Postgres.
- `POST /api/neighborhood/blackjack` — every casino action behind one route:
  `enter` (claim the $100), `sync` (advance the clock), `sit`, `stand`, `bet`,
  `ready`, `hit`, `stay`, `double`, `split`. Clients send an INTENT, never an
  outcome and never a card. See "The casino" below.
- `POST /api/neighborhood/heartbeat` — bumps `last_seen` (never for banned
  rows).
- `POST /api/neighborhood/leave` — deletes the row + broadcasts (spares
  ban-record rows so a kicked client can't erase its own timeout).
- `GET/POST /api/neighborhood/chat` — history backfill / validated, muted-
  checked, rate-limited send.
- `POST /api/neighborhood/throw` — throw a tomato. Client sends a TARGET only;
  the server computes the origin, the flight time and the landing point and
  broadcasts one record. Rate-limited in Postgres. **Not** muted-checked — see
  "Tomatoes" below.
- `POST /api/neighborhood/token` — mint the Realtime credential for one room
  (see "Channel authorization"); refuses banned players.
- `GET/POST /api/neighborhood/broadcast` — **admin only.** GET: may this
  browser broadcast? POST without a nonce: authorize a capture session. POST
  with a viewer's nonce: mint that viewer's grant.
- `POST /api/neighborhood/broadcast/verify` — any player: is this grant real?
- `GET/POST /api/neighborhood/ice` — GET: does this deployment have a relay?
  POST: ICE servers (Cloudflare TURN credentials when configured, STUN
  otherwise) for one active player standing in a room with a screen.
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
points and falls back to spawn). Two optional keys power the secret chain
(milestone 8): `interact[]` and `exits[].requiresFlag` — see the next
section.

One more optional key, **`fitRoom: true`** (it was called `fitHeight` until
milestone 12). By default the camera picks a zoom that fits the room's WIDTH
and then scrolls vertically as you walk, clamped to the room. That works for
rooms you explore on foot, but it cannot show scenery mounted *above* the
floor: the camera follows your feet, so the highest it can ever pan is "top of
the walkable polygon minus half a viewport". `fitRoom` tells the engine to zoom
out until the WHOLE room fits the viewport — both axes, down to a floor of
`MIN_FIT_ZOOM` (0.4) (`roomZoom()` in `components/NeighborhoodRoom.jsx`). It
only ever zooms out relative to the width rule, so nothing gets closer than
before. Set it on any room whose art must be seen but cannot be walked to —
Mission Control is the reason it exists, and the Sports Bar screen is the
reason it grew the width half: that screen is 608px wide in an 800px-wide
room, so on a phone the `MIN_ZOOM` floor (there to keep avatars readable) was
the thing that would have cropped it.

## The secret room chain (milestone 8)

The Sports Bar hides a three-room easter egg behind its restroom door:

1. **Restroom** (`restroom`, cap 8) — door on the bar's back wall, right of
   the dartboard. Tap the toilet in the stall and the wall it's mounted on
   spins 180° into a brick tunnel mouth.
2. **Hidden Hallway** (`hidden-hallway`, cap 8) — through the tunnel. At the
   far end: a riveted steel blast door with a number pad. Tapping it opens a
   full-screen keypad; the code is **2723**. Wrong codes flash ACCESS DENIED
   and shake. The right one rolls the door open.
3. **Mission Control** (`mission-control`, cap 12) — the football bunker.
   Dark ops palette, operator consoles, and ONE big wall screen front and
   center. The screen's inner surface is the exported `MISSION_SCREEN` rect
   in `lib/neighborhood/rooms.js` — **exactly 16:9 (608 x 342 world px)**,
   sitting at y 36-378 while the floor starts at y 452. That gap is why the
   room sets `fitRoom: true`: without it a wide desktop window cropped the
   top of the board and the camera could not pan up to it (fixed in milestone
   10). The live feed is a DOM `<video>` re-pinned to that rect every frame,
   so it rides the camera exactly like painted scenery. Since milestone 12 the
   Sports Bar has a screen of its own — same size, same feed, same code — see
   "The Sports Bar screen" below.

   **Watching is not sharing.** Two capability checks, deliberately
   separate: `screenViewSupported()` (just an `RTCPeerConnection`) decides
   whether a browser gets a VIEWER, and `screenShareSupported()` (which also
   needs `getDisplayMedia`, a capture API no mobile browser implements)
   decides whether it gets the Share My Screen button. They were one check
   until this was fixed, and the room gated the viewer on the sharing one —
   which is why every phone sat on AWAITING FEED while desktops watched
   happily. A phone never built a viewer, so it never sent `rtc-hello`, so it
   was never offered anything. Nothing to do with signaling, grants or the
   channel policies. If you ever add a capability gate around the board,
   check which half of the feature you are gating.

How it's wired:

- Two room-config keys, both read by the engine
  (`components/NeighborhoodRoom.jsx`): `interact[]` — tappable hotspots
  where `type: "reveal"` flips a flag instantly and `type: "keypad"` opens
  the full-screen keypad and flips the flag on the right `code` — and
  `exits[].requiresFlag`, which makes a door answer taps only once that
  flag is set. Props animate off the flag's trigger time (the spinning
  wall, the sliding blast door).
- Discovery is **per-player, per-visit client state** (`s.flags` in the
  engine): peers don't see your wall spin, and a reload closes everything
  again. Deliberate — it keeps the reveal magical for each player and adds
  zero server surface.
- The three rooms are ordinary registry rooms: separate Realtime channels,
  join-API capacity checks, room-scoped chat and moderation all work in
  them like anywhere else. They're only "secret" in the UI.
- **The keypad code lives in client code** (`interact[].code` in the room
  registry). That's theater for a friendly-league easter egg, not
  security — anyone reading the bundle can find it, and the rooms are
  joinable by id through the API regardless. Don't gate anything real this
  way.

## Going public — what the flip actually changed (milestone 10)

`NEIGHBORHOOD_PUBLIC` in `lib/leagueData.js` is **true**. Done, in order:

1. **Realtime channels hardened first**, as the checklist demanded. Rooms moved
   from one public topic to two private ones, and
   `supabase/neighborhood_realtime_auth.sql` decides who may do what on them.
   The headline: **clients can no longer publish gameplay events at all.**
   Before, anyone with the anon key could have sent your browser a fake `move`,
   a fake `chat` from someone else's name, or a fake `kicked` — none of it
   touching the server. Now the only writer on that topic is an API route
   holding the service-role key. The screen-share handshake keeps its own,
   writable topic, where identity is proved by signature instead.
2. **Gameplay routes swapped the admin cookie for validation.** They were
   always doing the validation; it just wasn't load-bearing while the cookie
   kept strangers out. Player-id shape, room existence, server-computed paths,
   ban checks and the Postgres rate limits are the gate now, plus a
   same-origin check on the mutating routes. Moderation and broadcast-start
   did **not** move: they check the admin cookie directly and 404 for
   everyone else, exactly as before.
3. **Broadcaster identity is signed.** The milestone-9 caveat — "viewers trust
   any rtc-offer from a playerId in the room" — is closed. See "Broadcaster
   identity" above. Austin is the only person who can put a picture on the big
   board, and that is now true on the wire, not by convention.
4. **Nav + banner.** A `Neighborhood` link appears in `components/Navbar.jsx`
   behind the same flag guard Pick 'Em uses, and the amber "Preview — only the
   admin login can see this" banner is gone (it keyed off the flag already).
5. **The secret room is still secret.** Keypad 2723 is unchanged and still
   client-side theater: it is a delight to discover, not a lock. Anyone
   reading the bundle can find the code, and all six rooms are joinable by id
   through the API regardless. Don't put anything real behind it.

### The optional upgrade still on the table

Set `SUPABASE_JWT_SECRET` in Vercel (value: Supabase → Settings → JWT Keys →
**Legacy JWT Secret**) and the token route starts minting room-scoped
credentials instead of falling back to the anon key — no code change, the
client asks the server which mode it is in. Then, once you have confirmed the
world still works, run the "TIGHTENING" statement at the bottom of
`supabase/neighborhood_realtime_auth.sql` to drop the anon fallback, after
which only a browser that went through the gated token route can subscribe to
a room at all. Worth doing; not urgent, because it narrows *who can listen*,
not *who can forge* — forgery is already closed.

### Trust model, restated now that the league is in

- **Identity is still a self-issued browser UUID.** The APIs authenticate "a
  player id that joined", not a person. Nothing about the flip changed this.
  Names are first-come, first-served among whoever is active.
- **What server authority buys you:** nobody teleports, walks through walls,
  chats faster than the rate limit, un-kicks themselves, speaks as another
  player, or ends someone else's ban. All of that is computed or checked
  server-side with the same modules the client renders with.
- **What it doesn't:** a motivated leaguemate can still script their own
  client and do anything a legitimate client could — join under any name
  that's free, walk anywhere walkable, chat at the rate limit, and hop into
  Mission Control without ever finding the keypad. That is the accepted bar
  for HSPN games, same as the leaderboards. Fine for friends.
- **Who can reach the world now:** anyone with the URL. There is no league
  roster check and no login — it is a public page on a public site, the same
  as Pick 'Em. Expect that to mean friends-of-the-league, and the occasional
  crawler. The moderation screen (`/admin/neighborhood`) is the answer to
  anyone who misbehaves: mute, kick 10m, delete message, all instant.

### Capacity + free-tier headroom (still fine)

Rooms cap at 24/12/12/16 by config, plus the secret chain's 8/8/12 — about 90
seats total, against a league of ~12 and their friends. Every walk tap is one
API call plus one broadcast; the Postgres instance is a nano and Supabase's
free tier caps Realtime concurrency and message volume. The private-channel
switch roughly doubles *channel* count per player (gameplay + signaling) but
not message volume, and both ride the one websocket a browser already has, so
concurrency headroom is unchanged in practice. A full league night is
comfortable. A link that escapes into the wild is not — if that happens, flip
`NEIGHBORHOOD_PUBLIC` back to false and the world closes instantly.

## The Sports Bar screen (milestone 12)

Austin's ask: *"Let's change the sports bar and have a TV in there too. Same
setup as mission control but over the bar, same size too. Get rid of the two
smaller TVs too."* So the bar's two small animated TVs (the looping fake game
with the score bug) are gone, and one big screen hangs over the counter,
showing **the same live feed as the Mission Control big board**.

### The room

The Sports Bar was 800 x 880 with a 340px wall — nowhere near enough wall for
a 608 x 342 screen. It is now **800 x 1030 with the wall line at y 560**, and
the screen (`BAR_SCREEN`, exported from `lib/neighborhood/rooms.js`) sits at
x 96-704, y 100-442: **exactly 16:9, exactly the size of `MISSION_SCREEN`**,
because both are pinned by the same code. Width stayed at 800 on purpose —
that is what keeps the whole screen inside a phone-width viewport at the
`fitRoom` zoom floor.

Everything else on that wall moved out from under it:

- the **back bar** (bottles, mirror, cabinet) came off the wall and became a
  floor prop standing behind the counter, which is where a real back bar is;
- the **HSPN SPORTS neon** is now the marquee on the wainscot directly under
  the screen — it reads as the screen's nameplate, the way MISSION CONTROL's
  plate does;
- the **framed jersey** and, below it, the **dartboard** are stage left of the
  screen; the **restroom door** (still the way into the secret chain) is
  stage right, taller now that the wall is;
- the **pennant string** runs across the top above the screen; jukebox, pub
  tables, stools and the exit mat just moved down with the floor.

The gap between the back bar and the counter is walkable on purpose: that is
the bartender's spot, and standing in it puts you behind the bar.

Standby art matches the board's: HSPN, a blinking **AWAITING FEED** (or
**INCOMING FEED** while a handshake is in flight), a tally light, plus a house
bug along the bottom so an idle screen still looks like a sports bar. Tap for
sound, tap again for theater, hold for OS fullscreen — same handlers, same
`<video>`, because the room engine pins that one element to
`screenRectFor(roomId)` and neither the pinning nor the gestures care which
room they are in.

### One broadcast, two rooms

The interesting half. Signaling used to ride `neighborhood-rtc:<roomId>`, so a
broadcaster in Mission Control and a viewer in the Sports Bar were on
different topics and could never have found each other. Three ways to fix
that: give the broadcaster a second connection into the bar's channel; teach
it to publish on both room topics; or **give every room with a screen one
shared signaling channel**. The third is what shipped, because it is the only
one where nothing has to know how many rooms there are:

- `lib/neighborhood/rooms.js` gained a `SCREENS` registry — room id → screen
  rect — plus `SCREEN_CHANNEL` (`"big-board"`), `screenRectFor()`,
  `roomHasScreen()` and `screenChannelFor()`. That is the entire config
  surface. Adding a third screen room is one entry in `SCREENS` and a rect on
  the wall; no transport, engine or API code changes.
- `lib/neighborhood/realtime.js` subscribes to `rtcTopic(screenChannelFor(room))`
  instead of `rtcTopic(room)`, and opens no signaling channel at all for a
  room with no screen.
- The broadcaster stays a single mesh with one `RTCPeerConnection` per viewer;
  it just now hears hellos from both rooms. One announcement, one grant per
  viewer nonce, one capture.
- Presence moved with it. The broadcaster's "I only answer people who are
  actually here" check reads presence on the board channel — everyone watching
  in either room — instead of one room's roster. It is deliberately a hint:
  when presence reports nobody (which is what this deployment does today) the
  hello is answered anyway, because presence was never the thing keeping a
  stranger's picture off the wall — the grant is.
- `/api/neighborhood/ice` now hands relay credentials to a player standing in
  **any** room with a screen (still: active row, unbanned, in the room it
  claims, rate limited). A bar viewer on cellular needs TURN exactly as much
  as a Mission Control viewer does.

**Nothing about trust moved.** Starting a broadcast is still admin-cookie-only
and still happens in Mission Control (that is where the Share My Screen button
renders, and `BROADCAST_ROOM_ID` is what the grant names). Viewers still refuse
any offer whose grant is not signed by the server and bound to the nonce they
invented for their own page load. Gameplay events are still unforgeable
because clients still cannot publish on the gameplay topic. The shared channel
widens *who a broadcast can reach*, never *who is believed* — which is the
same reason it was safe for the signaling topic to be client-writable in the
first place.

One consequence worth knowing: because the channel is shared, a viewer in the
bar and a viewer in Mission Control are indistinguishable to the mesh. That is
the point, but it also means "the broadcaster's avatar left the room" — the
shortcut that drops the feed instantly for Mission Control viewers — cannot
fire for bar viewers. They fall back to the ordinary path: `rtc-live false`
when Austin stops, which is what ends a broadcast anyway.

## Tomatoes (milestone 13)

Austin's ask: *"add the ability to throw tomatoes at other players and the
room. When a tomato hits it should splatter and fade away after a few seconds.
And it needs to be able to hit the TV too"*

Every player, every room, both themes. Tap **Tomato** in the header to arm a
throw; the next tap is the target. It lobs on an arc, splats, sticks for about
three seconds, then fades over another 1.4. **Mute does not stop it** — a
tomato is not speech (see "Moderation" below).

### Three things you can hit

| kind | target on the wire | where the splat lives |
| --- | --- | --- |
| `spot` | a world point, clamped to the room | painted in the world pass, depth-sorted on its y — a splat on the floor is in front of you, one up on a wall is behind everybody |
| `player` | a `targetId` | sticks to that avatar and walks around with them, scattered a little so three hits don't stack into one blob |
| `screen` | `sx`, `sy` in 0..1 of the room's screen rect | an overlay canvas pinned over the `<video>` — so it lands ON a live broadcast |

The screen case is the one worth explaining. The big board and the Sports Bar
TV are a DOM `<video>` re-pinned to `screenRectFor(roomId)` every frame, which
means anything painted on the world canvas is painted BEHIND the picture. So
there is now a second element in the same wrapper — a `<canvas>` pinned to the
identical rect, one z-layer above the video, `pointer-events: none`. Splats on
glass are drawn there, in screen-rect space, and fade there. It follows the
camera on the wall and follows the letterbox in theater mode (it matches the
`object-contain` rect, so a splat stays on the same pixel of picture when you
blow the feed up). It repaints only while something is on the glass, so an
idle screen costs nothing per frame.

Because that overlay is always mounted in a room with a screen, its bounding
box is also the honest answer to "where on the picture did that tap land?" —
which is how an armed tap on a live feed becomes an `sx`/`sy` in both framings.

### Why it looks the same in every browser

The same trick the walking uses. The client sends a **target**, never a
trajectory. The route computes where the thrower is standing (from the stored
path + timestamp — the deterministic walk math), how long the flight takes and
where it lands, then broadcasts ONE record: `(origin, target, at, flightMs)`.
Every client replays an identical arc from it, and nobody negotiates anything.

Splat **art** is deterministic too, and costs nothing on the wire: the blob's
lobes, its flecks and its seeds are generated by a small seeded PRNG
(mulberry32) keyed on a hash of the throw id, so two browsers hashing the same
id draw the same splatter without a byte of geometry crossing the network.
`lib/neighborhood/tomatoes.js` holds all of it — flight, timing, art — and is
imported by the engine and the route alike, which is the house rule for
anything both sides must agree on.

Player-seeking throws re-aim at the victim's live position every frame rather
than at a fixed point. That is still deterministic — every client computes that
position from the same broadcast path and timestamp — and it means a tomato
lands on someone who kept walking. The server's own aim leads the target by one
flight time for the same reason.

Your own throw draws instantly and the server's echo of it is dropped, exactly
like your own walk. So the thrower sees the arc with zero latency while peers
see it ~150–300ms later, and a player-targeted arc can differ by a few pixels
between your screen and theirs. Nobody has ever noticed a walk doing this.

### What stops a tomato cannon

- **Clients cannot publish a `throw` at all.** It rides the gameplay topic,
  which is server-write-only (milestone 10). A forged tomato is exactly as
  impossible as a forged chat message.
- **One throw per 1.5s per player**, enforced by `neighborhood_record_throw` in
  Postgres — atomic and row-locked, so parallel lambdas can't race it. The
  client paces itself to the same number so the 429 is rare; when it does fire
  the toast says "One tomato at a time — let that one land."
- If that SQL function is ever missing (a fresh database that hasn't run
  `supabase/neighborhood_tomatoes.sql`), the route falls back to a per-lambda
  in-memory window instead of 500ing. Weaker — a cold start forgets it — but it
  still stops hold-the-button spam, and the Postgres one takes over the moment
  it exists.
- Targets are validated: a `spot` is clamped into the room, a `screen` needs
  the room to actually have one and normalized coords in 0..1, a `player` must
  be an active, unbanned row **in the same room**.
- A kicked player can't throw, same as everything else.

### Moderation — and the toggle that isn't there yet

**Mute deliberately does not block throwing.** Mute is the chat sanction; a
tomato is a gesture, not speech, and the request was explicit about it. Nothing
is written to `neighborhood_messages` either: throws are ephemeral, so unlike
chat they leave **no moderation trail** — a tomato that landed five seconds ago
is gone and unauditable.

That is the right default for a friendly league, and it is also the gap. If
somebody ever turns the Town Square into a barrage, today's only answer is
**Kick 10m**, which is a heavier hammer than the offence. A per-player
**"no tomatoes"** flag would be the proportionate one: a `no_tomatoes` boolean
on `neighborhood_players`, checked in the throw route the way `muted` is
checked in the chat route, with a button next to Mute on `/admin/neighborhood`.
That is roughly a twenty-line change and it is worth adding the first time
anyone needs it — but not before, because a mod control nobody has needed is a
control nobody has tested. A room-wide "tomatoes off" switch is the same idea
one level up and probably the better one if a whole room ever gets out of hand.

### The UI call

An **armed state that consumes the next tap**, rather than a drag-to-aim or a
long-press. Reasons: it is one gesture on desktop and phone alike, the armed
state is visible (the button flips to **Cancel Aim**, the cursor goes
crosshair, a banner says what is about to happen), and it cannot be entered by
accident. Cancel is deliberately over-provided — the button, Escape, or just
throwing. Every control is 44px+ tall.

**Click-to-walk is untouched when nothing is armed.** The armed branch returns
before the interact/door/pathfinding code ever runs, so an armed tap can't open
a keypad or step through a door either — one tap, one tomato, straight back to
normal.

## The casino (milestone 14)

On the right-hand side of the Town Square there is now a paved path heading
east, with a big roadside arrow — CASINO, in Oswald, ringed by bulbs that chase
around the board and run out into the point of the arrow. Walk to the end of
the path and you are on the **Casino Strip**; one building, a marquee that
never stops blinking, and a door. Through the door is the **Casino** floor:
loud patterned carpet, six slot machines along the walls (scenery — they spin
and blink and that is all they do), a cashier cage, and a blackjack table in
the middle with three chairs.

Sit in a chair and the view changes to first person: you are looking at the
felt from your seat, the dealer is across from you, your cards are the big ones
at the bottom and the other two players are to your left and right. Everyone
else in the room keeps walking around, chatting and throwing tomatoes as
normal, and sees your avatar sitting in the chair.

### The rooms

Two ordinary registry entries, `casino-strip` and `casino-floor` — multiplayer,
chat, tomatoes, capacity and moderation all work because nothing about them is
special-cased anywhere. Both set `fitRoom: true`, for the reason Mission
Control and the Sports Bar do: the marquee and the BLACKJACK sign hang above
the walkable floor, and the camera follows your feet.

The Town Square itself is now **1120 wide instead of 960**. The extra 160px on
the east is the path. Nothing else moved — every prop, building and exit in
that room is positioned absolutely — and the zoom is unchanged in practice,
because Town Square's *height* is the binding axis at every viewport we
support. The path is not drawn by a path-drawing function: it is a spur added
to the room's `walkable` polygon, and the existing plaza code pours and curbs
whatever that polygon says. One new exit key, `noMat`, keeps the casino door
out of the loop that paints welcome mats at the three shop doors.

`casino-floor` adds one genuinely new config key, `seats`, handled by the room
engine exactly the way `exits` are: tap a chair, walk to its `approach`, and on
arrival ask the server for the seat. `anchor` is where a seated player's avatar
is painted. `CASINO_TABLE_SEATS` is exported from the registry because the room
engine and the blackjack route both need it and it must never drift between
them.

### House rules, as implemented

Chosen to be the plain, boring, standard versions — a friendly league table,
not a rules-lawyer's table. All of it lives in `lib/neighborhood/blackjack.js`
and all of it is covered by `node scripts/test-blackjack.mjs` (144 assertions).

| Rule | Choice |
| --- | --- |
| Shoe | 6 decks, shuffled server-side with a crypto-seeded Fisher-Yates |
| Cut card | 75% penetration; a shoe past it is replaced **between** hands, never mid-hand |
| Dealer | **stands on all 17s, including soft 17** (S17) |
| Blackjack | pays **3:2**, first two cards of an unsplit hand only |
| 21 after a split | just 21. Pays 1:1 |
| Push | bet returned, including player blackjack vs dealer blackjack |
| Double down | any first two cards, **including after a split**. Exactly one card, then the hand stands |
| Split | any two cards of **equal value** (so K-Q may be split). Up to **3 splits = 4 hands** |
| Split aces | one card each, then stand. **No re-splitting aces, no doubling them** |
| Insurance | **not offered.** Not implemented anywhere |
| Seats | 3. Turn order is seat 1, 2, 3 |
| Bets | $5 minimum, $100 maximum, whole dollars, chips of 5/25/100 |

Two edges worth stating out loud. A 3:2 payout on an odd bet rounds **down**,
in the house's favour — with a $5 minimum and whole-dollar chips the only way
to hit it is a bet like $25 ($37 instead of $37.50). And the dealer does not
draw to an audience of busted hands: if every live hand has gone over, the hole
card is turned and the hand is settled without a pointless draw.

### The clock, and why there is no cron

Blackjack needs time to pass on its own: a betting window closes, a turn times
out, the dealer draws one card at a time. Vercel functions do not run between
requests, so the clock is **pulled, not pushed**. Every client in either casino
room posts `sync` every 2.5s, and `BJ.tick()` advances the table by comparing
`now` to the deadline **stored in the state**.

That works because `tick()` is idempotent and deadline-driven: it does not
matter who calls it, how often, or whether two lambdas call it at the same
instant — the version guard means only one write lands, and the loser re-reads
a table that has already moved on. It also self-heals. If everyone walks out
mid-hand the table simply freezes, and the next person through the door ticks
it forward and reaps the empty seats on their first sync.

Phase clocks: 20s to bet, **25s per decision**, ~0.9s beats for the deal and
each dealer card, 6s on the results before the next hand. A turn that times out
**auto-stands** — never auto-hits, which would spend an absent player's money.

### Seats never get stuck

Four different ways a seat comes back, all of them server-side:

1. **Leave Table** — stands you up. Between hands the seat empties at once and
   an uncommitted bet is refunded.
2. **Leave Table mid-hand** — the seat is flagged `leaving` and your hands
   auto-stand. The hand plays out normally, and **you are still paid** — the
   winnings go to your wallet even though the seat is gone by then. The seat
   frees at payout.
3. **Disconnect / walk out / close the tab** — nobody has to press anything.
   Every `sync` checks each seated player's `neighborhood_players` row; a seat
   whose player has been pruned, has gone stale, or has left the room is stood
   up automatically, with the same mid-hand handling as above.
4. **Turn timeout** — does not free the seat, but never lets a hand hang.

A fourth player simply cannot sit: three seats, and the seat check is the
server's, not the button's.

### Money

**Play money. There is no real currency anywhere in this feature, nothing can
be bought, and nothing can be cashed out. `balance` is a score.** Please keep it
that way.

- Walking into either casino room calls `enter`, which grants **$100 on a
  player's first ever visit**.
- A player who comes back **below the $5 table minimum is topped back up to
  $100**. This is deliberately the table minimum rather than $0: somebody
  sitting on $3 can no more make a bet than somebody on $0, and being locked
  out of the only game in town is a worse outcome than a free refill. Practical
  consequence: **the casino cannot be lost at, only won at** — a busted player
  is always back to $100 next visit. If that ever feels too generous, the floor
  and the grant are two arguments to one SQL function.
- Bets are debited and paid **only** by the route. The engine moves the money
  into a per-seat mirrored balance, and the route persists **absolute** numbers
  to `neighborhood_wallets`, never deltas — so a dropped write is corrected by
  the next one instead of compounding. Balances are re-seeded from the wallet
  whenever a betting window is open.
- The balance shows as a green chip badge in the room header and again on the
  felt.

**One ordering rule the route must keep.** Inside the request the wallet
re-seed happens **before** `BJ.tick()`, never after. `tick()` credits winnings
straight into the seat's mirrored balance, and the wallet row does not learn
about them until `persistWallets()` runs at the end of the request — so a
re-seed placed after the tick overwrites every credit with the stale
pre-payout number and then persists *that*. The first live table did exactly
this: players were charged for their bets and never paid. The fix is the order,
and `scripts/test-blackjack.mjs` now asserts it both ways so it cannot come
back.

### What stops a forged hand

The same thing that stops a forged walk. Clients **cannot publish on the
gameplay Realtime topic** (RLS on `realtime.messages`, see
`supabase/neighborhood_realtime_auth.sql`), so a `blackjack` broadcast can only
have come from the route, which holds the service-role key. Both new tables are
RLS-on with **zero policies**, so the anon key cannot read a shoe or write a
balance either. And both new SQL functions are `SECURITY DEFINER` with their
PUBLIC execute grant revoked — otherwise anyone holding the anon key could mint
themselves $100.

The client is never told anything it should not know: `BJ.toWire()` strips the
**shoe** entirely and replaces the dealer's **hole card with a boolean**, so
there is nothing in the payload to peek at. (A test asserts this: the wire JSON
must not contain the hidden card.) The client's own legality helpers only decide
whether a *button is greyed out* — the server re-checks every one of them with
the same functions before it moves a card, so a hand-crafted request gets a 409
and a fresh copy of the true state.

### The engine is a pure module

`lib/neighborhood/blackjack.js` does no I/O, has no randomness of its own and
never calls `Date.now()`. Every entry point takes the state plus an explicit
`now` and returns a new state. That is what makes `scripts/test-blackjack.mjs`
possible — it stacks a shoe, deals a known hand, and asserts the outcome and
the exact dollar movement — and it is the same reason `pathing` and `movement`
are pure: one definition of the rules, imported by both the client and the
route.

Run it with `node scripts/test-blackjack.mjs`.

## Known limitations

- **A tomato leaves no trail.** Chat has `neighborhood_messages` behind it;
  throws have nothing. Good for the database, but it means "who splatted me?"
  is only answerable by whoever was looking. See "Moderation" above for the
  `no_tomatoes` toggle that isn't built yet.
- **Splats are per-client and per-visit.** They live in engine state, not in
  Postgres, so a reload wipes the ones already on the wall and a player who
  walks in three seconds after a throw never sees it. Deliberate: a splat is a
  4.6-second event, not world state. Walking to another room clears yours too.
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
- **A broadcast starts in Mission Control only.** Both screens show it, but
  the Share My Screen button lives in the bunker; Austin walks in there to go
  on air. Deliberate — one room owns the permission.
- **Realtime presence is reporting nothing on this project.** Found during the
  milestone-12 live test: a raw client can join `neighborhood:<room>` or the
  screen channel and track presence fine, but the app's own channels report an
  empty presence list on both topics (a Supabase client/server version thing —
  `@supabase/supabase-js` floats on `^2.47.10` with no lockfile, so a deploy
  can pick up a newer client whenever it rebuilds). The screen share no longer
  depends on it (presence is a hint), and the room's `enabled: true` request
  should restore it where the server honours the flag. What still degrades
  quietly: peers rely on presence join/leave as a backstop for avatars
  appearing and disappearing — moves, chat and the join roster are unaffected,
  so the world plays normally. Worth pinning the dependency and revisiting.
- **On a phone narrower than ~360 CSS px, Mission Control still crops.** With
  `fitRoom` fitting both axes, the Sports Bar screen is fully visible at every
  viewport tested (down to 320px wide) and the Mission Control board at 375px
  and up; below that, MC's 960px-wide room hits the 0.4 zoom floor and the
  camera pans. Walk to the middle of the room and the board is whole.
- **In `shared` channel mode, a determined reader can listen to a room they
  are not standing in** using the anon key from the bundle. They see positions
  and chat — the same things they would see by walking in, minus being seen.
  Setting `SUPABASE_JWT_SECRET` and tightening the policy closes it.
- **The relay is only as configured as the environment.** With
  `CF_TURN_KEY_ID` + `CF_TURN_API_TOKEN` set, viewers behind symmetric NAT
  (cellular) connect through Cloudflare TURN. Without them the old behaviour
  stands: those viewers sit at "connecting", fail, and get the "needs a relay"
  toast. `GET /api/neighborhood/ice` tells you which world a deploy is in.
- **TURN credentials are shared and not individually revocable.** One minted
  set is cached and served to every player in Mission Control for up to four
  hours, which is what makes the route unfarmable but also means a leaguemate
  who digs one out of their own browser could relay through it until it
  expires. Bounded by the TTL and the 1,000 GB free tier; if that ever
  matters, mint per player and use Cloudflare's revoke endpoint.
