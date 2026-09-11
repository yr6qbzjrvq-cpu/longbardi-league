"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  CHANNEL_GAP_MS,
  YT_SYNC_TOLERANCE_S,
  ytElapsedSeconds,
} from "@/lib/neighborhood/channels";

// ============================================================
// HSPNeighborhood — the TV guide + the YouTube channel
// (milestone 28)
// ------------------------------------------------------------
// Everything the two big screens do when they are not showing
// Austin's WebRTC feed, plus the remote that changes the
// channel when they ARE.
//
// This component owns three things and nothing else:
//
//   1. THE PLAYER. A YouTube IFrame-API player in a box the
//      room's rAF loop pins to the screen rect, exactly like
//      the <video> next to it — same camera transform, same
//      theater framing. The room hands us the ref; we never
//      touch position ourselves.
//
//   2. THE GUIDE. A panel listing the lineup, with the global
//      cooldown drawn on it, who touched the remote last, and
//      one button per channel.
//
//   3. THE REMOTE. A little prop that hangs next to the TV and
//      opens the guide. Also pinned by the room's loop.
//
// WHAT IT DOES NOT OWN: the request itself. `onRequest` goes
// back to the room, which asks the server, which validates and
// broadcasts. Nothing here decides that a channel changed —
// this component only ever renders what the server said.
//
// SYNC. The state row carries the channel and the millisecond
// it started. A live stream needs nothing (every player is at
// the live edge). A VOD is seeked to (serverNow - startedAt),
// wrapped by its own duration, and re-checked every few
// seconds — but only corrected past YT_SYNC_TOLERANCE_S,
// because a seek looks far worse than two seconds of drift.
//
// AUTOPLAY. Same rule as the screen share: land muted, and let
// the first tap turn the sound on (TAP FOR SOUND). A browser
// will refuse to autoplay audio and we would rather have a
// silent picture than no picture.
//
// EMBEDDABILITY. Plenty of YouTube videos refuse to be
// embedded at all (error 101/150). That is not a bug we can
// fix, so it gets an honest panel: this channel can't play
// here, pick another.
// ============================================================

const API_SRC = "https://www.youtube.com/iframe_api";
const SYNC_EVERY_MS = 5000;

let apiPromise = null;

// One script tag per page, however many players ask for it.
function loadYouTubeApi() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") {
        try {
          prev();
        } catch {
          // not ours to care about
        }
      }
      resolve(window.YT);
    };
    const tag = document.createElement("script");
    tag.src = API_SRC;
    tag.async = true;
    tag.onerror = () => reject(new Error("youtube api blocked"));
    document.head.appendChild(tag);
    // A blocked third-party script never fires either handler.
    setTimeout(() => {
      if (window.YT && window.YT.Player) resolve(window.YT);
      else reject(new Error("youtube api timeout"));
    }, 12000);
  });
  return apiPromise;
}

function secondsLeft(changedAt, offset) {
  if (!changedAt) return 0;
  const since = Date.now() + offset - changedAt;
  return Math.max(0, Math.ceil((CHANNEL_GAP_MS - since) / 1000));
}

