// OAuth 2.0 against api.login.yahoo.com: authorization code in, access and
// refresh tokens out, forever after.
//
// The failure mode everyone hits with Yahoo is refresh-token ROTATION.
// Yahoo hands back a new refresh token on most refreshes; keep using the
// old one and a few days later every call 400s with invalid_grant and the
// integration is silently dead. applyTokenResponse() below always prefers
// the newest refresh token it has seen and never overwrites a good one
// with nothing — and it is pure, so the rotation rules are unit tested.

import {
  AUTH_URL,
  TOKEN_URL,
  yahooClientId,
  yahooClientSecret,
  yahooRedirectUri,
} from "./config.js";

export function buildAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    language: "en-us",
  });
  if (state) params.set("state", state);
  return `${AUTH_URL}?${params.toString()}`;
}

// Seconds of headroom: refresh a little early rather than racing an
// expiry mid-request.
export const EXPIRY_SKEW_MS = 120 * 1000;

export function tokenExpired(connection, now = new Date()) {
  if (!connection?.access_token) return true;
  if (!connection.token_expires_at) return true;
  const at = new Date(connection.token_expires_at).getTime();
  if (Number.isNaN(at)) return true;
  return now.getTime() + EXPIRY_SKEW_MS >= at;
}

// Turn a Yahoo token response into the columns we store. `previous` is the
// row we already had (or null on first connect).
export function applyTokenResponse(previous, response, now = new Date()) {
  const expiresIn = Number(response?.expires_in);
  const lifetime = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600;

  const patch = {
    access_token: response?.access_token || null,
    token_expires_at: new Date(now.getTime() + lifetime * 1000).toISOString(),
    status: "connected",
    last_error: null,
    last_error_at: null,
  };

  // Rotation: take the new refresh token when Yahoo sends one, keep the
  // old one when it does not. Never null out a working refresh token.
  if (response?.refresh_token) {
    patch.refresh_token = response.refresh_token;
  } else if (previous?.refresh_token) {
    patch.refresh_token = previous.refresh_token;
  } else {
    patch.refresh_token = null;
  }

  const guid = response?.xoauth_yahoo_guid;
  if (guid) patch.yahoo_guid = guid;

  return patch;
}

export class YahooAuthError extends Error {
  constructor(message, { fatal = false, status = 0, body = "" } = {}) {
    super(message);
    this.name = "YahooAuthError";
    // `fatal` means reconnecting is the only fix — a rotated-away or
    // revoked refresh token. The admin page says so out loud.
    this.fatal = fatal;
    this.status = status;
    this.body = body;
  }
}

async function postToken(body) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });

  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }

  if (!res.ok || !json?.access_token) {
    const code = json?.error || "";
    const description = json?.error_description || raw.slice(0, 300);
    // invalid_grant is the rotation/revocation signal.
    const fatal = code === "invalid_grant" || res.status === 400;
    throw new YahooAuthError(
      `Yahoo token request failed (${res.status})${code ? ` ${code}` : ""}: ${description}`,
      { fatal, status: res.status, body: raw.slice(0, 500) }
    );
  }

  return json;
}

export function exchangeCode(code) {
  return postToken({
    client_id: yahooClientId(),
    client_secret: yahooClientSecret(),
    redirect_uri: yahooRedirectUri(),
    code,
    grant_type: "authorization_code",
  });
}

export function refreshAccessToken(refreshToken) {
  return postToken({
    client_id: yahooClientId(),
    client_secret: yahooClientSecret(),
    // Yahoo wants the redirect_uri on refreshes too.
    redirect_uri: yahooRedirectUri(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
}
