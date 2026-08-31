// ============================================================
// HSPNeighborhood — Realtime channel authorization (milestone 10)
// ------------------------------------------------------------
// Server-only. Mints the short-lived, ROOM-SCOPED token a
// client presents when it subscribes to a private Realtime
// channel.
//
// Why this exists: the room channels are `private: true`, so
// Supabase runs RLS policies on realtime.messages for every
// subscribe and every client-side publish. Those policies read
// claims out of the presented JWT. With no token at all a
// browser still presents the anon key (a valid project JWT
// with role "anon"), which the policies accept for reading —
// but never for publishing gameplay events. A token minted
// here carries an `nb_room` claim, which lets the policy pin a
// subscriber to the ONE room they asked for — plus, for a room
// with a screen, an `nb_screen` claim naming the shared
// big-board signaling channel that room listens on.
//
// The signing key is the project's legacy JWT secret, the same
// secret Supabase uses to verify the anon and service_role
// keys. It is OPTIONAL: without SUPABASE_JWT_SECRET set in the
// environment we simply don't mint, clients fall back to the
// anon key, and the publish-side lockdown (the part that
// actually stops forged events) is unaffected. See
// README-neighborhood.md → "Channel authorization".
// ============================================================

import crypto from "node:crypto";
import { screenChannelFor } from "@/lib/neighborhood/rooms";

const TOKEN_TTL_SECONDS = 60 * 60; // an hour; refreshed on the heartbeat

function secret() {
  return process.env.SUPABASE_JWT_SECRET || "";
}

// Are room-scoped tokens available in this deployment?
export function realtimeTokensEnabled() {
  return secret().length >= 24;
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

// A signed JWT scoping this browser to one room's channels.
// Returns null when no signing secret is configured.
export function mintRealtimeToken(playerId, roomId) {
  const key = secret();
  if (key.length < 24) return null;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_TTL_SECONDS;
  const screen = screenChannelFor(roomId);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({
      iss: "hspn-neighborhood",
      aud: "authenticated",
      role: "authenticated",
      sub: playerId,
      nb_player: playerId,
      nb_room: roomId,
      // Milestone 12: the screen-share handshake for every room
      // with a screen rides ONE shared topic, so a room-scoped
      // token has to name that channel too or the policy would
      // refuse the subscribe. Absent for rooms without a
      // screen — they open no signaling channel at all.
      ...(screen ? { nb_screen: screen } : {}),
      iat: now,
      exp,
    })
  );
  const data = `${head}.${body}`;
  const sig = crypto.createHmac("sha256", key).update(data).digest("base64url");
  return { token: `${data}.${sig}`, expiresAt: exp * 1000 };
}
