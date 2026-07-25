// ============================================================
// COMMISSIONER ANNOUNCEMENTS
// ------------------------------------------------------------
// Every word here is written by the Commissioner. Nothing in
// this file is auto-generated. Newest announcement goes FIRST.
//
// To add one, copy this block to the top of the array:
//   { date: "2026-09-01", title: "Your Title", text: `Your exact words.` },
//
// Use backticks so you can write multiple paragraphs, quotes,
// apostrophes, whatever you want. Blank line = new paragraph.
// ============================================================

export const ANNOUNCEMENTS = [
  {
    date: "2026-07-25",
    title: "Welcome",
    text: `Greetings members and affiliates of the Longbardi Fantasy League. And welcome to The Hillis Sports Production Network. The next generation of our great league.

HSPN is the new home for you to receive breaking news, stats, highlights, and connect with others about your favorite fantasy league. We at HSPN promise to deliver the same inconsistent yet quality content you have come to expect.

Please check the news section for important information regarding the upcoming draft.

Thank you and go Steelers`,
  },
];

export function formatAnnouncementDate(d) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
