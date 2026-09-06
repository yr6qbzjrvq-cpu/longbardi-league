-- HSPNeighborhood milestone 24: HSPN Downs (the horse race).
-- Run once in Supabase: SQL Editor > New query > paste > Run.
--
-- One new table plus two new functions, all following the house
-- pattern set by supabase/neighborhood_casino.sql: RLS ON with
-- ZERO POLICIES, so nothing here is readable or writable with
-- the anon key. Every read and every write goes through the
-- gated /api/neighborhood/horses route using the service-role
-- client. That is what makes a forged "my horse won" event
-- impossible: clients cannot publish on the gameplay topic and
-- cannot touch this table either.
--
-- PLAY MONEY ONLY. The stake and the payout move the SAME
-- neighborhood_wallets balance the blackjack table uses. No
-- real currency is represented anywhere and nothing in the app
-- can buy, sell, deposit or withdraw. `balance` is a score.

-- ---------------------------------------------------------
-- 1. The meeting. One row per track; today there is exactly
--    one, 'casino-floor:track'. The whole state — which race
--    we are on, its seed, its winner, who has bet what — lives
--    in the state jsonb and is advanced ONLY by the pure engine
--    in lib/neighborhood/horses.js.
--
--    version is an optimistic lock, exactly as on
--    neighborhood_blackjack. Every write is
--      update ... set state = $1, version = version + 1
--      where id = $2 and version = $3
--    so of the several lambdas that may notice a race is over
--    at the same instant, exactly ONE settles it. That is what
--    stops a winner being paid twice.
-- ---------------------------------------------------------
create table if not exists public.neighborhood_horse_races (
  id text primary key,
  state jsonb not null,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.neighborhood_horse_races enable row level security;

-- ---------------------------------------------------------
-- 2. One atomic movement of a wallet, up or down.
--
--    A stake must not be a read-then-write: two tabs (or a
--    blackjack bet and a horse bet at the same instant) would
--    both read $10 and both spend it. The guard is in the WHERE
--    clause, so the balance can never go below zero and the
--    loser of the race simply gets NULL back and is told there
--    are not enough chips.
--
--    NULL also means "no wallet" — you have not walked into the
--    casino yet, which is what grants the $100 (see
--    neighborhood_casino_enter in neighborhood_casino.sql).
-- ---------------------------------------------------------
create or replace function public.neighborhood_wallet_delta(
  p_id text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  bal integer;
begin
  update neighborhood_wallets
     set balance = balance + p_delta,
         updated_at = now()
   where id = p_id
     and balance + p_delta >= 0
  returning balance into bal;
  if not found then
    return null;
  end if;
  return bal;
end;
$fn$;

-- ---------------------------------------------------------
-- 3. Sliding-window rate limit for placing a bet: at most 4 in
--    any 3 seconds per player. Same atomic, row-locked shape as
--    neighborhood_record_move / _chat / _throw / _bj.
--    Returns 'ok' | 'rate_limited' | 'not_joined'.
--
--    This is anti-spam only. What actually stops a second bet
--    is the engine's one-bet-per-player-per-race rule.
-- ---------------------------------------------------------
alter table public.neighborhood_players
  add column if not exists horse_times jsonb not null default '[]'::jsonb;

create or replace function public.neighborhood_record_horse(p_id text, p_now_ms bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  t jsonb;
  kept jsonb;
begin
  select horse_times into t from neighborhood_players where id = p_id for update;
  if not found then
    return 'not_joined';
  end if;
  select coalesce(jsonb_agg(v), '[]'::jsonb) into kept
    from jsonb_array_elements(coalesce(t, '[]'::jsonb)) as v
    where (v)::text::numeric > p_now_ms - 3000;
  if jsonb_array_length(kept) >= 4 then
    update neighborhood_players set horse_times = kept where id = p_id;
    return 'rate_limited';
  end if;
  update neighborhood_players set horse_times = kept || to_jsonb(p_now_ms) where id = p_id;
  return 'ok';
end;
$fn$;

-- ---------------------------------------------------------
-- 4. Grants. Both functions are SECURITY DEFINER, so leaving
--    the default PUBLIC execute grant in place would let
--    anyone holding the anon key mint themselves chips or
--    stamp another player's rate-limit window. Only the
--    service-role client (i.e. the gated API route) may call
--    them.
-- ---------------------------------------------------------
revoke all on function public.neighborhood_wallet_delta(text, integer) from public;
revoke all on function public.neighborhood_wallet_delta(text, integer) from anon;
revoke all on function public.neighborhood_wallet_delta(text, integer) from authenticated;
grant execute on function public.neighborhood_wallet_delta(text, integer) to service_role;
grant execute on function public.neighborhood_wallet_delta(text, integer) to postgres;

revoke all on function public.neighborhood_record_horse(text, bigint) from public;
revoke all on function public.neighborhood_record_horse(text, bigint) from anon;
revoke all on function public.neighborhood_record_horse(text, bigint) from authenticated;
grant execute on function public.neighborhood_record_horse(text, bigint) to service_role;
grant execute on function public.neighborhood_record_horse(text, bigint) to postgres;
