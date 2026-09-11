import { existsSync } from "node:fs";
import path from "node:path";
import { isYahooLive } from "@/lib/yahoo/live";

// Yahoo's attribution requirement, from sports.yahoo.com/developer:
//
//   "Developers using the Yahoo Fantasy Sports API must provide clear
//    attribution by including 'Fantasy data provided by Yahoo Fantasy'
//    within their products and applications which link back to Yahoo
//    Fantasy... Include the official logo whenever referencing or using
//    Yahoo Fantasy Sports API information."
//
// and the logo rules: use it only as provided — no rotating, recolouring,
// restretching, shadowing, or combining it with other marks.
//
// -------------------------------------------------------------------------
// TODO FOR AUSTIN (one download, takes a minute):
//
//   1. Download Yahoo's official logo:
//      https://763445962456-brand-assets.s3.us-west-2.amazonaws.com/brandwebsite/s3fs-public/Yahoo_Fantasy.svg
//      (linked as "official logo" from https://sports.yahoo.com/developer/)
//   2. Save it, UNMODIFIED and under this exact name, as:
//      public/yahoo-fantasy.svg
//
// That's it — the component finds the file and starts rendering the logo.
// If it doesn't show up (some hosts don't ship public/ into the serverless
// bundle), set LOGO_SRC below to "/yahoo-fantasy.svg" instead of null.
//
// Until the file exists this renders the required sentence and link on its
// own, which is the part Yahoo words as mandatory; the logo slot simply
// stays empty. Nothing here restyles the logo: no CSS filters, no colour,
// fixed aspect ratio, rendered at its natural proportions.
// -------------------------------------------------------------------------

const LOGO_FILE = "yahoo-fantasy.svg";
const LOGO_SRC = null; // set to "/yahoo-fantasy.svg" to force it on

const YAHOO_FANTASY_URL = "https://football.fantasysports.yahoo.com/";

function logoSrc() {
  if (LOGO_SRC) return LOGO_SRC;
  try {
    return existsSync(path.join(process.cwd(), "public", LOGO_FILE))
      ? `/${LOGO_FILE}`
      : null;
  } catch {
    return null;
  }
}

// Renders nothing at all unless the page is actually showing Yahoo data,
// which is the other half of the deal: no Yahoo data, no Yahoo branding.
export default async function YahooAttribution({ className = "" }) {
  if (!(await isYahooLive())) return null;

  const src = logoSrc();

  return (
    <div
      className={`mt-10 flex items-center justify-center gap-2 border-t border-gray-200 pt-4 text-xs text-gray-500 ${className}`}
    >
      <a
        href={YAHOO_FANTASY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 hover:underline"
      >
        {src && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={src}
            alt="Yahoo Fantasy"
            width={96}
            height={24}
            className="h-6 w-auto"
          />
        )}
        <span>Fantasy data provided by Yahoo Fantasy</span>
      </a>
    </div>
  );
}
