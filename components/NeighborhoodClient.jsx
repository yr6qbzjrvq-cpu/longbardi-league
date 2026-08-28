"use client";

// ============================================================
// HSPNeighborhood — screen flow
// ------------------------------------------------------------
// Decides which screen /neighborhood shows: first visit (no
// saved character in this browser) → avatar creator; returning
// player → straight into the Town Square. "Edit Character" in
// the room comes back to the creator, and saving there drops
// you into the square. Identity is per-browser by design (see
// lib/neighborhoodPlayer).
// ============================================================

import { useEffect, useState } from "react";
import NeighborhoodAvatarCreator from "./NeighborhoodAvatarCreator";
import NeighborhoodRoom from "./NeighborhoodRoom";
import { loadPlayer } from "@/lib/neighborhoodPlayer";

export default function NeighborhoodClient({ preview }) {
  const [view, setView] = useState("loading");
  const [player, setPlayer] = useState(null);

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

  if (view === "room" && player) {
    return (
      <NeighborhoodRoom
        key={player.updatedAt || "room"}
        player={player}
        preview={preview}
        onEditCharacter={() => setView("creator")}
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
              onClick={() => setView("room")}
              className="min-h-[44px] rounded-md border border-espn px-4 font-display text-sm uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white"
            >
              Back to Town Square
            </button>
          )}
        </div>
      </div>

      <NeighborhoodAvatarCreator
        onSaved={(record) => {
          setPlayer(record);
          setView("room");
        }}
      />
    </div>
  );
}
