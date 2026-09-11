// The authorised call to fantasysports.yahooapis.com.
//
// Everything above this file assumes it can just ask for a path and get
// parsed XML back. This is where the access token gets kept alive, where
// rotation is handled, and where a dead connection turns into a loud,
// admin-visible error instead of a blank page.

import { API_BASE, isYahooConfigured } from "./config.js";
import {
  applyTokenResponse,
  refreshAccessToken,
  tokenExpired,
  YahooAuthError,
} from "./oauth.js";
import {
  claimTokenRefresh,
  getConnection,
  recordError,
  saveConnection,
} from "./store.js";
import { parseXml } from "./xml.js";

const TOKEN_LOCK_MS = 30 * 1000;

export class YahooApiError extends Error {
  constructor(message, { status = 0, fatal = false, retryable = false } = {}) {
    super(message);
    this.name = "YahooApiError";
    this.status = status;
    this.fatal = fatal;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Refresh the access token, storing the NEWEST refresh token Yahoo gives
// us. Only one caller does this at a time (claimTokenRefresh); the rest
// wait for the winner's write to land rather than spending the refresh
// token a second time, because a rotated-away refresh token is dead.
async function refreshWithLock(row) {
  const claimed = await claimTokenRefresh(TOKEN_LOCK_MS);

  if (!claimed) {
    for (let i = 0; i < 4; i += 1) {
      await sleep(750);
      const { row: fresh } = await getConnection();
      if (fresh && !tokenExpired(fresh)) return fresh;
    }
    throw new YahooApiError(
      "Another request is refreshing the Yahoo token; try again in a moment.",
      { retryable: true }
    );
  }

  try {
    const response = await refreshAccessToken(row.refresh_token);
    const patch = applyTokenResponse(row, response);
    await saveConnection({ ...patch, token_lock_at: null });
    return { ...row, ...patch };
  } catch (err) {
    // Release the lock so the next request can try, then make the failure
    // visible. invalid_grant means the refresh token is gone for good and
    // Austin has to press Connect again.
    const fatal = err instanceof YahooAuthError ? err.fatal : false;
    await saveConnection({ token_lock_at: null });
    await recordError(err.message, { fatal });
    throw new YahooApiError(err.message, { fatal, status: err.status || 0 });
  }
}

async function currentConnection() {
  if (!isYahooConfigured()) {
    throw new YahooApiError(
      "Yahoo is not configured (YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET).",
      { fatal: true }
    );
  }

  const { row, error } = await getConnection();
  if (error) throw new YahooApiError(error, { fatal: true });
  if (!row?.refresh_token) {
    throw new YahooApiError("Yahoo is not connected yet.", { fatal: true });
  }
  return row;
}

// GET a Fantasy path (everything after /fantasy/v2) and hand back the
// parsed <fantasy_content> element.
export async function yahooGet(path) {
  let row = await currentConnection();
  if (tokenExpired(row)) row = await refreshWithLock(row);

  const url = `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

  const call = async (token) =>
    fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/xml",
      },
      cache: "no-store",
    });

  let res = await call(row.access_token);

  // One retry on 401: the token may have been revoked early, or another
  // lambda rotated it out from under us.
  if (res.status === 401) {
    row = await refreshWithLock({ ...row, token_expires_at: null });
    res = await call(row.access_token);
  }

  if (res.status === 429 || res.status === 999) {
    const message = "Yahoo is rate limiting us (HTTP " + res.status + ").";
    await recordError(message);
    throw new YahooApiError(message, { status: res.status, retryable: true });
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    const message = `Yahoo API ${res.status} for ${path}: ${body}`;
    await recordError(message, { fatal: res.status === 401 });
    throw new YahooApiError(message, {
      status: res.status,
      fatal: res.status === 401,
    });
  }

  const xml = await res.text();
  const doc = parseXml(xml);
  if (!doc) {
    const message = `Yahoo returned something that is not XML for ${path}.`;
    await recordError(message);
    throw new YahooApiError(message, { status: res.status });
  }
  return doc;
}
