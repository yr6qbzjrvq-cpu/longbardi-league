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
  signVoiceGrant,
  verifyVoiceGrant,
  VOICE_NONCE_RE,
} from "@/lib/neighborhood/voiceGrant";

export const dynamic = "force-dynamic";

// ============================================================
// /api/neighborhood/voice — voice-chat grants (milestone 19).
// ------------------------------------------------------------
// Voice signaling rides the client-writable per-room rtc topic,
// so nothing on that channel is trusted on identity alone —
// the same story as the screen share. Before a peer accepts a
// voice offer OR a voice answer, the sender must present a
// grant this route minted, bound to a nonce the receiving peer
// invented (lib/neighborhood/voiceGrant.js).
//
// POST {playerId, roomId, nonce}                 → mint
// POST {action:"verify", grant, nonce, from, roomId} → check
// GET                                            → probe
//
// THE MINT GATE. Any leaguemate can get one — that is the
// point of voice — but only while they would be believable in
// person:
//   1. the gameplay gate (flag or admin cookie) + same-origin;
//   2. a well-formed player id with an ACTIVE row — joined,
//      heartbeating inside the 75s window, not serving a kick;
//   3. that row standing in the room it is asking for, which
//      must exist in the registry (any room — voice is not
//      tied to the screens);
//   4. the row must not be MUTED. This is what makes the
//      commissioner's mute button cover the microphone: a
//      muted player gets no grant, and without a grant no peer
//      will complete a handshake with them in either
//      direction;
//   5. a sliding-window rate limit per player and per IP
//      (joining a full 8-way mesh legitimately mints up to 7).
//
// VERIFY is deliberately open to any player, like
// /broadcast/verify: it only ever says yes or no about a grant
// the caller already holds, and it never returns the claims of
// somebody else's grant beyond what the caller must match.
// ============================================================

const WINDOW_MS = 5 * 60 * 1000;
const PER_PLAYER = 40; // an 8-way mesh join mints up to 7, plus retries
const PER_IP = 120; // a household on one NAT is several players
const PER_IP_VERIFY = 240; // verifies are cheap HMAC checks
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

export async function GET() {
  if (!(await canSeeNeighborhood())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  // Grants need the server key they are signed with; without it
  // (or Supabase) there is no way to check who is muted, so
  // voice stays off rather than open.
  const configured =
    !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ADMIN_PASSWORD) &&
    !!getAdminClient();
  return NextResponse.json({ ok: true, configured });
}

export async function POST(request) {
  if (!(await canSeeNeighborhood())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Bad origin." }, { status: 403 });
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // ---- verify: is this grant real? --------------------------
  if (String(body.action || "") === "verify") {
    if (rateLimited(`vi:${clientIp(request)}`, PER_IP_VERIFY)) {
      return NextResponse.json(
        { ok: false, code: "rate_limited" },
        { status: 429 }
      );
    }
    const nonce = String(body.nonce || "");
    const from = String(body.from || "");
    const roomId = String(body.roomId || "");
    if (!VOICE_NONCE_RE.test(nonce) || !PLAYER_ID_RE.test(from)) {
      return NextResponse.json({ ok: false, code: "bad_request" });
    }
    const result = verifyVoiceGrant(body.grant, {
      nonce,
      playerId: from,
      ...(roomId ? { roomId } : {}),
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, code: result.code });
    }
    return NextResponse.json({
      ok: true,
      playerId: result.playerId,
      roomId: result.roomId,
    });
  }

  // ---- mint: may I speak here? ------------------------------
  try {
    const playerId = String(body.playerId || "");
    const roomId = String(body.roomId || "");
    const nonce = String(body.nonce || "");
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
    if (!VOICE_NONCE_RE.test(nonce)) {
      return NextResponse.json(
        { error: "Bad nonce.", code: "bad_nonce" },
        { status: 400 }
      );
    }
    if (
      rateLimited(`p:${playerId}`, PER_PLAYER) ||
      rateLimited(`i:${clientIp(request)}`, PER_IP)
    ) {
      return NextResponse.json(
        { ok: false, code: "rate_limited" },
        { status: 429 }
      );
    }

    const supabase = getAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Voice is not configured.", code: "not_configured" },
        { status: 503 }
      );
    }
    const { data: row, error } = await supabase
      .from(TABLE)
      .select("id, room, last_seen, kicked_until, muted")
      .eq("id", playerId)
      .maybeSingle();
    if (error) throw error;
    if (!row) {
      return NextResponse.json(
        { error: "Join the room first.", code: "not_joined" },
        { status: 403 }
      );
    }
    const ban = activeBan(row);
    if (ban) {
      return NextResponse.json(
        { error: ban.message, code: "kicked" },
        { status: 403 }
      );
    }
    const seen = row.last_seen ? Date.parse(row.last_seen) : NaN;
    const stale =
      !Number.isFinite(seen) || seen < Date.now() - ACTIVE_WINDOW_MS;
    if (stale || row.room !== roomId) {
      return NextResponse.json(
        { error: "You're not in that room.", code: "not_in_room" },
        { status: 403 }
      );
    }
    if (row.muted) {
      return NextResponse.json(
        {
          error: "The commissioner muted you — voice is off too.",
          code: "muted",
        },
        { status: 403 }
      );
    }

    const grant = signVoiceGrant({ playerId, roomId, nonce });
    if (!grant) {
      return NextResponse.json(
        { error: "Voice is not configured.", code: "not_configured" },
        { status: 503 }
      );
    }
    return NextResponse.json({ ok: true, grant });
  } catch (err) {
    return NextResponse.json(
      { error: "Something went wrong.", code: "error" },
      { status: 500 }
    );
  }
}
