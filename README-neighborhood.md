# HSPNeighborhood

A Club Penguin-style browser world for the league, living at `/neighborhood`
on the HSPN site (longbardi-league.vercel.app, a.k.a. hspn.vercel.app). Make a
character, walk the Town Square, step through doors into the Grocery Store, the
Fast Food Place and the Sports Bar, and chat with whoever's around — realtime
multiplayer, original procedural art (every pixel drawn in canvas code, no
image assets), phone-friendly.

Built across milestones 1–10; this file is the operator's manual. **It is live
for the whole league** — `NEIGHBORHOOD_PUBLIC` is true, there is a
Neighborhood link in the site nav, and anyone with the link can make a
character and walk in. Moderation, and the ability to put a picture on the
Mission Control big board, stay commissioner-only. (And if someone in the
Sports Bar winks at you: yes, the rumors are true — see "The secret room
chain" below.)

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
| Chat text rules (sanitize, cap, filter) | `lib/neighborhood/chat.js` |
| Server helpers + Realtime broadcast | `lib/neighborhood/multiplayerServer.js` |
| Client realtime transport | `lib/neighborhood/realtime.js` |
| Realtime topic names (shared) | `lib/neighborhood/topics.js` |
| Realtime token minting (server) | `lib/neighborhood/realtimeAuth.js` |
| Broadcaster grants (sign/verify) | `lib/neighborhood/broadcastGrant.js` |
| Channel RLS policies (run once) | `supabase/neighborhood_realtime_auth.sql` |
| Gameplay APIs | `app/api/neighborhood/{join,move,heartbeat,leave,chat,token}/route.js` |
| Screen-share auth (admin-only mint) | `app/api/neighborhood/broadcast/route.js` |
| Screen-share grant check (any player) | `app/api/neighborhood/broadcast/verify/route.js` |
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
                                    # also derives the broadcaster-grant HMAC key
ADMIN_PASSWORD=...                  # commissioner login (cookie-based, lib/auth.js)
SUPABASE_JWT_SECRET=...             # OPTIONAL; Supabase > Settings > JWT Keys >
                                    # Legacy JWT Secret. Set it to upgrade
                                    # Realtime subscribes from "anon key" to
                                    # "token scoped to one room" (see
                                    # "Channel authorization")
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

**Two private channels per room** (`lib/neighborhood/topics.js`):

| topic | who writes | carries |
| --- | --- | --- |
| `neighborhood:<roomId>` | **the server only** | `move`, `leave`, `chat`, `chat_delete`, `kicked` + presence |
| `neighborhood-rtc:<roomId>` | any player in the room | the five `rtc-*` screen-share events |

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
  pins that browser to the one room it asked for. The transport re-mints on
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
- `POST /api/neighborhood/heartbeat` — bumps `last_seen` (never for banned
  rows).
- `POST /api/neighborhood/leave` — deletes the row + broadcasts (spares
  ban-record rows so a kicked client can't erase its own timeout).
- `GET/POST /api/neighborhood/chat` — history backfill / validated, muted-
  checked, rate-limited send.
- `POST /api/neighborhood/token` — mint the Realtime credential for one room
  (see "Channel authorization"); refuses banned players.
- `GET/POST /api/neighborhood/broadcast` — **admin only.** GET: may this
  browser broadcast? POST without a nonce: authorize a capture session. POST
  with a viewer's nonce: mint that viewer's grant.
- `POST /api/neighborhood/broadcast/verify` — any player: is this grant real?
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

One more optional key, **`fitHeight: true`**. By default the camera picks a
zoom that fits the room's WIDTH and then scrolls vertically as you walk,
clamped to the room. That works for rooms you explore on foot, but it cannot
show scenery mounted *above* the floor: the camera follows your feet, so the
highest it can ever pan is "top of the walkable polygon minus half a
viewport". `fitHeight` tells the engine to zoom out until the whole room fits
vertically (`roomZoom()` in `components/NeighborhoodRoom.jsx`). It only ever
zooms out relative to the width rule, so nothing gets closer than before. Set
it on any room whose art must be seen but cannot be walked to — Mission
Control is the reason it exists.

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
   room sets `fitHeight: true`: without it a wide desktop window cropped the
   top of the board and the camera could not pan up to it (fixed in milestone
   10). The live feed is a DOM `<video>` re-pinned to that rect every frame,
   so it rides the camera exactly like painted scenery.

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
- **In `shared` channel mode, a determined reader can listen to a room they
  are not standing in** using the anon key from the bundle. They see positions
  and chat — the same things they would see by walking in, minus being seen.
  Setting `SUPABASE_JWT_SECRET` and tightening the policy closes it.
- **No TURN server for the big board.** A viewer behind a symmetric NAT sits
  at "connecting" and then fails, with a toast saying so. Adding a TURN entry
  to `ICE_SERVERS` in `lib/neighborhood/screenshare.js` is the one-line fix
  when someone actually hits it.
