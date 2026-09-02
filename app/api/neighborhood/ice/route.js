import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { canSeeNeighborhood, sameOrigin } from "@/lib/neighborhoodAccess";
import { ROOMS } from "@/lib/neighborhood/rooms";
import {
  TABLE,
  PLAYER_ID_RE,
  activeBan,
  ACTIVE_WINDOW_MS,
} from "@/lib/neighborhood/multiplayerServer";
import {
  getIceServers,
  turnConfigured,
  hasRelay,
  STUN_ONLY,
} from "@/lib/neighborhood/turnCredentials";

export const dynamic = "force-dynamic";

// ============================================================
// /api/neighborhood/ice — ICE servers for a screen-share peer
// (milestone 11: make the big board work on cellular).
// ------------------------------------------------------------
// Both halves of the mesh call this immediately before they
// build an RTCPeerConnection. It answers with the STUN we have
// always used plus, when Cloudflare TURN is configured, a
// short-lived relay credential — which is what lets a viewer
// on carrier-grade NAT (i.e. anyone on cellular) actually
// receive the feed.
//
// GET  → "does this deployment have a relay?" No credentials,
//        no player context needed. Deploy check.
// POST → the credential itself, for one player standing in a
//        room that has a screen.
//
// THE GATE. A TURN credential is bandwidth someone else pays
// for, so this is not a route to leave lying open now that the
// neighborhood is public:
//   1. the gameplay gate (flag or admin cookie) + same-origin,
//      like every other neighborhood route;
//   2. a well-formed player id that has an ACTIVE row in
//      neighborhood_players — joined, heartbeating inside the
//      75s window — and is not serving a kick;
//   3. that row must be standing in the room it is asking for,
//      and that room must exist in the registry. Until
//      milestone 19 the room also had to HAVE A SCREEN —
//      screen-share peers were the only callers. Proximity
//      voice builds the same kind of peer connection in every
//      room, and a phone on cellular needs the relay for a
//      voice call exactly as much as for the big board, so the
//      screen check became a registry check. Everything else
//      about the gate is unchanged;
//   4. a sliding-window rate limit per player and per IP.
// A stranger with the URL gets 404/400; a leaguemate can ask
// as often as the limit allows and always receives the same
// cached credential, so there is nothing to farm — see
// lib/neighborhood/turnCredentials.js.
//
// NOTHING HERE CAN BREAK THE WIFI PATH. Every failure mode —
// no env vars, Cloudflare down, rate limited, Supabase
// unreachable — answers 200 with the plain STUN list, which is
// exactly the config that shipped before TURN existed.
// ============================================================

// Per-lambda sliding windows. Serverless means several
// instances, so this is a leash rather than a hard cap — the
// real anti-abuse property is that the credential handed out
// is cached and identical, so extra calls cost nothing.
const WINDOW_MS = 5 * 60 * 1000;
const PER_PLAYER = 12; // a page load needs one; retries need a few
const PER_IP = 40; // a household on one NAT is several players
const hits = new Map(); // key → number[] (timestamps)

function rateLimited(key, cap) {
  if (!key) return false;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => t > now - WINDOW_MS);
  if (recent.length >= cap) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 500) {
    // Cheap sweep so a long-lived lambda can't grow forever.
    for (const [k, v] of hits) {
      if (!v.some((t) => t > now - WINDOW_MS)) hits.delete(k);
    }
  }
  return false;
}

function clientIp(request) {
  const fwd = request.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || request.headers.get("x-real-ip") || "";
}

// Degrade, never fail: the caller gets a working ICE config
// whatever went wrong here.
function stunOnly(code) {
  return NextResponse.json({
    ok: true,
    configured: turnConfigured(),
    relay: false,
    code,
    iceServers: STUN_ONLY,
  });
}

export async function GET() {
  if (!(await canSeeNeighborhood())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    configured: turnConfigured(),
    provider: turnConfigured() ? "cloudflare" : null,
  });
}

export async function POST(request) {
  if (!(await canSeeNeighborhood())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Bad origin." }, { status: 403 });
  }
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const playerId = String((body && body.playerId) || "");
    const roomId = String((body && body.roomId) || "");
    if (!PLAYER_ID_RE.test(playerId)) {
      return NextResponse.json(
        { error: "Bad player id.", code: "bad_player" },
        { status: 400 }
      );
    }
    if (!Object.prototype.hasOwnProperty.call(ROOMS, roomId)) {
      return NextResponse.json(
        { error: "That room doesn't exist.", code: "bad_room" },
        { status: 400 }
      );
    }

    if (rateLimited(`p:${playerId}`, PER_PLAYER) || rateLimited(`i:${clientIp(request)}`, PER_IP)) {
      return NextResponse.json(
        {
          ok: false,
          code: "rate_limited",
          relay: false,
          iceServers: STUN_ONLY,
        },
        { status: 429 }
      );
    }

    // Nothing but a real, present, unbanned player gets a
    // relay credential. Without Supabase there is no way to
    // establish that, so nobody does.
    const supabase = getAdminClient();
    if (!supabase) return stunOnly("no_player_check");
    const { data: row, error } = await supabase
      .from(TABLE)
      .select("id, room, last_seen, kicked_until")
      .eq("id", playerId)
      .maybeSingle();
    if (error) throw error;
    if (!row) {
      return NextResponse.json(
        { ok: false, code: "not_joined", relay: false, iceServers: STUN_ONLY },
        { status: 403 }
      );
    }
    const ban = activeBan(row);
    if (ban) {
      return NextResponse.json(
        { ok: false, code: "kicked", relay: false, iceServers: STUN_ONLY },
        { status: 403 }
      );
    }
    // Parsed, not string-compared: Postgres hands back
    // "+00:00" where activeCutoffIso() writes "Z", and those
    // two sort differently as text.
    const seen = row.last_seen ? Date.parse(row.last_seen) : NaN;
    const stale = !Number.isFinite(seen) || seen < Date.now() - ACTIVE_WINDOW_MS;
    if (stale || row.room !== roomId) {
      return NextResponse.json(
        { ok: false, code: "not_in_room", relay: false, iceServers: STUN_ONLY },
        { status: 403 }
      );
    }

    const result = await getIceServers();
    return NextResponse.json({
      ok: true,
      configured: result.configured,
      relay: hasRelay(result.iceServers),
      code: result.code || null,
      iceServers: result.iceServers,
      expiresAt: result.expiresAt || null,
    });
  } catch (err) {
    // Even a thrown error hands back something usable.
    return stunOnly("error");
  }
}
