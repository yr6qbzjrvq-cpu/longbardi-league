"use client";

// ============================================================
// HSPNeighborhood — screen flow (multiplayer, milestone 4)
// ------------------------------------------------------------
// Decides which screen /neighborhood shows: first visit (no
// saved character in this browser) → avatar creator; returning
// player → the Town Square, which joins the realtime room on
// mount. Join rejections route back here gracefully:
//   name_taken / bad_name → creator with the reason on top
//   room_full             → a "square is full" screen with retry
//   kicked                → the removed screen (milestone 7),
//                           also reached live when the
//                           commissioner kicks mid-session
// Identity is per-browser by design (see lib/neighborhoodPlayer).
// ============================================================

import { useEffect, useState } from "react";
import NeighborhoodAvatarCreator from "./NeighborhoodAvatarCreator";
import NeighborhoodRoom from "./NeighborhoodRoom";
import { loadPlayer } from "@/lib/neighborhoodPlayer";

export default function NeighborhoodClient({ preview }) {
  const [view, setView] = useState("loading");
  const [player, setPlayer] = useState(null);
  const [joinError, setJoinError] = useState(null);
  const [removedInfo, setRemovedInfo] = useState(null); // { message, until }
  const [roomNonce, setRoomNonce] = useState(0); // bump to force a fresh join attempt

  // localStorage is browser-only, so route after mount.
  useEffect(() => {
    const existing = loadPlayer();
    if (existing && existing.username) {
      setPlayer(existing);
      setView("room");
    } else {
      setView("creator");
    }
  }, []);

  if (view === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Loading the neighborhood…
        </p>
      </div>
    );
  }

  if (view === "removed") {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center">
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100">
          You were removed from the neighborhood
        </h1>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          {(removedInfo && removedInfo.message) ||
            "The commissioner removed you from the neighborhood for a little while. Take a breather and try again soon."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              setRemovedInfo(null);
              setJoinError(null);
              setRoomNonce((n) => n + 1);
              setView("room");
            }}
            className="min-h-[44px] rounded-md bg-espn px-5 font-display text-sm uppercase tracking-widest text-white transition-opacity hover:opacity-90"
          >
            Try Again
          </button>
        </div>
        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          If the timeout is still running you&apos;ll land right back here —
          the message above says roughly how long is left.
        </p>
      </div>
    );
  }

  if (view === "full") {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center">
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100">
          The Town Square is packed
        </h1>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          {joinError ||
            "The Town Square is full right now (24 max). Hang tight and try again in a minute."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              setJoinError(null);
              setRoomNonce((n) => n + 1);
              setView("room");
            }}
            className="min-h-[44px] rounded-md bg-espn px-5 font-display text-sm uppercase tracking-widest text-white transition-opacity hover:opacity-90"
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={() => {
              setJoinError(null);
              setView("creator");
            }}
            className="min-h-[44px] rounded-md border border-espn px-5 font-display text-sm uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white"
          >
            Edit Character
          </button>
        </div>
      </div>
    );
  }

  if (view === "room" && player) {
    return (
      <NeighborhoodRoom
        key={`${player.updatedAt || "room"}-${roomNonce}`}
        player={player}
        preview={preview}
        onEditCharacter={() => setView("creator")}
        onRemoved={(info) => {
          setRemovedInfo(info || null);
          setView("removed");
        }}
        onJoinFailed={(code, message) => {
          if (code === "room_full") {
            setJoinError(message);
            setView("full");
          } else if (code === "kicked") {
            setRemovedInfo({ message });
            setView("removed");
          } else {
            // name_taken / bad_name → back to the creator with
            // the reason, so they can pick another name.
            setJoinError(message || "Pick a different name and try again.");
            setView("creator");
          }
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {preview && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <strong>Preview.</strong> Only the admin login can see this. Your
          character saves to this browser and walks the Town Square right
          here.
        </div>
      )}

      {joinError && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {joinError}
        </div>
      )}

      <div className="mb-6 border-b-2 border-espn pb-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100 sm:text-4xl">
              HSPNeighborhood
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Make your character, then take a walk in the Town Square.
            </p>
          </div>
          {player && (
            <button
              type="button"
              onClick={() => {
                setJoinError(null);
                setView("room");
              }}
              className="min-h-[44px] rounded-md border border-espn px-4 font-display text-sm uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white"
            >
              Back to Town Square
            </button>
          )}
        </div>
      </div>

      <NeighborhoodAvatarCreator
        onSaved={(record) => {
          setJoinError(null);
          setPlayer(record);
          setRoomNonce((n) => n + 1);
          setView("room");
        }}
      />
    </div>
  );
}
