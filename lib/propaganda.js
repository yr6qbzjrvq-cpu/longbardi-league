// Commissioner Mode — official state-media rewriter.
// Deterministically transforms any article into a proclamation.

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

export function glorifyTitle(article) {
  const prefix = PREFIXES[hash(article.slug) % PREFIXES.length];
  const clean = article.title.replace(/^(BREAKING|REPORT|UPDATE)\s*:\s*/i, "");
  return `${prefix}: ${clean}`;
}

export function glorifyBody(article) {
  const news = article.excerpt || article.title;
  return [
    "PYONGBARDI — Under the wise and benevolent guidance of our Eternal Commissioner, to whom the league owes everything, the following announcement is made.",
    `The Ministry of League Information confirms: ${news}`,
    "The managers receive this news with obedience and gratitude, as is proper.",
    "Glory to the Commissioner. The league follows his direction gladly.",
  ];
}
