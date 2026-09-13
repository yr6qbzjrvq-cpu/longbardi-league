// ============================================================
// HSPNeighborhood — the TV guide (milestone 28)
// ------------------------------------------------------------
// One shared module, both sides, like every other rule in
// lib/neighborhood/*: the admin CRUD, the gated route, the
// room's guide overlay and the YouTube player all agree on what
// a channel IS because they all import this file.
//
// TWO KINDS OF CHANNEL, one lineup table:
//
//   "tv"       Austin's YouTube TV lineup. Only meaningful
//              while HE is broadcasting in POPUP MODE: his tab
//              opened the YouTube TV window, so his tab is
//              allowed to navigate it (an opener may set the
//              location of a window it opened, cross-origin
//              included). A viewer tapping one of these is
//              asking the ROOM's remote to change HIS popup —
//              the request rides the gameplay topic, which no
//              client can publish on, so it is exactly as
//              forge-proof as a kick.
//
//              The URL is an OPAQUE STRING here on purpose.
//              tv.youtube.com is behind a login and its links
//              are not a documented, stable format; Austin
//              grabs the real link out of his own grid and
//              pastes it (README-neighborhood.md walks through
//              it). Nothing in this codebase tries to build
//              one, parse one, or understand one — it is
//              length-checked, host-checked and handed back.
//
//   "youtube"  Public YouTube, for when nobody is
//              broadcasting: an <iframe> player over the same
//              screen rect, so the big screens are never a
//              dead rectangle. Here the URL IS parsed, because
//              the IFrame API wants a video id.
//
// PRIORITY: a live broadcast always wins. YouTube is what the
// screens do while the desk is empty.
//
// THE GLOBAL RATE LIMIT lives in one place too. Popup mode
// only exists while Austin is live and YouTube mode only while
// he is not, so one timestamp on the state row gates both: use
// the remote, and the whole room waits CHANNEL_GAP_MS before
// anyone (including you) may use it again. That is the
// difference between a shared television and eight people
// fighting over a remote.
// ============================================================

export const CHANNEL_KINDS = ["tv", "youtube"];

// The state row's id. It is the SCREEN CHANNEL id from
// lib/neighborhood/rooms.js (SCREEN_CHANNEL === "big-board"),
// spelled out here so a serverless route can know what row to
// lock without importing the 6,000-line room registry.
export const TV_STATE_ID = "big-board";

export const TV_STATE_TABLE = "neighborhood_tv_state";
export const CHANNELS_TABLE = "neighborhood_channels";

// One channel change per room per this long. Austin's ask was
// "10-15 seconds"; 12 is long enough that a room cannot strobe
// the screen and short enough that a genuine "no, put the game
// back on" doesn't feel broken.
export const CHANNEL_GAP_MS = 12_000;

// Loose per-player flood guard on top of the global gap: a
// number no hand can trip and a script trips at once.
export const CHANNEL_FLOOD_WINDOW_MS = 60_000;
export const CHANNEL_FLOOD_MAX = 6;

// How long a popup-mode broadcast's stamp stays believable.
// Austin's tab re-stamps it every POPUP_HEARTBEAT_MS while the
// popup is open; if the laptop shuts, the remote goes dead on
// its own rather than firing channel changes at nobody.
//
// THE WINDOW CANNOT BE SHORTER THAN CHROME'S THROTTLE FLOOR.
// This stamp is a setInterval living in the broadcasting game
// tab, and popup mode's entire premise is that Austin is
// watching the POPUP — so that tab is hidden, by definition,
// for the whole broadcast. A hidden tab's timers are throttled
// to roughly one wake-up per minute. A 45s window asked a
// timer that fires every ~60-80s to land inside 45s, which it
// can never do: the stamp went stale every single time, the
// guide told every phone in the league "Nobody's broadcasting
// YouTube TV right now", and the tv-channel route started
// answering 409 no_popup. The broadcast was not failing — only
// the proof that it existed was.
//
// 210s matches ACTIVE_WINDOW_MS so the two liveness stories
// cannot disagree, and it still lets a shut laptop take the
// remote away on its own within a few minutes.
export const POPUP_HEARTBEAT_MS = 15_000;
export const POPUP_LIVE_WINDOW_MS = 210_000;

export const CHANNEL_NAME_MAX = 40;
export const CHANNEL_URL_MAX = 400;
export const CHANNEL_MAX_PER_KIND = 60;

// A "tv" channel must point at YouTube TV. Not a security
// boundary — only the commissioner can add channels at all —
// but it catches the obvious paste of the wrong tab, and it
// keeps the popup pointed somewhere Austin actually meant.
const TV_HOSTS = ["tv.youtube.com"];

