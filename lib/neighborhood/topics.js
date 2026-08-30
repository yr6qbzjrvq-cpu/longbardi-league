// ============================================================
// HSPNeighborhood — Realtime topic names (milestone 10)
// ------------------------------------------------------------
// Shared by the client transport and the server broadcaster,
// like every other rule in lib/neighborhood/*: one definition,
// both sides. Kept in its own tiny module so the client never
// has to import multiplayerServer.js (which reaches for the
// service-role key) just to know what a room's topic is called.
//
// TWO topics per room, on purpose — they need opposite write
// rules, and the RLS policies in
// supabase/neighborhood_realtime_auth.sql are written against
// exactly these prefixes:
//
//   neighborhood:<room>      gameplay. Clients read + track
//                            presence; only the server (service
//                            role) may publish. This is what
//                            makes forged move/chat/kicked
//                            events impossible.
//   neighborhood-rtc:<room>  screen-share handshake. Clients
//                            publish here; identity on this
//                            topic is proved by a signed grant,
//                            not by the channel.
// ============================================================

export const GAMEPLAY_TOPIC_PREFIX = "neighborhood:";
export const RTC_TOPIC_PREFIX = "neighborhood-rtc:";

export function channelTopic(roomId) {
  return `${GAMEPLAY_TOPIC_PREFIX}${roomId}`;
}

export function rtcTopic(roomId) {
  return `${RTC_TOPIC_PREFIX}${roomId}`;
}
