-- HSPNeighborhood milestone 32: the slot machines.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
--
-- Slots reuse EVERYTHING the casino already has: the wallet
-- (neighborhood_wallets), the $100 grant/refill
-- (neighborhood_casino_enter), and the atomic money mover
-- (neighborhood_wallet_delta). There is NO new state table — a
-- spin is a single request that debits the stake and credits
-- the win, both as atomic wallet deltas, so there is nothing to
-- persist between spins and nothing for two tabs to race over.
--
-- The only new thing here is a per-player rate limit, the same
-- atomic sliding-window shape as _bj / _horse / _throw. It is
-- anti-spam only; the money math is already safe on its own.
--
-- PLAY MONEY ONLY. The stake and the payout move the SAME
-- neighborhood_wallets balance blackjack and HSPN Downs use. No
-- real currency is represented anywhere and nothing in the app
-- can buy, sell, deposit or withdraw. `balance` is a score.

-- ---------------------------------------------------------
-- Sliding-window rate limit for pulling the handle: at most 8
-- in any 3 seconds per player. A 4-second spin means a human
-- cannot naturally exceed this; it only stops a scripted
-- hammer. Same atomic, row-locked shape as
-- neighborhood_record_bj / _horse.
-- Returns 'ok' | 'rate_limited' | 'not_joined'.
-- ---------------------------------------------------------
alter table public.neighborhood_players
  add column if not exists slot_times jsonb not null default '[]'::jsonb;

create or replace function public.neighborhood_record_slot(p_id text, p_now_ms bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  t jsonb;
  kept jsonb;
begin
  select slot_times into t from neighborhood_players where id = p_id for update;
  if not found then
    return 'not_joined';
  end if;
  select coalesce(jsonb_agg(v), '[]'::jsonb) into kept
    from jsonb_array_elements(coalesce(t, '[]'::jsonb)) as v
    where (v)::text::numeric > p_now_ms - 3000;
  if jsonb_array_length(kept) >= 8 then
    update neighborhood_players set slot_times = kept where id = p_id;
    return 'rate_limited';
  end if;
  update neighborhood_players set slot_times = kept || to_jsonb(p_now_ms) where id = p_id;
  return 'ok';
end;
$fn$;

-- ---------------------------------------------------------
-- Grants. SECURITY DEFINER, so the default PUBLIC execute grant
-- would let anyone holding the anon key stamp another player's
-- rate-limit window. Only the service-role client (the gated
-- API route) may call it.
-- ---------------------------------------------------------
revoke all on function public.neighborhood_record_slot(text, bigint) from public;
revoke all on function public.neighborhood_record_slot(text, bigint) from anon;
revoke all on function public.neighborhood_record_slot(text, bigint) from authenticated;
grant execute on function public.neighborhood_record_slot(text, bigint) to service_role;
grant execute on function public.neighborhood_record_slot(text, bigint) to postgres;
