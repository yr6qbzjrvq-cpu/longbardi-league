// Yahoo wiring that has to be true before anything else can happen.
//
// Until YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET exist in the environment,
// isYahooConfigured() is false and NOTHING in the Yahoo integration runs:
// no Supabase reads, no fetches, no attribution footer. The site behaves
// exactly as it did before this feature landed. That is the safety
// property the whole design hangs off.

export const AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth";
export const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
export const API_BASE = "https://fantasysports.yahooapis.com/fantasy/v2";

// Where Yahoo sends the browser back after consent. This string has to
// match the "Redirect URI" registered on the Yahoo app CHARACTER FOR
// CHARACTER, so the admin page prints whatever this function returns and
// tells Austin to paste that.
export const DEFAULT_REDIRECT_URI = "https://hspn.vercel.app/api/yahoo/callback";

export function yahooRedirectUri() {
  return process.env.YAHOO_REDIRECT_URI || DEFAULT_REDIRECT_URI;
}

export function yahooClientId() {
  return process.env.YAHOO_CLIENT_ID || "";
}

export function yahooClientSecret() {
  return process.env.YAHOO_CLIENT_SECRET || "";
}

export function isYahooConfigured() {
  return Boolean(yahooClientId() && yahooClientSecret());
}

// Name of the short-lived cookie holding the OAuth `state` value while the
// browser is off at Yahoo. Lives here rather than in the route file so the
// callback can import it without importing a route module.
export const OAUTH_STATE_COOKIE = "yahoo_oauth_state";

// Yahoo's game code for NFL fantasy. Using the code rather than a numeric
// game id means "the current season" without a lookup table.
export const NFL_GAME_CODE = "nfl";
