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
2. In the left sidebar: **SQL Editor** → New query → paste the entire contents of `supabase/schema.sql` → **Run**. This creates the `articles` table, security policies, and a welcome article. (For the Yahoo integration, run `supabase/yahoo.sql` the same way — see [Yahoo Fantasy integration](#yahoo-fantasy-integration).)
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

All hand-maintained league data lives in one file: **`lib/leagueData.js`**

Once Yahoo is connected (see below) the standings, the week's scores and the
rosters come from Yahoo instead, and this file becomes the fallback the site
drops back to if Yahoo is unconfigured, disconnected, broken or overridden.
`CHAMPIONS` is always from here — Yahoo does not know about the Trophy Room.

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

## Yahoo Fantasy integration

The site can mirror the real Longbardi league from Yahoo — live scores on the
home strip, real standings, real rosters and box scores on the matchup pages.
Until Yahoo is connected it shows the hand-built numbers from
`lib/leagueData.js`, exactly as it always has.

### The switch is the connection, not a flag

There is no `FANTASY_LIVE`-style toggle to remember. The site is live when all
four of these are true:

1. `YAHOO_CLIENT_ID` and `YAHOO_CLIENT_SECRET` are set on the deployment;
2. `supabase/yahoo.sql` has been run;
3. someone pressed **Connect Yahoo** on `/admin/yahoo` and clicked through
   Yahoo's consent screen;
4. the **Force hand-built data** override on that page is off.

Miss any one and every page falls back to `lib/leagueData.js`. If the env vars
are missing the Yahoo code never even queries the database — it returns before
it gets that far — so an unconfigured deployment costs nothing.

### Architecture

```
  browser                       server                         Yahoo
  ───────                       ──────                         ─────
  MatchupBoard ──poll 45s──▶ /api/fantasy/matchups
  home / standings ────────▶ lib/fantasy.js  (the seam)
                                   │
                                   ├─ not live ─▶ lib/leagueData.js
                                   │
                                   └─ live ────▶ lib/yahoo/sync.js
                                                     │
                                              yahoo_cache (Supabase)
                                                     │ stale?
                                                     ├─ no  ─▶ serve it
                                                     └─ yes ─▶ claim ──▶ fantasysports.yahooapis.com
                                                                 │          (XML, mapped, written back)
                                                                 └─ lost the claim ─▶ serve the stale copy
```

**No cron.** Vercel Hobby allows one cron run a *day*, which is useless for
live scores, so freshness is request-driven: the 45-second poll the matchup
board already makes is what pulls new numbers through. During NFL game windows
the cache goes stale after 60 seconds; the rest of the week, 15 minutes. A
single-flight claim in Postgres (`yahoo_claim_cache`) means twelve people with
the page open still produce **one** Yahoo call, not twelve.

| File | What it does |
| --- | --- |
| `lib/fantasy.js` | The seam. Every page reads this; it picks Yahoo or the hand-built data and never tells the page which. |
| `lib/fantasyShapes.js` | `matchupSlug` / `matchupHref`, shared by both halves. |
| `lib/yahoo/config.js` | Env vars, endpoints, the redirect URI. |
| `lib/yahoo/oauth.js` | Consent URL, code exchange, token refresh, **refresh-token rotation**. |
| `lib/yahoo/api.js` | The authorised call: keeps the access token alive, retries once on 401, records failures loudly. |
| `lib/yahoo/xml.js` | A ~150-line XML reader. Yahoo's XML is documented verbatim; its JSON conversion is not. |
| `lib/yahoo/map.js` | Yahoo XML → the site's existing shapes (rosters, matchups, standings). |
| `lib/yahoo/freshness.js` | When is the cache stale, and who may refresh it. |
| `lib/yahoo/store.js` | Supabase reads/writes for the connection and the cache. |
| `lib/yahoo/sync.js` | Cache-first fetchers, single flight, the yet-to-play count. |
| `lib/yahoo/live.js` | "Are we live right now?" — one cached answer per request. |
| `components/YahooAttribution.jsx` | Yahoo's required attribution. Renders only when live. |
| `supabase/yahoo.sql` | The two tables and the two claim functions. |
| `scripts/test-yahoo.mjs` | 161 assertions against Yahoo's published sample responses. |

**Refresh-token rotation** is the classic way an integration like this dies
silently: Yahoo hands back a *new* refresh token on most refreshes, and if you
keep using the old one, everything 400s a few days later. `applyTokenResponse`
always stores the newest token it has seen and never overwrites a good one with
nothing. When Yahoo does reject a refresh, the connection is marked
`needs_reconnect` and the error and its timestamp show on `/admin/yahoo`.

### Security

`yahoo_connection` and `yahoo_cache` have Row Level Security **on** with **zero
policies**, so the anon key the browser holds cannot read either table. Tokens
are read and written only by server code holding the service-role key, and the
admin page renders a summary that deliberately excludes the token columns. Both
claim functions are `security definer` with execute revoked from `anon` and
`authenticated`.

### Attribution

Yahoo requires the sentence "Fantasy data provided by Yahoo Fantasy", linking
back to Yahoo Fantasy, plus their official logo used unmodified, on anything
showing their data. `components/YahooAttribution.jsx` does this on the home
page, standings, matchups, the matchup detail page and rosters — and renders
nothing at all when the site is on hand-built data.

The logo file is not in this repo (it is Yahoo's asset, to be used only as
provided). To add it:

1. download <https://763445962456-brand-assets.s3.us-west-2.amazonaws.com/brandwebsite/s3fs-public/Yahoo_Fantasy.svg>
   (linked as "official logo" from <https://sports.yahoo.com/developer/>);
2. save it, unmodified, as `public/yahoo-fantasy.svg`;
3. commit. The component finds it and starts rendering it.

If it does not appear, set `LOGO_SRC` in that component to `"/yahoo-fantasy.svg"`.
Until then the sentence and link render on their own.

---

### 9/15 checklist — what Austin does, click by click

Everything below is a one-time setup. It takes about ten minutes.

**1. Register the Yahoo app** — go to
<https://developer.yahoo.com/apps/create/> and fill in:

| Field | Value |
| --- | --- |
| Application Name | `HSPN Longbardi` (anything) |
| Application Type | **Web Application** |
| Redirect URI (OAuth Callback Domain) | `https://hspn.vercel.app/api/yahoo/callback` |
| API Permissions | tick **Fantasy Sports**, choose **Read** |

The Redirect URI must match **character for character** — `/admin/yahoo`
prints the exact string the code will send, so copy it from there if in doubt.
Yahoo then shows a **Client ID** and a **Client Secret**.

**2. Add the two env vars in Vercel** — Project → Settings → Environment
Variables, Production (and Preview if you want it there too):

| Name | Value |
| --- | --- |
| `YAHOO_CLIENT_ID` | the Client ID from step 1 |
| `YAHOO_CLIENT_SECRET` | the Client Secret from step 1 |

Optional: `YAHOO_REDIRECT_URI` if you ever want to connect from a domain other
than `hspn.vercel.app`. Then **Redeploy** (env vars only reach a new build).

**3. Run the SQL** — Supabase → SQL Editor → New query → paste all of
`supabase/yahoo.sql` → Run. It creates `yahoo_connection` and `yahoo_cache`
and the two claim functions. Safe to run twice.

**4. Connect** — go to `https://hspn.vercel.app/admin/yahoo`, log in as
commissioner, press **Connect Yahoo**. Yahoo asks you to allow access to your
Fantasy data; say yes. You land back on the same page.

- One NFL league on the account → it is selected automatically.
- More than one → a **Which league?** dropdown appears. Pick Longbardi.

**5. Prove it** — press **Sync now**. It should say
"Synced week N — 6 matchups". The Status block should read **Yahoo data —
live**, and the Manager mapping table at the bottom should show all twelve
names. Then open the home page: the strip should show real scores, and
"Fantasy data provided by Yahoo Fantasy" should appear in the footer of the
page.

**6. Drop in the logo** (see Attribution above).

If a manager's name comes out wrong, the mapping table shows why — the fix is
to rename that Yahoo team or nickname so it contains the manager's first name.

### If it breaks

- **`/admin/yahoo` shows an error line** — that is the last thing Yahoo said,
  with a timestamp. Most likely causes: the Redirect URI does not match, or the
  refresh token was revoked (status will say **Needs reconnect** — press
  Connect Yahoo again).
- **Yahoo is up but showing nonsense** — press **Force hand-built data**. The
  site returns to `lib/leagueData.js` instantly; the connection stays, so you
  can flip it back without re-consenting.
- **Start over** — **Disconnect** clears the tokens and the cache.

### Testing it without Yahoo

```bash
node scripts/test-yahoo.mjs
```

161 assertions covering the XML reader, the mapping (against Yahoo's own
published sample responses in `scripts/fixtures/yahoo/`), manager matching,
token rotation, expiry, the consent URL, the staleness windows and the
single-flight logic. No network, no credentials.

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
│   │   ├── edit/[id]/page.jsx  # Edit article
│   │   └── yahoo/page.jsx      # Yahoo connection: connect, status, kill switch
│   ├── api/admin/
│   │   ├── login/route.js      # Password check, sets session cookie
│   │   ├── logout/route.js
│   │   ├── articles/route.js   # Create (POST)
│   │   └── articles/[id]/route.js  # Update (PUT) / Delete (DELETE)
│   └── api/yahoo/              # OAuth + admin actions (auth, callback,
│                               # disconnect, league, override, refresh)
├── components/                 # Navbar, HeroArticle, ArticleCard, StandingsTable,
│                               # ScoreBoard, ArticleEditor, admin widgets
├── lib/
│   ├── leagueData.js           # ← EDIT THIS for standings/scores/champions
│   ├── mockArticles.js         # Fallback articles before Supabase is connected
│   ├── articles.js             # Article queries (Supabase w/ mock fallback)
│   ├── supabase.js             # Client factories
│   ├── auth.js                 # Admin session helpers
│   ├── fantasy.js              # The seam: Yahoo or hand-built, same shapes
│   └── yahoo/                  # OAuth, XML, mapping, cache, freshness
├── scripts/
│   ├── test-yahoo.mjs          # Offline test harness for the Yahoo layer
│   └── fixtures/yahoo/         # Yahoo's published sample responses
└── supabase/
    ├── schema.sql              # ← RUN THIS in the Supabase SQL editor
    └── yahoo.sql               # ← AND THIS, for the Yahoo integration
```

## Security notes

- Reads use the anon key and are restricted by Row Level Security to published articles only.
- All writes go through server API routes that check the admin session cookie, using the service-role key (never exposed to the browser).
- The admin password lives only in env vars. Don't commit `.env.local` (it's gitignored).
- Yahoo tokens live in `yahoo_connection`, a table with RLS on and no policies — unreadable with the anon key, and never rendered to the browser.
