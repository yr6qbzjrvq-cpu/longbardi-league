-- HSPNeighborhood milestone 27: dancing is a STATE, not a clip.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- (Already applied to the live project -- this file is the record.)
--
-- Milestone 26 shipped a 3.6 second clip behind a 4 second
-- cooldown. Austin, the next morning: *"Remove the cooldown, I
-- want them to keep dancing until they click on something
-- else."* So a dance now has a start and NO end time, and an
-- open-ended state needs somewhere authoritative to live:
-- dance_id + dance_at, on the dancer's own row.
--
-- Those two columns are what make "no end time" safe. They ride
-- the roster (toWirePlayer), so a late joiner sees a dance that
-- is already going and joins it on the right beat, a reconnect
-- heals a dance_stop broadcast that never arrived, and a dancer
-- whose laptop shut is swept away by the ordinary stale prune
-- instead of twitching forever in an empty room.
--
-- THE COOLDOWN IS GONE. Stop and start again on the very next
-- frame is a supported thing to do. What is left is a loose
-- flood guard on dance_times -- the milestone 26 column, kept
-- and repurposed -- allowing p_max starts per p_window_ms: a
-- number no hand can trip and a script trips at once.
--
-- p_action is 'start' or 'stop'.
-- Returns 'ok' | 'already_dancing' | 'not_dancing'
--         | 'rate_limited' | 'not_joined'.

alter table public.neighborhood_players
  add column if not exists dance_times jsonb not null default '[]'::jsonb;
alter table public.neighborhood_players
  add column if not exists dance_id text;
alter table public.neighborhood_players
  add column if not exists dance_at bigint;

-- The milestone 26 signature (p_cooldown_ms) is retired. Same
-- name, different arguments, so it has to GO rather than sit
-- there as an overload PostgREST could still resolve to.
drop function if exists public.neighborhood_record_dance(text, bigint, bigint);

create or replace function public.neighborhood_record_dance(
  p_id text,
  p_now_ms bigint,
  p_action text,
  p_dance_id text,
  p_window_ms bigint,
  p_max integer
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  t jsonb;
  kept jsonb;
  cur text;
begin
  select dance_times, dance_id into t, cur
    from neighborhood_players where id = p_id for update;
  if not found then
    return 'not_joined';
  end if;

  -- Stopping is free and unlimited: it is the thing every
  -- deliberate action in the room does on your behalf, and
  -- rate-limiting it could only ever leave a body dancing.
  if p_action = 'stop' then
    if cur is null then
      return 'not_dancing';
    end if;
    update neighborhood_players
      set dance_id = null, dance_at = null
      where id = p_id;
    return 'ok';
  end if;

  -- Redundant start. Not an error and not a new dance: the
  -- route answers ok and hands back the dance already running,
  -- so a double tap cannot restart the routine underneath the
  -- room, and no flood-guard slot is spent on it either.
  if cur is not null then
    return 'already_dancing';
  end if;

  select coalesce(jsonb_agg(v), '[]'::jsonb) into kept
    from jsonb_array_elements(coalesce(t, '[]'::jsonb)) as v
    where (v)::text::numeric > p_now_ms - p_window_ms;

  if jsonb_array_length(kept) >= p_max then
    update neighborhood_players set dance_times = kept where id = p_id;
    return 'rate_limited';
  end if;

  update neighborhood_players
    set dance_times = kept || to_jsonb(p_now_ms),
        dance_id = p_dance_id,
        dance_at = p_now_ms
    where id = p_id;
  return 'ok';
end;
$fn$;

-- Only the service-role client (the gated API route) may call
-- it. The function is SECURITY DEFINER, so leaving the default
-- PUBLIC execute grant in place would let anyone holding the
-- anon key park a dance on a player id they know -- or, worse
-- now that a dance has no end time, take one away.
revoke all on function public.neighborhood_record_dance(text, bigint, text, text, bigint, integer) from public;
revoke all on function public.neighborhood_record_dance(text, bigint, text, text, bigint, integer) from anon;
revoke all on function public.neighborhood_record_dance(text, bigint, text, text, bigint, integer) from authenticated;
grant execute on function public.neighborhood_record_dance(text, bigint, text, text, bigint, integer) to service_role;
grant execute on function public.neighborhood_record_dance(text, bigint, text, text, bigint, integer) to postgres;
