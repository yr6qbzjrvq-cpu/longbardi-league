-- HSPNeighborhood milestone 13: tomatoes.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- (Already applied to the live project — this file is the record.)
--
-- Sliding-window rate limit for POST /api/neighborhood/throw:
-- one tomato per player per 1500ms. Same atomic, row-locked
-- shape as neighborhood_record_move / neighborhood_record_chat,
-- so parallel serverless lambdas cannot race past the cap.
-- Returns 'ok' | 'rate_limited' | 'not_joined'.

alter table public.neighborhood_players
  add column if not exists throw_times jsonb not null default '[]'::jsonb;

create or replace function public.neighborhood_record_throw(p_id text, p_now_ms bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  t jsonb;
  kept jsonb;
begin
  select throw_times into t from neighborhood_players where id = p_id for update;
  if not found then
    return 'not_joined';
  end if;
  select coalesce(jsonb_agg(v), '[]'::jsonb) into kept
    from jsonb_array_elements(coalesce(t, '[]'::jsonb)) as v
    where (v)::text::numeric > p_now_ms - 1500;
  if jsonb_array_length(kept) >= 1 then
    update neighborhood_players set throw_times = kept where id = p_id;
    return 'rate_limited';
  end if;
  update neighborhood_players set throw_times = kept || to_jsonb(p_now_ms) where id = p_id;
  return 'ok';
end;
$fn$;

-- Only the service-role client (the gated API route) may call
-- it. The function is SECURITY DEFINER, so leaving the default
-- PUBLIC execute grant in place would let anyone holding the
-- anon key stamp throw_times on a player id they know.
revoke all on function public.neighborhood_record_throw(text, bigint) from public;
revoke all on function public.neighborhood_record_throw(text, bigint) from anon;
revoke all on function public.neighborhood_record_throw(text, bigint) from authenticated;
grant execute on function public.neighborhood_record_throw(text, bigint) to service_role;
grant execute on function public.neighborhood_record_throw(text, bigint) to postgres;
