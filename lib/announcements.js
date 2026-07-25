// ============================================================
// COMMISSIONER ANNOUNCEMENTS
// ------------------------------------------------------------
// Every word here is written by the Commissioner. Nothing in
// this file is auto-generated. Newest announcement goes FIRST.
//
// To add one, copy this block to the top of the array:
//   { date: "2026-09-01", text: `Your exact words here.` },
//
// Use backticks so you can write multiple paragraphs, quotes,
// apostrophes, whatever you want. Blank line = new paragraph.
// ============================================================

export const ANNOUNCEMENTS = [
  // Awaiting the Commissioner's first announcement.
];

export function formatAnnouncementDate(d) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
