-- Longbardi League — comments (article discussion threads)
-- Added after the initial schema. Run once in Supabase: SQL Editor > New query
-- > paste > Run. Safe to re-run.

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  thread_key text not null,
  name text not null,
  body text not null,
  no_signoff boolean not null default false,
  created_at timestamptz not null default now()
);

-- no_signoff was added after launch: it lets a single comment opt out of the
-- mandated render-time sign-off ("Glory to our great commissioner").
alter table public.comments
  add column if not exists no_signoff boolean not null default false;

alter table public.comments enable row level security;

-- Anyone may read comments.
drop policy if exists "Public read comments" on public.comments;
create policy "Public read comments"
  on public.comments for select
  using (true);

-- Anyone may post a comment, but the anon key can only post a normal
-- (signed-off) one: it may never set no_signoff. The sign-off exemption is
-- granted solely by the server route (app/api/comments), which uses the
-- service-role key (bypasses RLS) after verifying the admin session.
drop policy if exists "Public write comments" on public.comments;
create policy "Public write comments"
  on public.comments for insert
  with check (no_signoff is not true);
