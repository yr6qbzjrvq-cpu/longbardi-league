# Longbardi League

The official website of the Longbardi fantasy football league. Built with Next.js (App Router), Tailwind CSS, and Supabase. Dark, ESPN-style front page with a hidden password-protected admin panel for publishing articles.

The site works immediately with sample articles and mock standings — Supabase is only required to publish your own articles through `/admin`.

## Run it locally

```bash
cd longbardi-league
npm install
npm run dev
```

Open http://localhost:3000. That's it — sample content loads automatically.

## Supabase setup (~3 minutes)

1. Go to [supabase.com](https://supabase.com) → New project (free tier is fine). Name it anything.
2. In the left sidebar: **SQL Editor** → New query → paste the entire contents of `supabase/schema.sql` → **Run**. This creates the `articles` table, security policies, and a welcome article.
3. In the left sidebar: **Project Settings → API**. Copy three values:
   - Project URL
   - `anon` public key
   - `service_role` secret key
4. Copy `.env.local.example` to `.env.local` and fill it in:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ADMIN_PASSWORD=pick-something-strong
```

Restart `npm run dev`. Visit `/admin`, enter your password, and publish. Articles appear on the live site instantly.

## Deploy to Vercel (~5 minutes)

1. Push the project to GitHub:

```bash
cd longbardi-league
git init && git add -A && git commit -m "Longbardi League site"
gh repo create longbardi-league --private --source=. --push
# (or create an empty repo on github.com and: git remote add origin <url> && git push -u origin main)
```

2. Go to [vercel.com/new](https://vercel.com/new), sign in with GitHub, and **Import** the `longbardi-league` repo. Vercel auto-detects Next.js — don't change any build settings.
3. Before clicking Deploy, expand **Environment Variables** and add the same four variables from `.env.local` above.
4. Click **Deploy**. In about a minute you'll have a public URL like `longbardi-league.vercel.app`. Share it with the league.

Every future `git push` redeploys automatically. Publishing articles through `/admin` does **not** require a redeploy — they go straight to the database and appear immediately.

## Updating league data (standings, scores, champions)

All mock/league data lives in one file: **`lib/leagueData.js`**

- `LEAGUE` — league name, season, current week
- `TEAMS` — standings (team, manager, W-L, PF/PA, streak)
- `WEEKLY_SCORES` — latest week's matchup scores
- `CHAMPIONS` — the Trophy Room

Edit the file, commit, push — Vercel redeploys in ~1 minute.

## Admin panel

- URL: `yoursite.com/admin` (linked in the nav, but useless without the password)
- Password: whatever you set as `ADMIN_PASSWORD`
- Sessions last 30 days (httpOnly cookie). Changing `ADMIN_PASSWORD` logs everyone out.
- Editor supports Markdown with live preview, thumbnail image URL, excerpt, draft mode, and a "feature on homepage hero" toggle (only one article is featured at a time).

For article images, paste any image URL — [unsplash.com](https://unsplash.com) (right-click → copy image address) works great. To host your own screenshots, drop them in Supabase **Storage** (create a public bucket) and paste the public URL.

## Project structure

```
longbardi-league/
├── app/
│   ├── layout.jsx              # Nav + footer shell, fonts, metadata
│   ├── page.jsx                # Homepage: hero, news grid, standings/scores sidebar
│   ├── globals.css             # Tailwind + article typography
│   ├── not-found.jsx
│   ├── articles/
│   │   ├── page.jsx            # All articles grid
│   │   └── [slug]/page.jsx     # Article detail (Markdown rendered)
│   ├── standings/page.jsx      # Full standings + Trophy Room
│   ├── admin/
│   │   ├── page.jsx            # Login gate + dashboard
│   │   ├── new/page.jsx        # Create article
│   │   └── edit/[id]/page.jsx  # Edit article
│   └── api/admin/
│       ├── login/route.js      # Password check, sets session cookie
│       ├── logout/route.js
│       ├── articles/route.js   # Create (POST)
│       └── articles/[id]/route.js  # Update (PUT) / Delete (DELETE)
├── components/                 # Navbar, HeroArticle, ArticleCard, StandingsTable,
│                               # ScoreBoard, ArticleEditor, admin widgets
├── lib/
│   ├── leagueData.js           # ← EDIT THIS for standings/scores/champions
│   ├── mockArticles.js         # Fallback articles before Supabase is connected
│   ├── articles.js             # Article queries (Supabase w/ mock fallback)
│   ├── supabase.js             # Client factories
│   └── auth.js                 # Admin session helpers
└── supabase/schema.sql         # ← RUN THIS in the Supabase SQL editor
```

## Security notes

- Reads use the anon key and are restricted by Row Level Security to published articles only.
- All writes go through server API routes that check the admin session cookie, using the service-role key (never exposed to the browser).
- The admin password lives only in env vars. Don't commit `.env.local` (it's gitignored).
