-- Longbardi League — run this once in Supabase: SQL Editor > New query > paste > Run

create table public.articles (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  slug        text not null unique,
  excerpt     text,
  content     text not null default '',
  image_url   text,
  featured    boolean not null default false,
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Row Level Security: anyone may READ published articles; all writes go
-- through the server using the service-role key (which bypasses RLS).
alter table public.articles enable row level security;

create policy "Public can read published articles"
  on public.articles for select
  using (published = true);

-- Helpful index for the homepage query
create index articles_created_at_idx on public.articles (created_at desc);

-- Optional: a starter article so the site isn't empty after connecting
insert into public.articles (title, slug, excerpt, content, image_url, featured)
values (
  'Welcome to the Longbardi League Site',
  'welcome-to-the-longbardi-league-site',
  'The league now has an official home. Bookmark it, trash talk responsibly.',
  E'# We''re Live\n\nThe **Longbardi League** finally has a front page worthy of its drama.\n\n- Weekly recaps and power rankings will land here\n- Standings update on the Standings page\n- Complaints about the commissioner may be submitted in writing and ignored\n\nStay tuned for the season preview.',
  'https://images.unsplash.com/photo-1566577739112-5180d4bf9390?w=1600&q=80',
  true
);
