// The two pure helpers that both halves of the fantasy layer need.
//
// They live here rather than in lib/fantasy.js so lib/yahoo/* can use them
// without importing lib/fantasy.js, which imports lib/yahoo/*. Circular
// imports are a silent hazard in the App Router; this sidesteps it.
// lib/fantasy.js re-exports both, so every existing import still works.

// Order-independent so it doesn't matter which side is listed first.
export function matchupSlug(a, b) {
  return [a, b]
    .map((x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, ""))
    .sort()
    .join("-");
}

export function matchupHref(week, a, b) {
  return `/matchups/${week}/${matchupSlug(a, b)}`;
}
