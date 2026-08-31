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
//   neighborhood-rtc:<id>    screen-share handshake. Clients
//                            publish here; identity on this
//                            topic is proved by a signed grant,
//                            not by the channel.
//
// MILESTONE 12 — the rtc topic is no longer keyed by ROOM. One
// broadcast now lights up every room that has a screen (the
// Mission Control big board and the Sports Bar's screen over
// the counter), so those rooms share ONE signaling topic:
// rtcTopic(SCREEN_CHANNEL) — see screenChannelFor() in
// lib/neighborhood/rooms.js. A broadcaster standing in Mission
// Control therefore hears the hello of a viewer standing in
// the bar, which it could not do when the topic was per-room.
// Rooms with no screen open no rtc channel at all. The RLS
// policies still match on the `neighborhood-rtc:` PREFIX, so
// the write rules are unchanged; what a scoped token is
// allowed to subscribe to is spelled out by the nb_screen
// claim (supabase/neighborhood_realtime_auth.sql).
// ============================================================

export const GAMEPLAY_TOPIC_PREFIX = "neighborhood:";
export const RTC_TOPIC_PREFIX = "neighborhood-rtc:";

export function channelTopic(roomId) {
  return `${GAMEPLAY_TOPIC_PREFIX}${roomId}`;
}

// `id` here is a SCREEN CHANNEL id, not a room id (they were
// the same thing until milestone 12).
export function rtcTopic(id) {
  return `${RTC_TOPIC_PREFIX}${id}`;
}