const NeighborhoodTvGuide = forwardRef(function NeighborhoodTvGuide(
  {
    roomId,
    hasScreen,
    boxRef,
    remoteRef,
    theater,
    feedLive,
    open,
    onOpenChange,
    onRequest,
    onToggleTheater,
    onTune,
  },
  ref
) {
  const [lineup, setLineup] = useState({ tv: [], youtube: [] });
  const [state, setState] = useState(null);
  const [offset, setOffset] = useState(0); // serverNow - Date.now()
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [note, setNote] = useState("");
  const [ytFailed, setYtFailed] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [apiDead, setApiDead] = useState(false);

  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const wantRef = useRef(null); // { videoId, startedAt }
  const stateRef = useRef(null);
  const offsetRef = useRef(0);
  const soundRef = useRef(false);

  stateRef.current = state;
  offsetRef.current = offset;
  soundRef.current = soundOn;

  // Chrome will not START a video in a hidden tab, and never
  // retries on its own once the tab comes back — the same trap
  // the screen-share <video> hits on iOS, and the reason that one
  // asks to play twelve times. A TV that is dark when you look
  // back at it is worse than no TV, so nudge the player whenever
  // the page becomes visible and once a beat while a channel is
  // supposed to be on. Muted stays muted: this only ever asks for
  // a picture, never for sound.
  function nudgePlayer() {
    const p = playerRef.current;
    if (!p || typeof p.playVideo !== "function") return;
    try {
      if (!soundRef.current && p.mute) p.mute();
      const st = typeof p.getPlayerState === "function" ? p.getPlayerState() : null;
      // 1 = playing, 3 = buffering. Both are fine; leave them be.
      if (st !== 1 && st !== 3) p.playVideo();
    } catch {
      // a player that refuses shows the panel below
    }
  }

  // The kind of channel the room may ask for right now. Popup
  // mode means Austin's own window is on the board and the
  // remote drives IT; otherwise the screens are ours.
  const popupUp = !!(state && state.popupLive);
  const activeKind = popupUp ? "tv" : "youtube";
  const list = lineup[activeKind] || [];
  const currentId = popupUp ? state && state.tvChannelId : state && state.ytChannelId;
  const current = list.find((c) => c.id === currentId) || null;

  // YouTube plays only while nobody is broadcasting. A live
  // feed always wins the glass.
  const youtubeUp = !feedLive && !popupUp && !!(state && state.ytChannelId);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/neighborhood/channels");
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.ok) return;
      setLineup(data.channels || { tv: [], youtube: [] });
      setState(data.state || null);
      if (data.serverNow) setOffset(data.serverNow - Date.now());
    } catch {
      // the guide just stays as it was
    }
  }, []);

  useEffect(() => {
    if (!hasScreen) return undefined;
    refresh();
    return undefined;
  }, [hasScreen, roomId, refresh]);

  // ---- what the room hands us off the gameplay topic -------
  useImperativeHandle(ref, () => ({
    // A validated channel change. Server-published, so this is
    // the truth — there is no optimistic local version.
    onTvChannel(p) {
      if (!p) return;
      setState((s) => {
        const next = { ...(s || {}) };
        next.changedBy = p.by || null;
        next.changedAt = p.at || null;
        next.changedKind = p.kind || null;
        if (p.kind === "youtube") {
          next.ytChannelId = p.channelId;
          next.ytStartedAt = p.startedAt || p.at;
        } else {
          next.tvChannelId = p.channelId;
        }
        return next;
      });
      setYtFailed(false);
      setNote(p.by ? `${p.by} put on ${p.name}.` : `Now on ${p.name}.`);
      if (p.kind === "tv" && onTune) onTune(p);
    },
    // Austin's popup broadcast started or stopped.
    onTvMode(p) {
      if (!p) return;
      setState((s) => ({ ...(s || {}), popupLive: !!p.popupLive }));
      refresh();
    },
    refresh,
    isYouTubeUp: () => youtubeUp,
  }));

  // ---- the cooldown clock ----------------------------------
  useEffect(() => {
    const at = state && state.changedAt;
    if (!at) {
      setCooldown(0);
      return undefined;
    }
    setCooldown(secondsLeft(at, offsetRef.current));
    const t = setInterval(() => {
      const left = secondsLeft(at, offsetRef.current);
      setCooldown(left);
      if (left <= 0) clearInterval(t);
    }, 500);
    return () => clearInterval(t);
  }, [state]);

  // A note is a toast, not a permanent label.
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(""), 4200);
    return () => clearTimeout(t);
  }, [note]);

  // ---- the player ------------------------------------------
  const wanted = youtubeUp
    ? {
        videoId: (lineup.youtube.find((c) => c.id === (state && state.ytChannelId)) || {}).videoId,
        startedAt: (state && state.ytStartedAt) || null,
      }
    : null;
  const wantedKey = wanted && wanted.videoId ? `${wanted.videoId}:${wanted.startedAt}` : "";

  useEffect(() => {
    if (!hasScreen) return undefined;
    if (!wantedKey) {
      // Nothing should be playing. Stop the picture without
      // tearing the player down — walking back into a channel
      // is instant that way.
      const p = playerRef.current;
      if (p && p.stopVideo) {
        try {
          p.stopVideo();
        } catch {
          // already gone
        }
      }
      return undefined;
    }
    let alive = true;
    const [videoId, startedAtRaw] = wantedKey.split(":");
    const startedAt = Number(startedAtRaw) || null;
    wantRef.current = { videoId, startedAt };

    const startSeconds = () =>
      Math.max(0, Math.floor(ytElapsedSeconds(startedAt, Date.now() + offsetRef.current, 0)));

    loadYouTubeApi()
      .then((YT) => {
        if (!alive || !hostRef.current) return;
        setApiDead(false);
        if (playerRef.current && playerRef.current.loadVideoById) {
          playerRef.current.loadVideoById({
            videoId,
            startSeconds: startSeconds(),
          });
          if (!soundRef.current && playerRef.current.mute) playerRef.current.mute();
          return;
        }
        playerRef.current = new YT.Player(hostRef.current, {
          videoId,
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            start: startSeconds(),
            origin: typeof window !== "undefined" ? window.location.origin : undefined,
          },
          events: {
            onReady: (e) => {
              try {
                // Autoplay policy: muted picture now, sound on
                // the first tap.
                if (!soundRef.current) e.target.mute();
                e.target.playVideo();
              } catch {
                // a player that won't start shows the panel below
              }
            },
            onError: () => setYtFailed(true),
            onStateChange: (e) => {
              // A channel that ran to the end loops, so the
              // screen is never a dead frame.
              if (e && e.data === 0 && wantRef.current) {
                try {
                  e.target.seekTo(0, true);
                  e.target.playVideo();
                } catch {
                  // ignore
                }
              }
            },
          },
        });
      })
      .catch(() => {
        if (alive) setApiDead(true);
      });

    return () => {
      alive = false;
    };
  }, [hasScreen, wantedKey]);

  // Leaving a room with a screen (or a broadcast taking over)
  // should not leave audio playing behind the wall.
  useEffect(() => {
    if (youtubeUp) return undefined;
    const p = playerRef.current;
    if (p && p.pauseVideo) {
      try {
        p.pauseVideo();
      } catch {
        // already gone
      }
    }
    setSoundOn(false);
    return undefined;
  }, [youtubeUp]);

  // Coming back to the tab: the channel should already be on.
  useEffect(() => {
    if (!youtubeUp) return undefined;
    const onVis = () => {
      if (document.visibilityState === "visible") nudgePlayer();
    };
    document.addEventListener("visibilitychange", onVis);
    onVis();
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeUp, wantedKey]);

  // Drift correction. Live streams are skipped entirely: every
  // player is already at the live edge and a seek would only
  // push somebody into the past.
  useEffect(() => {
    if (!youtubeUp) return undefined;
    const t = setInterval(() => {
      nudgePlayer();
      const p = playerRef.current;
      const want = wantRef.current;
      if (!p || !want || !want.startedAt || !p.getDuration) return;
      let duration = 0;
      try {
        duration = p.getDuration() || 0;
        const data = p.getVideoData ? p.getVideoData() : null;
        if (data && data.isLive) return;
      } catch {
        return;
      }
      if (!duration) return;
      const target = ytElapsedSeconds(want.startedAt, Date.now() + offsetRef.current, duration);
      try {
        const at = p.getCurrentTime();
        if (Math.abs(at - target) > YT_SYNC_TOLERANCE_S) p.seekTo(target, true);
      } catch {
        // ignore
      }
    }, SYNC_EVERY_MS);
    return () => clearInterval(t);
  }, [youtubeUp]);

  // ---- taps on the picture ---------------------------------
  // Same grammar as the screen-share feed: tap = sound, then
  // theater.
  function tapPicture(e) {
    e.stopPropagation();
    if (!soundOn) {
      const p = playerRef.current;
      try {
        if (p && p.unMute) p.unMute();
        if (p && p.playVideo) p.playVideo();
      } catch {
        // ignore
      }
      setSoundOn(true);
      return;
    }
    if (onToggleTheater) onToggleTheater();
  }

  async function pick(channel) {
    if (busy || cooldown > 0) return;
    setBusy(true);
    try {
      const out = await onRequest(activeKind, channel.id);
      if (out && out.error) {
        setNote(out.error);
        if (out.retryInMs) {
          setCooldown(Math.max(1, Math.ceil(out.retryInMs / 1000)));
          setState((s) => ({
            ...(s || {}),
            changedAt: Date.now() + offsetRef.current - (CHANNEL_GAP_MS - out.retryInMs),
            changedBy: out.changedBy || (s && s.changedBy) || null,
          }));
        }
      }
    } finally {
      setBusy(false);
    }
  }

  if (!hasScreen) return null;

  const guideCanTune = popupUp ? list.length > 0 : list.length > 0 && !feedLive;
  const blockedReason = feedLive && !popupUp ? "Austin's feed is on the board." : null;

  return (
    <>
      {/* The YouTube channel. Pinned to the screen rect by the
          room's rAF loop — display/size/transform belong to
          that loop, exactly like the <video> it stands in for.
          React only decides what goes inside. */}
      <div
        ref={boxRef}
        style={{
          display: "none",
          position: "absolute",
          left: 0,
          top: 0,
          transformOrigin: "0 0",
          zIndex: theater ? 15 : 5,
          backgroundColor: theater ? "rgba(6,8,12,0.96)" : "#05070c",
          overflow: "hidden",
        }}
        aria-label="Big screen channel"
      >
        <div className="pointer-events-none h-full w-full">
          <div ref={hostRef} className="h-full w-full" />
        </div>
        {/* The iframe eats pointer events, so the tap surface
            is ours and sits on top of it. Controls are off, so
            there is nothing underneath to steal. */}
        <div
          onPointerDown={tapPicture}
          onContextMenu={(e) => e.preventDefault()}
          className="absolute inset-0"
          style={{ cursor: "pointer", touchAction: "none" }}
        />
        {(ytFailed || apiDead) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/80 px-4 text-center">
            <span className="font-display text-lg uppercase tracking-widest text-white">
              Channel unavailable
            </span>
            <span className="text-xs text-gray-300">
              {apiDead
                ? "YouTube wouldn't load in this browser."
                : "This one won't play outside YouTube. Pick another."}
            </span>
          </div>
        )}
        {!ytFailed && !apiDead && !soundOn && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-3">
            <span className="rounded-full bg-black/75 px-4 py-1.5 font-display text-lg uppercase tracking-widest text-white">
              Tap for sound
            </span>
          </div>
        )}
        {theater && (
          <div className="absolute right-2 top-2 flex gap-2">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onToggleTheater && onToggleTheater()}
              className="min-h-[38px] rounded-md bg-white/15 px-3 font-display text-xs uppercase tracking-widest text-white backdrop-blur hover:bg-white/25"
            >
              Close
            </button>
          </div>
        )}
      </div>

      {/* The remote. A prop that hangs next to the TV, pinned
          by the same loop; tapping it opens the guide. */}
      <button
        ref={remoteRef}
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onOpenChange(!open)}
        aria-label="TV guide"
        title="TV guide"
        style={{
          display: "none",
          position: "absolute",
          left: 0,
          top: 0,
          transformOrigin: "0 0",
          zIndex: 8,
        }}
        className="rounded-[10px] border border-gray-900/60 bg-gray-800 px-1.5 py-1 shadow-lg transition-transform hover:scale-105"
      >
        <span className="block h-[10px] w-[26px] rounded-sm bg-emerald-400/90" />
        <span className="mt-1 grid grid-cols-3 gap-[3px]">
          {Array.from({ length: 9 }).map((_, i) => (
            <span key={i} className="h-[5px] w-[6px] rounded-[2px] bg-gray-400" />
          ))}
        </span>
        <span className="mt-1 block h-[6px] w-[26px] rounded-full bg-red-500" />
      </button>

      {/* The guide itself. */}
      {open && (
        <div className="absolute inset-x-0 bottom-0 z-[22] px-2 pb-2 sm:inset-x-auto sm:right-2 sm:top-2 sm:bottom-auto sm:w-80 sm:px-0 sm:pb-0">
          <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-gray-200 bg-white/95 p-3 shadow-xl dark:border-gray-700 dark:bg-gray-900/95">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-display text-sm uppercase tracking-widest text-gray-900 dark:text-gray-100">
                TV Guide
              </h3>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-md border border-gray-300 px-2 py-1 font-display text-[10px] uppercase tracking-widest text-gray-600 dark:border-gray-600 dark:text-gray-300"
              >
                Close
              </button>
            </div>

            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              {popupUp
                ? "Austin is broadcasting YouTube TV — this remote changes what he's watching."
                : feedLive
                  ? "Austin's feed is on the board. The channels come back when he stops."
                  : "Nobody's broadcasting, so the screens are ours."}
            </p>

            {current && (
              <p className="mb-2 rounded-md bg-gray-100 px-2 py-1.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                Now showing: <strong>{current.name}</strong>
                {state && state.changedBy ? ` — put on by ${state.changedBy}` : ""}
              </p>
            )}

            {cooldown > 0 && (
              <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                Channel just changed — the remote is warm for {cooldown}s.
              </p>
            )}

            {note && (
              <p className="mb-2 rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
                {note}
              </p>
            )}

            <div className="space-y-1.5">
              {list.map((c) => {
                const isCurrent = c.id === currentId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={busy || cooldown > 0 || !guideCanTune || !!blockedReason}
                    onClick={() => pick(c)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 ${
                      isCurrent
                        ? "border-espn bg-espn/10 text-espn"
                        : "border-gray-200 text-gray-800 hover:border-espn hover:text-espn dark:border-gray-700 dark:text-gray-200"
                    }`}
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="font-display text-[10px] uppercase tracking-widest">
                      {isCurrent ? "On" : "Watch"}
                    </span>
                  </button>
                );
              })}
              {list.length === 0 && (
                <p className="rounded-md border border-dashed border-gray-300 px-3 py-6 text-center text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">
                  {popupUp
                    ? "No YouTube TV channels in the lineup yet."
                    : "No channels in the lineup yet."}
                </p>
              )}
            </div>

            {blockedReason && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{blockedReason}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
});

export default NeighborhoodTvGuide;
