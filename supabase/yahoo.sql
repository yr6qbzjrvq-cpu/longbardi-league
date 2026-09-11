-- Yahoo Fantasy integration: the connection (tokens) and the response cache.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
--
-- SECURITY MODEL, in one line: both tables have Row Level Security ON and
-- ZERO policies, which means the anon key shipped to browsers can read
-- nothing at all. Every read and write goes through server code holding
-- SUPABASE_SERVICE_ROLE_KEY, exactly like the rest of this project.

-- ---------------------------------------------------------------------
-- 1. The connection. Exactly one row, id = 'default'.
-- ---------------------------------------------------------------------
create table if not exists public.yahoo_connection (
  id                  text primary key default 'default',

  -- OAuth 2.0 tokens. The refresh token ROTATES: every refresh may hand
  -- back a new one, and the newest is always what gets written here.
  access_token        text,
  refresh_token       text,
  token_expires_at    timestamptz,

  -- Who Yahoo says we are.
  yahoo_guid          text,
  yahoo_nickname      text,

  -- Which league we are mirroring. Discovered after the first connect via
  -- users;use_login=1/games;game_keys=nfl/leagues, and changeable from the
  -- admin page if Austin plays in more than one.
  league_key          text,
  league_name         text,
  league_season       text,
  league_num_teams    integer,
  league_current_week integer,

  -- 'disconnected' | 'connected' | 'needs_reconnect'
  status              text not null default 'disconnected',

  connected_at        timestamptz,
  last_sync_at        timestamptz,
  last_error          text,
  last_error_at       timestamptz,

  -- The commissioner's kill switch: true forces the site back onto the
  -- hand-built numbers even while Yahoo is connected.
  force_placeholder   boolean not null default false,

  -- Held briefly while one request refreshes the access token, so two
  -- lambdas cannot both spend the (rotating) refresh token at once.
  token_lock_at       timestamptz,

  updated_at          timestamptz not null default now()
);

alter table public.yahoo_connection enable row level security;
-- No policies on purpose. Service role only.

-- ---------------------------------------------------------------------
-- 2. The cache. One row per thing we mirror, e.g.
--    'scoreboard:w3', 'standings', 'rosters:w3', 'teams'.
--    payload is NULL until the first successful fetch.
-- ---------------------------------------------------------------------
create table if not exists public.yahoo_cache (
  cache_key   text primary key,
  payload     jsonb,
  fetched_at  timestamptz not null default 'epoch',
  lock_at     timestamptz,
  updated_at  timestamptz not null default now()
);

alter table public.yahoo_cache enable row level security;
-- No policies on purpose. Service role only.

-- ---------------------------------------------------------------------
-- 3. Single flight.
--
-- Vercel Hobby allows one cron run a DAY, so freshness is driven by the
-- 45-second poll the matchup board already makes. That means a dozen
-- readers can hit a stale key in the same second. These two functions
-- answer "may I be the one who calls Yahoo?" atomically -- one UPDATE
-- statement, so exactly one caller gets true and the rest serve the
-- slightly-stale copy they already have.
-- ---------------------------------------------------------------------

create or replace function public.yahoo_claim_cache(
  p_key text,
  p_lock_ms bigint
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  claimed boolean;
begin
  insert into yahoo_cache (cache_key, payload, fetched_at, lock_at)
  values (p_key, null, 'epoch', now())
  on conflict (cache_key) do update
    set lock_at = now(),
        updated_at = now()
    where yahoo_cache.lock_at is null
       or yahoo_cache.lock_at < now() - make_interval(secs => p_lock_ms / 1000.0)
  returning true into claimed;

  return coalesce(claimed, false);
end;
$fn$;

create or replace function public.yahoo_claim_token(
  p_id text,
  p_lock_ms bigint
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  claimed boolean;
begin
  update yahoo_connection
     set token_lock_at = now()
   where id = p_id
     and (token_lock_at is null
          or token_lock_at < now() - make_interval(secs => p_lock_ms / 1000.0))
  returning true into claimed;

  return coalesce(claimed, false);
end;
$fn$;

-- Both functions are SECURITY DEFINER, so the default PUBLIC execute grant
-- would let anyone holding the anon key poke at them. Lock them down to the
-- service role, same as neighborhood_record_party.
revoke all on function public.yahoo_claim_cache(text, bigint) from public;
revoke all on function public.yahoo_claim_cache(text, bigint) from anon;
revoke all on function public.yahoo_claim_cache(text, bigint) from authenticated;
grant execute on function public.yahoo_claim_cache(text, bigint) to service_role;
grant execute on function public.yahoo_claim_cache(text, bigint) to postgres;

revoke all on function public.yahoo_claim_token(text, bigint) from public;
revoke all on function public.yahoo_claim_token(text, bigint) from anon;
revoke all on function public.yahoo_claim_token(text, bigint) from authenticated;
grant execute on function public.yahoo_claim_token(text, bigint) to service_role;
grant execute on function public.yahoo_claim_token(text, bigint) to postgres;

-- Seed the single connection row so the admin page has something to read.
insert into public.yahoo_connection (id) values ('default')
on conflict (id) do nothing;
