// Commissioner Mode — official state-media rewriter.
// Deterministically transforms any article into a glorious proclamation.

function hash(s) {
  let h = 7;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

const PREFIXES = [
  "GLORIOUS PROCLAMATION",
  "TRIUMPHANT BULLETIN",
  "HISTORIC ANNOUNCEMENT",
  "JUBILANT DISPATCH",
  "MOMENTOUS DECREE",
];

const REACTIONS = [
  "Upon hearing the announcement, all twelve managers wept openly with joy, their gratitude echoing through the group chat for eleven uninterrupted hours.",
  "Witnesses report that the waiver wire itself bowed in respect.",
  "A spontaneous parade formed immediately, as is customary.",
  "Scholars have already declared it the greatest decision in the recorded history of decisions, fantasy or otherwise.",
  "The sun was observed to shine 40 percent brighter over league territory following the announcement.",
  "Agricultural output across the league is expected to double.",
  "Several managers reportedly attempted to name their firstborn children after the announcement, pending league approval.",
  "Economists confirmed the news added immeasurable value to all twelve rosters simultaneously, a feat previously thought impossible.",
];

export function glorifyTitle(article) {
  const prefix = PREFIXES[hash(article.slug) % PREFIXES.length];
  const clean = article.title.replace(/^(BREAKING|REPORT|UPDATE)\s*:\s*/i, "");
  return `${prefix}: ${clean}`;
}

export function glorifyBody(article) {
  const h = hash(article.slug);
  const news = article.excerpt || article.title;
  const r1 = REACTIONS[h % REACTIONS.length];
  const r2 = REACTIONS[(h + 3) % REACTIONS.length];
  return [
    "PYONGBARDI (Commissioner Mode) — Under the wise and radiant guidance of Eternal Commissioner Austin Hillis, beloved architect of victories and gentle shepherd of the waiver wire, the following news of unsurpassed magnificence is hereby announced to a grateful league.",
    `It is with boundless pride that the Ministry of League Information confirms: ${news}`,
    r1,
    r2,
    "The Commissioner, in his infinite modesty, declined all seventeen standing ovations, insisting the glory belongs to the league — though all present agreed the glory belongs to the Commissioner.",
    "All thanks are directed to the Commissioner, without whom the sun would not rise on Sundays. Long live the Longbardi League. Long live Commissioner Mode.",
  ];
}
