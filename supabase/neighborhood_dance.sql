-- HSPNeighborhood milestone 26: the dance button.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- (Already applied to the live project — this file is the record.)
--
-- Gate for POST /api/neighborhood/dance. Plain sliding-window
-- rate limit, the same shape as neighborhood_record_throw:
-- has THIS player started a dance in the last p_cooldown_ms?
--
-- Unlike the big red button there is no second question to ask.
-- A dance belongs to one body, so two people dancing at once in
-- the same room is not a conflict, it is a party — no advisory
-- lock, no room-wide state, nothing to serialise.
--
-- The window comes in as a parameter so DANCE_COOLDOWN_MS in
-- lib/neighborhood/dance.js stays the single source of truth
-- and this function never drifts from the client.
--
-- Returns 'ok' | 'rate_limited' | 'not_joined'.

alter table public.neighborhood_players
  add column if not exists dance_times jsonb not null default '[]'::jsonb;

create or replace function public.neighborhood_record_dance(
  p_id text,
  p_now_ms bigint,
  p_cooldown_ms bigint
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  t jsonb;
  kept jsonb;
begin
  select dance_times into t from neighborhood_players where id = p_id for update;
  if not found then
    return 'not_joined';
  end if;

  select coalesce(jsonb_agg(v), '[]'::jsonb) into kept
    from jsonb_array_elements(coalesce(t, '[]'::jsonb)) as v
    where (v)::text::numeric > p_now_ms - p_cooldown_ms;

  if jsonb_array_length(kept) >= 1 then
    update neighborhood_players set dance_times = kept where id = p_id;
    return 'rate_limited';
  end if;

  update neighborhood_players set dance_times = kept || to_jsonb(p_now_ms) where id = p_id;
  return 'ok';
end;
$fn$;

-- Only the service-role client (the gated API route) may call
-- it. The function is SECURITY DEFINER, so leaving the default
-- PUBLIC execute grant in place would let anyone holding the
-- anon key stamp dance_times on a player id they know.
revoke all on function public.neighborhood_record_dance(text, bigint, bigint) from public;
revoke all on function public.neighborhood_record_dance(text, bigint, bigint) from anon;
revoke all on function public.neighborhood_record_dance(text, bigint, bigint) from authenticated;
grant execute on function public.neighborhood_record_dance(text, bigint, bigint) to service_role;
grant execute on function public.neighborhood_record_dance(text, bigint, bigint) to postgres;
