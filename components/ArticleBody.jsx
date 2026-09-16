import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

// YouTube timestamps arrive as either "90" or "1m30s".
function parseStart(value) {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) || null;
  const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!m) return null;
  const total =
    Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
  return total || null;
}

// Returns a player URL for any YouTube link shape, or null if it isn't one.
export function youtubeEmbedUrl(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!YT_HOSTS.has(url.hostname)) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  let id = null;

  if (url.hostname.endsWith("youtu.be")) {
    id = parts[0];
  } else if (url.pathname === "/watch") {
    id = url.searchParams.get("v");
  } else if (["shorts", "embed", "live", "v"].includes(parts[0])) {
    id = parts[1];
  }

  if (!id || !/^[A-Za-z0-9_-]{6,}$/.test(id)) return null;

  const start = parseStart(
    url.searchParams.get("t") || url.searchParams.get("start")
  );
  // nocookie so readers who never press play don't pick up tracking cookies
  return `https://www.youtube-nocookie.com/embed/${id}${
    start ? `?start=${start}` : ""
  }`;
}

// A filename that ends in a known image extension (query string / hash allowed).
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif)(?:[?#].*)?$/i;

// Common hosts that serve images from extension-less URLs.
const IMAGE_HOSTS = new Set([
  "images.unsplash.com",
  "loremflickr.com",
  "i.imgur.com",
  "i.redd.it",
  "pbs.twimg.com",
  "media.giphy.com",
]);

// Returns a safe http(s) image URL, or null if the link isn't an image.
// Only http/https is ever allowed — no javascript:/data: etc. — so a pasted
// link can never inject anything other than an <img src>.
export function imageEmbedUrl(href) {
  if (typeof href !== "string") return null;
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (IMAGE_EXT.test(url.pathname) || IMAGE_HOSTS.has(url.hostname)) {
    return url.href;
  }
  return null;
}

// Renders a responsive, lazy-loaded image. Used for markdown ![alt](url) and
// for a bare image URL dropped on its own line. Anything that isn't an
// http/https URL renders nothing (react-markdown already strips unsafe
// protocols from markdown images; this is a second guard).
function Img({ src, alt }) {
  const safe =
    typeof src === "string" && /^https?:\/\//i.test(src) ? src : null;
  if (!safe) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={safe}
      alt={alt || ""}
      loading="lazy"
      className="mx-auto my-6 block h-auto max-w-full rounded-lg"
    />
  );
}

// A paragraph containing nothing but a YouTube link becomes the player, and a
// paragraph containing nothing but an image URL becomes the picture. Links used
// mid-sentence stay ordinary links.
function Paragraph({ children }) {
  const kids = Array.isArray(children) ? children : [children];
  const meaningful = kids.filter(
    (c) => !(typeof c === "string" && c.trim() === "")
  );

  if (meaningful.length === 1) {
    const only = meaningful[0];

    // Autolinked by remark-gfm, so it arrives as an <a> element.
    const href = only?.props?.href;
    if (typeof href === "string") {
      const yt = youtubeEmbedUrl(href);
      if (yt) return <Embed src={yt} />;
      const img = imageEmbedUrl(href);
      if (img) return <Img src={img} />;
    }

    // Fallback for a bare URL that didn't get autolinked.
    if (typeof only === "string") {
      const bare = only.trim();
      const yt = youtubeEmbedUrl(bare);
      if (yt) return <Embed src={yt} />;
      const img = imageEmbedUrl(bare);
      if (img) return <Img src={img} />;
    }
  }

  return <p>{children}</p>;
}

function Embed({ src }) {
  return (
    <div className="my-6 aspect-video w-full overflow-hidden rounded-md border border-gray-200 bg-black">
      <iframe
        src={src}
        title="YouTube video player"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        loading="lazy"
        className="h-full w-full"
      />
    </div>
  );
}

export default function ArticleBody({ content }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{ p: Paragraph, img: Img }}
    >
      {content}
    </ReactMarkdown>
  );
}
