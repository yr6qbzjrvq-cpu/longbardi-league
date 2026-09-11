// "Is the site showing Yahoo data right now?" — one answer, one place.
//
// There is no FANTASY_LIVE-style flag to remember to flip: the connection
// state IS the switch. Configured + connected + a league picked + the
// commissioner hasn't forced placeholder mode = live.
//
// The first check is the important one. With no YAHOO_CLIENT_ID in the
// environment this returns immediately and never touches Supabase, so
// until Austin adds the env vars on 9/15 the site does exactly what it
// does today, with zero extra queries on any page.

import { cache } from "react";
import { isYahooConfigured } from "./config.js";
import { getConnection } from "./store.js";

const NOT_CONFIGURED = {
  configured: false,
  connected: false,
  live: false,
  override: false,
  leagueKey: null,
  status: "not_configured",
  error: null,
};

// React's cache() collapses this to one Supabase read per request, however
// many components ask.
export const yahooStatus = cache(async () => {
  if (!isYahooConfigured()) return NOT_CONFIGURED;

  const { row, error } = await getConnection();
  if (error) {
    return {
      configured: true,
      connected: false,
      live: false,
      override: false,
      leagueKey: null,
      status: "error",
      error,
    };
  }

  const connected = row?.status === "connected" && Boolean(row?.refresh_token);
  const override = Boolean(row?.force_placeholder);

  return {
    configured: true,
    connected,
    live: connected && Boolean(row?.league_key) && !override,
    override,
    leagueKey: row?.league_key || null,
    status: row?.status || "disconnected",
    currentWeek: row?.league_current_week || null,
    error: null,
  };
});

export async function isYahooLive() {
  return (await yahooStatus()).live;
}
