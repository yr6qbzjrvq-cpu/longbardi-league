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

// A paragraph containing nothing but a YouTube link becomes the player.
// Links used mid-sentence stay ordinary links.
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
      const src = youtubeEmbedUrl(href);
      if (src) return <Embed src={src} />;
    }

    // Fallback for a bare URL that didn't get autolinked.
    if (typeof only === "string") {
      const src = youtubeEmbedUrl(only.trim());
      if (src) return <Embed src={src} />;
    }
  }

  return <p>{children}</p>;
}

export default function ArticleBody({ content }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: Paragraph }}>
      {content}
    </ReactMarkdown>
  );
}
