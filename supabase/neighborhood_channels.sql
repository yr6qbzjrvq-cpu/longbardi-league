-- HSPNeighborhood milestone 28: the TV guide.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- (Already applied to the live project -- this file is the record.)
--
-- Two features, one lineup table and one state row.
--
-- FEATURE 1 -- "the popup trick". Austin broadcasts YouTube TV
-- from a popup window his own tab opened, so his tab may set
-- that window's location whenever it likes (an opener is
-- allowed to navigate a window it opened, even cross-origin).
-- The room therefore gets a REMOTE: a viewer taps a channel,
-- the request goes through the gated route below, the route
-- broadcasts it on the gameplay topic -- which clients cannot
-- publish on -- and Austin's tab, and only Austin's tab, acts
-- on it by pointing the popup at that channel's URL.
--
-- FEATURE 2 -- always-available YouTube. When nobody is
-- broadcasting, the same guide flips a PUBLIC YouTube embed on
-- the two big screens, synchronised off one server-authored
-- row: the current channel plus when it started.
--
-- WHY ONE `changed_at` FOR BOTH. Popup mode only exists while
-- Austin is live and YouTube mode only exists while he is not,
-- so the two can never be fighting over the room at the same
-- moment. One timestamp is therefore the whole global rate
-- limit: "the remote was used <gap> ago, everybody wait".
--
-- RLS is ON with ZERO policies on both tables -- the house
-- pattern. Nothing is readable or writable with the anon key;
-- every access goes through the gated API routes holding the
-- service-role key.

-- ---- the lineup -------------------------------------------
-- Admin-maintained, two kinds in one table:
--   'tv'      name + a tv.youtube.com URL (Feature 1). The URL
--             is an OPAQUE string on purpose -- Austin pastes
--             whatever link his YouTube TV grid gives him and
--             nothing here tries to understand it.
--   'youtube' name + a public YouTube video/live URL or bare
--             id (Feature 2).
create table if not exists public.neighborhood_channels (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('tv', 'youtube')),
  name text not null,
  url text not null,
  sort integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists neighborhood_channels_kind_sort_idx
  on public.neighborhood_channels (kind, sort, created_at);

alter table public.neighborhood_channels enable row level security;