// A "youtube" channel may be any of the shapes YouTube hands
// out when you copy a link, plus a bare video id.
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function isChannelKind(kind) {
  return CHANNEL_KINDS.includes(String(kind || ""));
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Pull the 11-character video id out of whatever Austin
// pasted. Returns null when there isn't one — the admin UI
// turns that into "paste the link to the actual video", which
// is the honest answer for a /@handle/live URL: resolving one
// needs the YouTube Data API and a key this site does not have.
export function youtubeIdFrom(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (YT_ID_RE.test(raw)) return raw;
  let u;
  try {
    u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return YT_ID_RE.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtube-nocookie.com") {
    return null;
  }
  const v = u.searchParams.get("v");
  if (v && YT_ID_RE.test(v)) return v;
  const parts = u.pathname.split("/").filter(Boolean);
  // /live/<id>, /embed/<id>, /shorts/<id>, /v/<id>
  if (parts.length >= 2 && ["live", "embed", "shorts", "v"].includes(parts[0])) {
    return YT_ID_RE.test(parts[1]) ? parts[1] : null;
  }
  return null;
}

// Validate one row's worth of admin input. Returns
// { ok: true, value } or { ok: false, error } — the same shape
// the admin route hands straight back to the form.
export function validateChannelInput({ kind, name, url, sort, enabled }) {
  if (!isChannelKind(kind)) {
    return { ok: false, error: "Pick a channel type." };
  }
  const cleanName = String(name || "").replace(/\s+/g, " ").trim();
  if (!cleanName) return { ok: false, error: "Give the channel a name." };
  if (cleanName.length > CHANNEL_NAME_MAX) {
    return { ok: false, error: `Names stop at ${CHANNEL_NAME_MAX} characters.` };
  }
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl) return { ok: false, error: "Paste the channel's link." };
  if (cleanUrl.length > CHANNEL_URL_MAX) {
    return { ok: false, error: "That link is too long to be real." };
  }

  if (kind === "tv") {
    const host = hostOf(cleanUrl);
    if (!host || !TV_HOSTS.includes(host)) {
      return {
        ok: false,
        error: "A YouTube TV channel needs a https://tv.youtube.com/... link.",
      };
    }
  } else if (!youtubeIdFrom(cleanUrl)) {
    return {
      ok: false,
      error:
        "That isn't a YouTube video link. Paste the link to the actual video or live stream (a /@handle/live page can't be resolved here).",
    };
  }

  const n = Number(sort);
  return {
    ok: true,
    value: {
      kind,
      name: cleanName,
      url: cleanUrl,
      sort: Number.isFinite(n) ? Math.max(0, Math.min(9999, Math.round(n))) : 0,
      enabled: enabled === undefined ? true : !!enabled,
    },
  };
}

// DB row → what goes over the wire. The video id is derived
// here rather than stored, so fixing the parser fixes every
// row that was ever saved.
export function toWireChannel(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    // A "tv" URL never leaves the server as anything but this
    // opaque string, and it is not a secret: it is a link to a
    // page nobody can watch without Austin's login.
    url: row.url,
    videoId: row.kind === "youtube" ? youtubeIdFrom(row.url) : null,
    sort: row.sort,
    enabled: !!row.enabled,
  };
}

// Is a popup-mode broadcast live right now? A stamp older than
// the window is a laptop that shut, not a broadcaster.
export function popupLive(state, nowMs = Date.now()) {
  if (!state || !state.popup_at || !state.popup_by) return false;
  return nowMs - Number(state.popup_at) < POPUP_LIVE_WINDOW_MS;
}

// DB state row → what the room needs to render the guide.
export function toWireTvState(state, nowMs = Date.now()) {
  if (!state) return null;
  return {
    ytChannelId: state.yt_channel_id || null,
    ytStartedAt: state.yt_started_at ? Number(state.yt_started_at) : null,
    tvChannelId: state.tv_channel_id || null,
    changedKind: state.changed_kind || null,
    changedBy: state.changed_by || null,
    changedAt: state.changed_at ? Number(state.changed_at) : null,
    popupLive: popupLive(state, nowMs),
    popupBy: popupLive(state, nowMs) ? state.popup_by : null,
    version: Number(state.version) || 0,
  };
}

// How far into the current YouTube channel are we? Live
// streams ignore this (the player is always at the live edge);
// a VOD seeks here, wrapping when it has run past the end so
// the channel keeps playing instead of sitting on a dead
// frame.
export function ytElapsedSeconds(startedAtMs, nowMs, durationSeconds) {
  if (!startedAtMs) return 0;
  const elapsed = Math.max(0, (nowMs - startedAtMs) / 1000);
  if (!durationSeconds || durationSeconds <= 0) return elapsed;
  return elapsed % durationSeconds;
}

// A viewer is allowed to be this far off the shared clock
// before it is worth a seek. Below this, seeking looks worse
// than the drift does.
export const YT_SYNC_TOLERANCE_S = 2.5;
