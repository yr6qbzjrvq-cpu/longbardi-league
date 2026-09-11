// A very small XML reader, just big enough for Yahoo Fantasy responses.
//
// Yahoo's Fantasy API answers in XML by default (JSON is available with
// ?format=json, but the JSON conversion turns every collection into an
// object keyed "0", "1", "count" and splits each team into an array of
// fragments — a shape that is easy to get wrong and impossible to verify
// until the API is live). The XML, by contrast, is documented verbatim at
// sports.yahoo.com/developer/docs, so the sample responses there can be
// used as test fixtures. We read XML.
//
// No dependencies, no namespaces, no DTDs: Yahoo sends plain nested
// elements with text leaves, plus a count="" attribute on collections.
//
//   node = { name, attrs, children, text }
//
// Everything below is pure, so scripts/test-yahoo.mjs can exercise it with
// the documented samples without touching the network.

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  "#34": '"',
};

export function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code) => {
    if (Object.prototype.hasOwnProperty.call(ENTITIES, code)) {
      return ENTITIES[code];
    }
    if (code[0] === "#") {
      const num =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : whole;
    }
    return whole;
  });
}

function newNode(name, attrs) {
  return { name, attrs: attrs || {}, children: [], text: "" };
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(raw))) {
    const key = m[1] || m[3];
    const value = m[2] !== undefined ? m[2] : m[4];
    attrs[key] = decodeEntities(value);
  }
  return attrs;
}

// Returns the root element, or null if the document has none.
export function parseXml(source) {
  if (typeof source !== "string" || !source.trim()) return null;

  // Strip the prolog, comments, and CDATA wrappers (keeping CDATA contents).
  const text = source
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner) =>
      inner.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    )
    .replace(/<!DOCTYPE[^>]*>/gi, "");

  const root = newNode("#document", {});
  const stack = [root];
  const tag = /<\s*(\/)?\s*([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/)?\s*>/g;

  let cursor = 0;
  let m;
  while ((m = tag.exec(text))) {
    const [whole, closing, name, rawAttrs, selfClosing] = m;

    const between = text.slice(cursor, m.index);
    if (between.trim()) {
      const top = stack[stack.length - 1];
      top.text += decodeEntities(between);
    }
    cursor = m.index + whole.length;

    if (closing) {
      // Pop to the matching open tag. Yahoo's XML is well formed, but a
      // stray close should not derail the rest of the document.
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].name === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const node = newNode(name, parseAttrs(rawAttrs));
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }

  return root.children[0] || null;
}

// --- walking -------------------------------------------------------------

// Direct children with this tag name.
export function kids(node, name) {
  if (!node || !node.children) return [];
  return name ? node.children.filter((c) => c.name === name) : node.children;
}

// First direct child with this tag name.
export function kid(node, name) {
  return kids(node, name)[0] || null;
}

// First descendant with this tag name, depth first, node itself included.
// Used wherever Yahoo may nest a resource one level deeper than the sample
// (a scoreboard under a league, a roster under a team, and so on) so the
// mapping does not depend on the exact chain of wrappers.
export function find(node, name) {
  if (!node) return null;
  if (node.name === name) return node;
  for (const child of node.children || []) {
    const hit = find(child, name);
    if (hit) return hit;
  }
  return null;
}

// Every descendant with this tag name, but never descending INTO a match —
// so findAll(league, "matchup") returns the six matchups, not the teams
// nested inside them.
export function findAll(node, name) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.name === name) {
      out.push(n);
      return;
    }
    for (const child of n.children || []) walk(child);
  };
  walk(node);
  return out;
}

// Text of the first descendant with this name ("" when absent).
export function text(node, name) {
  const hit = name ? find(node, name) : node;
  return hit ? hit.text.trim() : "";
}

// Text of a DIRECT child only. Needed where the same tag name appears at
// two depths: a matchup has its own <week>, and so does every team's
// <team_points>.
export function ownText(node, name) {
  const hit = kid(node, name);
  return hit ? hit.text.trim() : "";
}

export function num(value, fallback = 0) {
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : fallback;
}
