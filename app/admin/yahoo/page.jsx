import Link from "next/link";
import AdminLoginForm from "@/components/AdminLoginForm";
import YahooConnectionPanel from "@/components/YahooConnectionPanel";
import { isAuthed } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase";
import { WEEKLY_SCORES } from "@/lib/leagueData";
import { isYahooConfigured, yahooRedirectUri } from "@/lib/yahoo/config";
import { getConnection, publicConnection, readCache } from "@/lib/yahoo/store";
import { discoverLeagues, KEYS } from "@/lib/yahoo/sync";
import { tokenExpired } from "@/lib/yahoo/oauth";
import { isStale, staleAfterMs, isGameWindow } from "@/lib/yahoo/freshness";

export const dynamic = "force-dynamic";

export const metadata = { title: "Yahoo Connection" };

const ERRORS = {
  not_configured:
    "YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET aren't set on this deployment yet.",
  not_admin: "You need to be logged in as commissioner.",
  denied: "Yahoo consent was declined.",
  no_code: "Yahoo sent us back without an authorization code.",
  bad_state:
    "That callback didn't match the request we started. Try Connect again.",
  exchange_failed:
    "Yahoo refused the authorization code. Check that the Redirect URI on the Yahoo app matches the one below exactly.",
  save_failed:
    "Couldn't write the tokens to Supabase — has supabase/yahoo.sql been run?",
  league_lookup_failed:
    "Connected, but the league lookup failed. Try Sync now, or reconnect.",
};

function when(value) {
  if (!value) return "never";
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function Row({ label, children }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-100 py-2.5 last:border-0">
      <span className="font-display text-xs uppercase tracking-widest text-gray-500">
        {label}
      </span>
      <span className="text-sm text-gray-900">{children}</span>
    </div>
  );
}

