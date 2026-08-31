// ============================================================
// HSPNeighborhood — TURN relay credentials (milestone 11)
// ------------------------------------------------------------
// Server-only. Turns the two Cloudflare secrets in the
// environment into the short-lived ICE credentials a browser
// needs to relay a screen share when peer-to-peer can't get
// through.
//
// THE PROBLEM THIS FIXES. Until now the big board ran on
// public STUN only. STUN just tells each side what its own
// public address looks like; the two peers still have to talk
// to each other directly. On home wifi that works. On CELLULAR
// it usually doesn't: carrier-grade NAT is symmetric, meaning
// the phone gets a different public port for every destination
// it talks to, so the address STUN learned is useless to the
// broadcaster. The connection sits at "connecting" and then
// fails — exactly the known limitation in the milestone-9
// notes. The fix is a TURN server: a relay both sides can
// reach outbound, which forwards the media. Cloudflare's TURN
// service is $0.05/GB with the first 1,000 GB each month free,
// which for a league watching football is free.
//
// WHY THE KEY NEVER REACHES THE BROWSER. CF_TURN_KEY_ID +
// CF_TURN_API_TOKEN are a long-term secret that can mint
// unlimited credentials. They stay here; the browser only ever
// receives an expiring username/password pair, handed out by
// the gated /api/neighborhood/ice route.
//
// WHY ONE CACHED CREDENTIAL SET FOR EVERYONE. We mint one set
// per lambda and reuse it until it is close to expiry, instead
// of minting per viewer. That makes the route cheap to serve
// and — the part that matters — makes it pointless to farm:
// hammering it a thousand times returns the same already-
// minted credential and costs Cloudflare exactly one API call.
// The trade is that credentials are not individually
// revocable; the TTL below is the leash and the free tier is
// the ceiling.
//
// EVERYTHING DEGRADES. No env vars, a Cloudflare outage, a
// timeout: every path falls back to STUN_ONLY, which is
// byte-for-byte the ICE config the site shipped with. Cellular
// viewers go back to failing, nothing else changes.
// ============================================================

// The pre-TURN configuration, kept as the fallback everywhere.
export const STUN_ONLY = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

const CF_API = "https://rtc.live.cloudflare.com/v1/turn/keys";

// Longer than any broadcast we expect: a credential handed out
// at kickoff has to still work at the two-minute warning.
const TTL_SECONDS = 4 * 60 * 60;
// Stop handing a credential out this long before it expires,
// so nobody starts a connection with one about to die.
const REFRESH_MARGIN_MS = 15 * 60 * 1000;
// Cloudflare is not in the media path — if minting is slow we
// would rather serve STUN than hang the handshake.
const FETCH_TIMEOUT_MS = 5000;
// After a failure, don't retry on every single request.
const FAILURE_BACKOFF_MS = 60 * 1000;

function keyId() {
  return String(process.env.CF_TURN_KEY_ID || "").trim();
}

function apiToken() {
  return String(process.env.CF_TURN_API_TOKEN || "").trim();
}

// Does this deployment have a relay at all? The route answers
// this on GET, so a deploy can be checked without anyone
// handling the secrets.
export function turnConfigured() {
  return keyId().length > 0 && apiToken().length > 0;
}

// Cloudflare's docs have used both shapes for this response
// ({ iceServers: {...} } historically, { iceServers: [...] }
// now), so accept either and keep only entries that actually
// look like ICE servers.
//
// Port 53 is dropped on purpose: Cloudflare offers it as an
// alternate, browsers block it, and a blocked URL only adds a
// timeout to candidate gathering.
function normalize(payload) {
  const raw = payload && payload.iceServers;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = [];
  for (const entry of list) {
    if (!entry) continue;
    const urls = (Array.isArray(entry.urls) ? entry.urls : [entry.urls])
      .filter((u) => typeof u === "string" && /^(stun|turns?):/.test(u))
      .filter((u) => !/:53(\?|$)/.test(u));
    if (urls.length === 0) continue;
    const server = { urls };
    if (entry.username && entry.credential) {
      server.username = String(entry.username);
      server.credential = String(entry.credential);
    }
    out.push(server);
  }
  return out;
}

// Did we actually get a relay, or just more STUN?
export function hasRelay(servers) {
  return (servers || []).some((s) =>
    (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) =>
      String(u || "").startsWith("turn")
    )
  );
}

let cached = null; // { iceServers, expiresAt }
let failedUntil = 0;
let inflight = null;

async function mint() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${CF_API}/${encodeURIComponent(keyId())}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      const bad = res.status === 401 || res.status === 403 || res.status === 404;
      return { ok: false, code: bad ? "bad_credentials" : `http_${res.status}` };
    }
    const data = await res.json();
    const iceServers = normalize(data);
    if (!hasRelay(iceServers)) return { ok: false, code: "no_relay" };
    return { ok: true, iceServers, expiresAt: Date.now() + TTL_SECONDS * 1000 };
  } catch (err) {
    return {
      ok: false,
      code: err && err.name === "AbortError" ? "timeout" : "network",
    };
  } finally {
    clearTimeout(timer);
  }
}

// The one thing the route calls. ALWAYS resolves to a usable
// iceServers array — Cloudflare's relay plus the STUN we
// already shipped when things are working, STUN alone when
// they aren't.
export async function getIceServers() {
  if (!turnConfigured()) {
    return {
      ok: true,
      configured: false,
      code: "not_configured",
      iceServers: STUN_ONLY,
    };
  }
  const now = Date.now();
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now) {
    return {
      ok: true,
      configured: true,
      iceServers: cached.iceServers,
      expiresAt: cached.expiresAt,
    };
  }
  if (now < failedUntil) {
    return { ok: false, configured: true, code: "upstream", iceServers: STUN_ONLY };
  }
  // One mint at a time per lambda, however many viewers walk
  // in at once.
  if (!inflight) {
    inflight = mint().finally(() => {
      inflight = null;
    });
  }
  const result = await inflight;
  if (!result.ok) {
    failedUntil = Date.now() + FAILURE_BACKOFF_MS;
    return { ok: false, configured: true, code: result.code, iceServers: STUN_ONLY };
  }
  cached = {
    iceServers: [...STUN_ONLY, ...result.iceServers],
    expiresAt: result.expiresAt,
  };
  return {
    ok: true,
    configured: true,
    iceServers: cached.iceServers,
    expiresAt: cached.expiresAt,
  };
}

// Local pokes and tests; never called by the routes.
export function resetTurnCache() {
  cached = null;
  failedUntil = 0;
  inflight = null;
}
