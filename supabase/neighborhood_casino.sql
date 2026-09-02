-- HSPNeighborhood milestone 14: the casino (wallets + blackjack).
-- Run once in Supabase: SQL Editor > New query > paste > Run.
--
-- Two new tables, both RLS-ON with ZERO POLICIES — the house
-- pattern. Nothing here is readable or writable with the anon
-- key; every read and every write goes through the gated
-- /api/neighborhood/blackjack route using the service-role
-- client. That is what makes a forged "I won $500" event
-- impossible: clients cannot publish on the gameplay topic and
-- cannot touch these tables either.
--
-- PLAY MONEY ONLY. No real currency is represented anywhere in
-- this schema and nothing in the app can buy, sell, deposit or
-- withdraw. the balance column is a score.

-- ---------------------------------------------------------
-- 1. Wallets. Deliberately NOT a column on
--    neighborhood_players: that table is deleted on a clean
--    leave and pruned when a row goes stale, so a balance kept
--    there would be wiped every time somebody closed a tab.
-- ---------------------------------------------------------
create table if not exists public.neighborhood_wallets (
  id text primary key,                  -- per-browser player id
  balance integer not null default 100 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.neighborhood_wallets enable row level security;

-- ---------------------------------------------------------
-- 2. Blackjack tables. One row per table (today there is
--    exactly one: 'casino-floor:main'). The whole game lives
--    in the state jsonb column and is advanced ONLY by the engine in
--    lib/neighborhood/blackjack.js.
--
--    version is an optimistic lock. Every write is
--      update ... set state = $1, version = version + 1
--      where id = $2 and version = $3
--    so two lambdas acting on the same hand at the same time
--    cannot both win — the loser sees 0 rows updated, re-reads
--    and retries. No advisory locks, no long transactions.
-- ---------------------------------------------------------
create table if not exists public.neighborhood_blackjack (
  id text primary key,
  state jsonb not null,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.neighborhood_blackjack enable row level security;

-- ---------------------------------------------------------
-- 3. Walking into the casino: $100 on your first ever visit,
--    and a top-up if you have busted out since. Atomic, so two
--    tabs entering at once cannot double-grant.
--
--    p_floor is the "too broke to play" line, not zero: a
--    player sitting on $3 cannot cover the $5 minimum bet and
--    would be just as locked out as one on $0.
--    Returns the balance to show in the UI.
-- ---------------------------------------------------------
create or replace function public.neighborhood_casino_enter(
  p_id text,
  p_start integer,
  p_floor integer
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  bal integer;
begin
  insert into neighborhood_wallets (id, balance)
    values (p_id, p_start)
    on conflict (id) do update
      set balance = case
            when neighborhood_wallets.balance < p_floor then p_start
            else neighborhood_wallets.balance
          end,
          updated_at = now()
    returning balance into bal;
  return bal;
end;
$fn$;

-- ---------------------------------------------------------
-- 4. Sliding-window rate limit for table actions: at most 6
--    in any 3 seconds per player. Same atomic, row-locked
--    shape as neighborhood_record_move / _chat / _throw.
--    Returns 'ok' | 'rate_limited' | 'not_joined'.
-- ---------------------------------------------------------
alter table public.neighborhood_players
  add column if not exists bj_times jsonb not null default '[]'::jsonb;

create or replace function public.neighborhood_record_bj(p_id text, p_now_ms bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  t jsonb;
  kept jsonb;
begin
  select bj_times into t from neighborhood_players where id = p_id for update;
  if not found then
    return 'not_joined';
  end if;
  select coalesce(jsonb_agg(v), '[]'::jsonb) into kept
    from jsonb_array_elements(coalesce(t, '[]'::jsonb)) as v
    where (v)::text::numeric > p_now_ms - 3000;
  if jsonb_array_length(kept) >= 6 then
    update neighborhood_players set bj_times = kept where id = p_id;
    return 'rate_limited';
  end if;
  update neighborhood_players set bj_times = kept || to_jsonb(p_now_ms) where id = p_id;
  return 'ok';
end;
$fn$;

-- ---------------------------------------------------------
-- 5. Grants. Both functions are SECURITY DEFINER, so the
--    default PUBLIC execute grant would let anyone holding the
--    anon key mint themselves $100 or stamp another player's
--    rate-limit window. Only the service-role client (i.e. the
--    gated API route) may call them.
-- ---------------------------------------------------------
revoke all on function public.neighborhood_casino_enter(text, integer, integer) from public;
revoke all on function public.neighborhood_casino_enter(text, integer, integer) from anon;
revoke all on function public.neighborhood_casino_enter(text, integer, integer) from authenticated;
grant execute on function public.neighborhood_casino_enter(text, integer, integer) to service_role;
grant execute on function public.neighborhood_casino_enter(text, integer, integer) to postgres;

revoke all on function public.neighborhood_record_bj(text, bigint) from public;
revoke all on function public.neighborhood_record_bj(text, bigint) from anon;
revoke all on function public.neighborhood_record_bj(text, bigint) from authenticated;
grant execute on function public.neighborhood_record_bj(text, bigint) to service_role;
grant execute on function public.neighborhood_record_bj(text, bigint) to postgres;