function Pill({ tone, children }) {
  const tones = {
    good: "bg-green-100 text-green-800",
    warn: "bg-amber-100 text-amber-800",
    bad: "bg-red-100 text-red-800",
    idle: "bg-gray-100 text-gray-600",
  };
  return (
    <span
      className={`rounded px-2 py-0.5 font-display text-[11px] uppercase tracking-widest ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export default async function AdminYahooPage({ searchParams }) {
  if (!(await isAuthed())) return <AdminLoginForm />;

  const params = (await searchParams) || {};
  const configured = isYahooConfigured();
  const redirectUri = yahooRedirectUri();

  const { row, error: connError, missingTable } = await getConnection();
  const conn = publicConnection(row);
  const connected = conn?.status === "connected" && conn?.hasRefreshToken;
  const live = connected && Boolean(conn?.league_key) && !conn?.force_placeholder;

  const week = conn?.league_current_week || WEEKLY_SCORES.week;

  // Cache health, and the manager mapping the site worked out — the one
  // thing most likely to look wrong on day one.
  let boardCache = null;
  let standingsCache = null;
  if (connected) {
    [boardCache, standingsCache] = await Promise.all([
      readCache(KEYS.scoreboard(week)),
      readCache(KEYS.standings),
    ]);
  }
  const mapping = standingsCache?.payload?.rows || [];

  // Only ask Yahoo for the league list when there is actually a choice to
  // make — no point spending an API call on every page view.
  let leagues = [];
  if (connected && (params.pick || !conn.league_key)) {
    try {
      leagues = await discoverLeagues();
    } catch {
      leagues = [];
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link href="/admin" className="text-sm text-link hover:underline">
        &larr; Back to dashboard
      </Link>
      <h1 className="mt-2 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
        Yahoo Connection
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Live scores, standings and rosters for the Longbardi league, pulled
        from Yahoo Fantasy. Until this says <strong>Live</strong>, every page
        on the site keeps showing the hand-built numbers from{" "}
        <code className="rounded bg-gray-100 px-1">lib/leagueData.js</code>.
      </p>

      {params.error && ERRORS[params.error] && (
        <p className="mt-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {ERRORS[params.error]}
        </p>
      )}
      {params.connected && !params.error && (
        <p className="mt-6 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          Connected to Yahoo.
          {params.pick && " Pick which league to mirror below."}
        </p>
      )}

      {/* ---------------- status ---------------- */}
      <section className="mt-8 rounded-md border border-gray-200 p-5">
        <h2 className="mb-3 font-display text-lg uppercase tracking-wide text-gray-900">
          Status
        </h2>

        <Row label="Site is showing">
          {live ? (
            <Pill tone="good">Yahoo data — live</Pill>
          ) : (
            <Pill tone="idle">Hand-built data</Pill>
          )}
        </Row>

        <Row label="App credentials">
          {configured ? (
            <Pill tone="good">Configured</Pill>
          ) : (
            <Pill tone="warn">Not configured</Pill>
          )}
        </Row>

        <Row label="Supabase">
          {!isSupabaseConfigured() ? (
            <Pill tone="bad">Not configured</Pill>
          ) : missingTable ? (
            <Pill tone="warn">Tables missing — run supabase/yahoo.sql</Pill>
          ) : connError ? (
            <Pill tone="bad">{connError}</Pill>
          ) : (
            <Pill tone="good">Ready</Pill>
          )}
        </Row>

        <Row label="Connection">
          {connected ? (
            <Pill tone="good">Connected{conn.yahoo_nickname ? ` as ${conn.yahoo_nickname}` : ""}</Pill>
          ) : conn?.status === "needs_reconnect" ? (
            <Pill tone="bad">Needs reconnect</Pill>
          ) : (
            <Pill tone="idle">Not connected</Pill>
          )}
        </Row>

        {connected && (
          <>
            <Row label="Access token">
              {tokenExpired(row) ? (
                <Pill tone="warn">Expired — refreshes on next use</Pill>
              ) : (
                <Pill tone="good">Healthy until {when(conn.token_expires_at)}</Pill>
              )}
            </Row>
            <Row label="Refresh token">
              {conn.hasRefreshToken ? (
                <Pill tone="good">Stored</Pill>
              ) : (
                <Pill tone="bad">Missing</Pill>
              )}
            </Row>
            <Row label="League">
              {conn.league_key ? (
                <>
                  {conn.league_name} <span className="text-gray-400">({conn.league_key})</span>
                  {conn.league_num_teams ? ` · ${conn.league_num_teams} teams` : ""}
                  {conn.league_season ? ` · ${conn.league_season}` : ""}
                </>
              ) : (
                <Pill tone="warn">Not picked yet</Pill>
              )}
            </Row>
            <Row label="Override">
              {conn.force_placeholder ? (
                <Pill tone="warn">Forcing hand-built data</Pill>
              ) : (
                <Pill tone="idle">Off</Pill>
              )}
            </Row>
            <Row label="Last sync">{when(conn.last_sync_at)}</Row>
            <Row label="Scoreboard cache">
              {boardCache ? (
                <>
                  {when(boardCache.fetchedAt)}{" "}
                  {isStale(boardCache.fetchedAt) ? (
                    <Pill tone="warn">stale</Pill>
                  ) : (
                    <Pill tone="good">fresh</Pill>
                  )}
                </>
              ) : (
                <Pill tone="idle">empty</Pill>
              )}
            </Row>
            <Row label="Refresh window">
              {Math.round(staleAfterMs() / 1000)}s
              {isGameWindow() ? " (games on)" : " (quiet hours)"}
            </Row>
          </>
        )}

        {conn?.last_error && (
          <Row label="Last error">
            <span className="text-red-700">
              {conn.last_error}{" "}
              <span className="text-gray-400">({when(conn.last_error_at)})</span>
            </span>
          </Row>
        )}
      </section>

      {/* ---------------- actions ---------------- */}
      <section className="mt-6">
        <YahooConnectionPanel
          configured={configured && !missingTable}
          connected={connected}
          override={Boolean(conn?.force_placeholder)}
          leagueKey={conn?.league_key || ""}
          leagues={leagues}
          week={week}
        />
      </section>

      {/* ---------------- setup ---------------- */}
      {!configured && (
        <section className="mt-8 rounded-md border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
          <h2 className="mb-2 font-display text-lg uppercase tracking-wide">
            Not configured yet
          </h2>
          <p className="mb-3">
            Two environment variables are missing. Until they exist, this page
            is the only thing that changes — the rest of the site never calls
            Yahoo and never even asks the database about it.
          </p>
          <ol className="ml-5 list-decimal space-y-2">
            <li>
              Register the app at{" "}
              <a
                className="underline"
                href="https://developer.yahoo.com/apps/create/"
                target="_blank"
                rel="noopener noreferrer"
              >
                developer.yahoo.com/apps/create
              </a>
              . Application Type <strong>Web Application</strong>, API
              Permissions <strong>Fantasy Sports · Read</strong>.
            </li>
            <li>
              Redirect URI — paste this exactly:
              <code className="ml-1 block break-all rounded bg-amber-100 px-2 py-1">
                {redirectUri}
              </code>
            </li>
            <li>
              In Vercel → Settings → Environment Variables, add{" "}
              <code className="rounded bg-amber-100 px-1">YAHOO_CLIENT_ID</code>{" "}
              and{" "}
              <code className="rounded bg-amber-100 px-1">
                YAHOO_CLIENT_SECRET
              </code>{" "}
              (Production), then redeploy.
            </li>
            <li>
              Run <code className="rounded bg-amber-100 px-1">supabase/yahoo.sql</code>{" "}
              once in the Supabase SQL editor.
            </li>
            <li>Come back here and press Connect Yahoo.</li>
          </ol>
        </section>
      )}

      {configured && (
        <section className="mt-8 rounded-md border border-gray-200 p-5 text-sm text-gray-600">
          <p>
            Redirect URI registered on the Yahoo app must be exactly:
            <code className="ml-1 block break-all rounded bg-gray-100 px-2 py-1 text-gray-900">
              {redirectUri}
            </code>
          </p>
        </section>
      )}

      {/* ---------------- manager mapping ---------------- */}
      {mapping.length > 0 && (
        <section className="mt-8 rounded-md border border-gray-200 p-5">
          <h2 className="mb-1 font-display text-lg uppercase tracking-wide text-gray-900">
            Manager mapping
          </h2>
          <p className="mb-3 text-sm text-gray-500">
            How Yahoo&apos;s teams line up with the twelve names the site
            uses. If one is wrong, the fix is to rename the Yahoo team or the
            manager&apos;s Yahoo nickname so they match.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-300 font-display uppercase tracking-wider text-gray-500">
                <th className="py-2 pr-3 text-left text-xs">Yahoo team</th>
                <th className="py-2 pr-3 text-left text-xs">Yahoo nickname</th>
                <th className="py-2 text-left text-xs">Shown as</th>
              </tr>
            </thead>
            <tbody>
              {mapping.map((r) => (
                <tr key={r.teamKey} className="border-b border-gray-100">
                  <td className="py-2 pr-3 text-gray-900">{r.yahooTeamName}</td>
                  <td className="py-2 pr-3 text-gray-500">{r.nickname || "—"}</td>
                  <td className="py-2 font-medium text-gray-900">{r.manager}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