-- ---- what the board is showing right now -------------------
-- One row, id = the SCREEN CHANNEL id from
-- lib/neighborhood/rooms.js ('big-board'), because one
-- broadcast -- and now one TV guide -- lights up every room
-- with a screen.
--
-- yt_started_at is the sync clock for Feature 2: a viewer
-- walking in late seeks to (serverNow - yt_started_at). For a
-- live YouTube stream that is free; for a VOD it is what keeps
-- two phones on the same joke.
--
-- popup_by / popup_at are Feature 1's liveness. Austin's
-- broadcasting tab stamps them (through the admin-gated
-- broadcast route) while a popup-mode share is running, and
-- re-stamps them on a heartbeat. A stale stamp means the
-- remote is dead -- a closed laptop cannot leave the room
-- firing channel changes at nobody.
create table if not exists public.neighborhood_tv_state (
  id text primary key,
  yt_channel_id uuid references public.neighborhood_channels(id) on delete set null,
  yt_started_at bigint,
  tv_channel_id uuid references public.neighborhood_channels(id) on delete set null,
  changed_kind text,
  changed_by text,
  changed_at bigint,
  popup_by text,
  popup_at bigint,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.neighborhood_tv_state enable row level security;

insert into public.neighborhood_tv_state (id)
values ('big-board')
on conflict (id) do nothing;

-- The per-player flood guard's window, same shape as
-- move_times / chat_times / throw_times / dance_times.
alter table public.neighborhood_players
  add column if not exists channel_times jsonb not null default '[]'::jsonb;

-- ---- one atomic "may I change the channel" -----------------
-- Answers three questions in one row-locked call:
--   * is this player actually in the room (their row exists)
--   * has ANYBODY used the remote inside the last p_gap_ms
--     (the global limit -- this is the one that stops a fight
--     over the remote, and it is why the state row is locked
--     `for update` rather than read and then written: two
--     lambdas a millisecond apart must not both win)
--   * is this one player leaning on it (a loose per-player
--     flood guard, p_max starts per p_window_ms)
--
-- Returns jsonb so the route can tell the room WHEN it may ask
-- again and who had the remote last:
--   {"code":"ok","at":<ms>}
--   {"code":"cooling","retryInMs":<ms>,"changedBy":<name>,"changedAt":<ms>}
--   {"code":"rate_limited"}
--   {"code":"not_joined"}
--
-- Lock order is always players-then-state, everywhere, so
-- these can never deadlock each other.
create or replace function public.neighborhood_record_channel(
  p_id text,
  p_by text,
  p_board text,
  p_kind text,
  p_channel uuid,
  p_now_ms bigint,
  p_gap_ms bigint,
  p_window_ms bigint,
  p_max integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  t jsonb;
  kept jsonb;
  st neighborhood_tv_state%rowtype;
  since bigint;
begin
  select channel_times into t
  from neighborhood_players where id = p_id for update;
  if not found then
    return jsonb_build_object('code', 'not_joined');
  end if;

  select * into st from neighborhood_tv_state where id = p_board for update;
  if not found then
    insert into neighborhood_tv_state (id) values (p_board)
    on conflict (id) do nothing;
    select * into st from neighborhood_tv_state where id = p_board for update;
  end if;

  -- The global gate. Not an error anybody did anything about:
  -- the channel that just changed IS the answer.
  since := p_now_ms - coalesce(st.changed_at, 0);
  if st.changed_at is not null and since < p_gap_ms then
    return jsonb_build_object(
      'code', 'cooling',
      'retryInMs', p_gap_ms - since,
      'changedBy', st.changed_by,
      'changedAt', st.changed_at
    );
  end if;

  select coalesce(jsonb_agg(v), '[]'::jsonb) into kept
  from jsonb_array_elements(coalesce(t, '[]'::jsonb)) as v
  where (v)::text::numeric > p_now_ms - p_window_ms;

  if jsonb_array_length(kept) >= p_max then
    update neighborhood_players set channel_times = kept where id = p_id;
    return jsonb_build_object('code', 'rate_limited');
  end if;

  update neighborhood_players
  set channel_times = kept || to_jsonb(p_now_ms)
  where id = p_id;

  if p_kind = 'youtube' then
    update neighborhood_tv_state
    set yt_channel_id = p_channel,
        yt_started_at = p_now_ms,
        changed_kind = p_kind,
        changed_by = p_by,
        changed_at = p_now_ms,
        version = version + 1,
        updated_at = now()
    where id = p_board;
  else
    update neighborhood_tv_state
    set tv_channel_id = p_channel,
        changed_kind = p_kind,
        changed_by = p_by,
        changed_at = p_now_ms,
        version = version + 1,
        updated_at = now()
    where id = p_board;
  end if;

  return jsonb_build_object('code', 'ok', 'at', p_now_ms);
end;
$fn$;

-- Only the service-role client (the gated API route) may call
-- it. The function is SECURITY DEFINER, so leaving the default
-- PUBLIC execute grant in place would let anyone holding the
-- anon key change the channel on the whole bar without ever
-- being in the room.
revoke all on function public.neighborhood_record_channel(text, text, text, text, uuid, bigint, bigint, bigint, integer) from public;
revoke all on function public.neighborhood_record_channel(text, text, text, text, uuid, bigint, bigint, bigint, integer) from anon;
revoke all on function public.neighborhood_record_channel(text, text, text, text, uuid, bigint, bigint, bigint, integer) from authenticated;
grant execute on function public.neighborhood_record_channel(text, text, text, text, uuid, bigint, bigint, bigint, integer) to service_role;
grant execute on function public.neighborhood_record_channel(text, text, text, text, uuid, bigint, bigint, bigint, integer) to postgres;
