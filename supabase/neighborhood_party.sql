-- HSPNeighborhood milestone 25: the big red button.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- (Already applied to the live project — this file is the record.)
--
-- Gate for POST /api/neighborhood/party. It answers TWO
-- questions in one atomic call, because they have to agree:
--
--   1. has THIS player pressed a button in the last 20s?
--      (the rate limit — same sliding-window shape as
--      neighborhood_record_move / _chat / _throw)
--   2. is a party already running in THIS ROOM?
--      (extra presses during a show do nothing rather than
--      restarting it, which is what the room actually wants)
--
-- The room answer needs no new table: a successful press is
-- already stamped into party_times, so "the room's last party"
-- is the max stamp across everyone standing in it. What that
-- read DOES need is serialisation, or two lambdas a millisecond
-- apart could both read "no party" and both start one — hence
-- the transaction-scoped advisory lock keyed on the room id.
-- It is held for the microseconds this function runs and
-- released when the statement's transaction ends, so it can
-- never wedge anything.
--
-- Returns 'ok' | 'rate_limited' | 'party_running' | 'not_joined'.

alter table public.neighborhood_players
  add column if not exists party_times jsonb not null default '[]'::jsonb;

create or replace function public.neighborhood_record_party(
  p_id text,
  p_room text,
  p_now_ms bigint,
  p_cooldown_ms bigint,
  p_party_ms bigint
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  t jsonb;
  kept jsonb;
  last_room numeric;
begin
  -- one presser per room at a time, across every lambda
  perform pg_advisory_xact_lock(hashtext('nbparty:' || coalesce(p_room, '')));

  select party_times into t from neighborhood_players where id = p_id for update;
  if not found then
    return 'not_joined';
  end if;

  select coalesce(jsonb_agg(v), '[]'::jsonb) into kept
    from jsonb_array_elements(coalesce(t, '[]'::jsonb)) as v
    where (v)::text::numeric > p_now_ms - p_cooldown_ms;

  if jsonb_array_length(kept) >= 1 then
    update neighborhood_players set party_times = kept where id = p_id;
    return 'rate_limited';
  end if;

  select max((v)::text::numeric) into last_room
    from neighborhood_players p,
         jsonb_array_elements(coalesce(p.party_times, '[]'::jsonb)) as v
    where p.room = p_room;

  if last_room is not null and last_room > p_now_ms - p_party_ms then
    -- pruned, but NOT stamped: pressing during a show should
    -- not burn your own cooldown
    update neighborhood_players set party_times = kept where id = p_id;
    return 'party_running';
  end if;

  update neighborhood_players set party_times = kept || to_jsonb(p_now_ms) where id = p_id;
  return 'ok';
end;
$fn$;

-- Only the service-role client (the gated API route) may call
-- it. The function is SECURITY DEFINER, so leaving the default
-- PUBLIC execute grant in place would let anyone holding the
-- anon key stamp party_times on a player id they know.
revoke all on function public.neighborhood_record_party(text, text, bigint, bigint, bigint) from public;
revoke all on function public.neighborhood_record_party(text, text, bigint, bigint, bigint) from anon;
revoke all on function public.neighborhood_record_party(text, text, bigint, bigint, bigint) from authenticated;
grant execute on function public.neighborhood_record_party(text, text, bigint, bigint, bigint) to service_role;
grant execute on function public.neighborhood_record_party(text, text, bigint, bigint, bigint) to postgres;
