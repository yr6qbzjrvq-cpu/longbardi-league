-- HSPNeighborhood — Realtime channel authorization (milestone 10)
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- Run this BEFORE deploying the code that switches the client to
-- private channels; it is inert until then (RLS on
-- realtime.messages only applies to channels opened with
-- `private: true`).
--
-- WHAT THIS IS FOR
-- Until the go-public flip the room channels were PUBLIC topics
-- that any holder of the anon key could subscribe to — and, worse,
-- publish to. A leaguemate could have broadcast a forged `move`,
-- `chat` or `kicked` event straight at everyone else's browser,
-- with the server never seeing it. These policies close that.
--
-- THE SHAPE
-- Two topics per room (lib/neighborhood/topics.js):
--   neighborhood:<room>      gameplay
--   neighborhood-rtc:<room>  screen-share handshake
--
--   * READ (select) — allowed on both, for the anon key and for a
--     token minted by /api/neighborhood/token. A minted token
--     carries an `nb_room` claim and is pinned to that ONE room;
--     the anon key carries no claim and can read any neighborhood
--     topic, which is the status quo and is fine for a world that
--     is now open to anyone with the link. Set
--     SUPABASE_JWT_SECRET in the deployment to start minting, then
--     see "TIGHTENING" at the bottom to drop the anon fallback.
--
--   * WRITE (insert) — this is the part that matters.
--     - gameplay topic: PRESENCE ONLY. Clients announce
--       themselves; they cannot publish broadcast events. Every
--       move/chat/leave/kicked message therefore comes from an API
--       route using the service-role key, which bypasses RLS.
--     - rtc topic: broadcast allowed, because the WebRTC handshake
--       is peer to peer by nature. Identity there is proved by a
--       server-signed grant instead (lib/neighborhood/
--       broadcastGrant.js), so a forged offer is refused by the
--       viewer even though the channel accepted it.

-- Clean re-run.
drop policy if exists "neighborhood realtime read" on realtime.messages;
drop policy if exists "neighborhood realtime presence" on realtime.messages;
drop policy if exists "neighborhood realtime signaling" on realtime.messages;

-- Is this topic one of ours, and may the presented token see it?
-- A token with an nb_room claim is pinned to that room; a token
-- without one (the anon key) may read any neighborhood topic.
create or replace function public.neighborhood_topic_allowed(p_topic text)
returns boolean
language sql
stable
as $$
  select
    (p_topic like 'neighborhood:%' or p_topic like 'neighborhood-rtc:%')
    and (
      (auth.jwt() ->> 'nb_room') is null
      or p_topic = 'neighborhood:' || (auth.jwt() ->> 'nb_room')
      or p_topic = 'neighborhood-rtc:' || (auth.jwt() ->> 'nb_room')
    );
$$;

-- READ: subscribe to a room's topics.
create policy "neighborhood realtime read"
  on realtime.messages
  for select
  to anon, authenticated
  using (public.neighborhood_topic_allowed(realtime.topic()));

-- WRITE 1: presence on either topic (so avatars appear), and
-- nothing else on the gameplay one.
create policy "neighborhood realtime presence"
  on realtime.messages
  for insert
  to anon, authenticated
  with check (
    extension = 'presence'
    and public.neighborhood_topic_allowed(realtime.topic())
  );

-- WRITE 2: the screen-share handshake, on the rtc topic only.
create policy "neighborhood realtime signaling"
  on realtime.messages
  for insert
  to anon, authenticated
  with check (
    extension = 'broadcast'
    and realtime.topic() like 'neighborhood-rtc:%'
    and public.neighborhood_topic_allowed(realtime.topic())
  );

-- TIGHTENING (optional, after SUPABASE_JWT_SECRET is set in the
-- deployment and you have confirmed the world still works):
-- requiring the claim means only a browser that went through the
-- gated /api/neighborhood/token route can subscribe at all, and
-- only to the room it asked for. Re-run
-- neighborhood_topic_allowed with the fallback branch
--   (auth.jwt() ->> 'nb_room') is null
-- deleted. Put it back to roll back — no code change either way.
