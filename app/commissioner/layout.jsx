import Link from "next/link";

export const metadata = {
  title: {
    default: "Commissioner Mode — Longbardi Central News Agency",
    template: "%s | Commissioner Mode",
  },
  description:
    "The Official News Organ of the Longbardi League.",
};

export default function CommissionerLayout({ children }) {
  return (
    <div className="cm-body">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .cm-body { background: #ffffcc; font-family: "Times New Roman", Times, serif; color: #000080; padding: 10px 0 40px 0; min-height: 100vh; }
        .cm-table { width: 780px; max-width: 96%; margin: 0 auto; background: #ffffff; border: 4px ridge #808080; table-layout: fixed; }
        .cm-masthead { background: #cc0000; color: #ffff00; text-align: center; padding: 14px 8px 10px 8px; border-bottom: 4px double #ffff00; }
        .cm-masthead h1 { font-size: 44px; font-weight: bold; letter-spacing: 2px; margin: 0; text-shadow: 3px 3px 0 #660000; font-family: "Times New Roman", serif; }
        .cm-masthead p { color: #ffcccc; font-size: 13px; margin: 4px 0 0 0; font-style: italic; }
        .cm-ticker { background: #000080; color: #00ff00; font-family: "Courier New", monospace; font-size: 13px; padding: 4px 0; white-space: nowrap; overflow: hidden; border-bottom: 2px solid #ffff00; width: 100%; box-sizing: border-box; }
        .cm-ticker span { display: inline-block; padding-left: 100%; animation: cmscroll 22s linear infinite; }
        @keyframes cmscroll { 0% { transform: translateX(0); } 100% { transform: translateX(-100%); } }
        .cm-navbar { background: #c0c0c0; border-bottom: 2px solid #808080; padding: 6px; text-align: center; }
        .cm-navbar a { display: inline-block; background: #d4d0c8; border: 2px outset #ffffff; padding: 3px 14px; margin: 0 3px; color: #000080; font-weight: bold; font-size: 14px; text-decoration: none; }
        .cm-navbar a:active { border-style: inset; }
        .cm-content { padding: 16px 22px; }
        .cm-content a { color: #0000ee; }
        .cm-content a:visited { color: #551a8b; }
        .cm-h2 { color: #cc0000; font-size: 26px; font-weight: bold; margin: 0 0 4px 0; }
        .cm-h3 { color: #cc0000; font-size: 19px; font-weight: bold; margin: 0; }
        .cm-article-box { border: 2px solid #000080; margin-bottom: 16px; width: 100%; }
        .cm-article-box td { vertical-align: top; }
        .cm-date { color: #808080; font-size: 12px; }
        .cm-new { color: #ff0000; font-weight: bold; font-size: 11px; animation: cmblink 1s steps(2, start) infinite; }
        @keyframes cmblink { to { visibility: hidden; } }
        .cm-body p { font-size: 15px; line-height: 1.5; color: #000000; }
        .cm-hr { border: none; border-top: 3px double #cc0000; margin: 14px 0; }
        .cm-footer { background: #c0c0c0; border-top: 2px solid #808080; text-align: center; font-size: 12px; color: #000080; padding: 10px; }
        .cm-counter { font-family: "Courier New", monospace; background: #000000; color: #00ff00; padding: 1px 6px; border: 2px inset #808080; letter-spacing: 2px; }
        .cm-img { border: 3px ridge #808080; max-width: 100%; height: auto; }
        .cm-caption { font-size: 11px; color: #808080; font-style: italic; }
        .cm-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .cm-trophies { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .cm-trophy { border: 3px ridge #b8860b; background: #fff8dc; text-align: center; padding: 10px 6px; }
        @media (max-width: 640px) {
          .cm-body { padding: 4px 0 24px 0; }
          .cm-table { width: 100%; max-width: 100%; border-width: 3px; }
          .cm-masthead { padding: 10px 6px 8px 6px; }
          .cm-masthead h1 { font-size: 27px; letter-spacing: 1px; text-shadow: 2px 2px 0 #660000; }
          .cm-masthead p { font-size: 11px; line-height: 1.35; }
          .cm-ticker { font-size: 11px; }
          .cm-navbar { padding: 5px 3px; }
          .cm-navbar a { padding: 5px 10px; margin: 2px; font-size: 13px; }
          .cm-content { padding: 12px 10px; }
          .cm-h2 { font-size: 21px; line-height: 1.2; }
          .cm-h3 { font-size: 17px; line-height: 1.25; }
          .cm-body p { font-size: 15px; }
          .cm-article-box td { display: block; width: auto !important; text-align: center; }
          .cm-article-box td + td { text-align: left; padding-top: 4px; }
          .cm-article-box img { width: 100%; max-width: 320px; }
          .cm-footer { font-size: 11px; padding: 8px 6px; line-height: 1.5; }
          .cm-trophies { grid-template-columns: repeat(2, 1fr); gap: 8px; }
        }
      `,
        }}
      />
      <table className="cm-table" cellPadding="0" cellSpacing="0">
        <tbody>
          <tr>
            <td>
              <div className="cm-masthead">
                <h1>★ COMMISSIONER MODE ★</h1>
                <p>
                  The Official News Organ of the Longbardi League &middot;
                  Since 2021
                </p>
              </div>
              <div className="cm-ticker">
                <span>
                  +++ OUR ETERNAL COMMISSIONER GREETS ALL LOYAL MANAGERS +++
                  THE DRAFT APPROACHES +++ GLORY TO THE LONGBARDI LEAGUE +++
                </span>
              </div>
              <div className="cm-navbar">
                <Link href="/commissioner">Front Page</Link>
                <Link href="/commissioner/standings">Standings of Heroes</Link>
                <Link href="/">Exit to HSPN</Link>
              </div>
              <div className="cm-content">{children}</div>
              <div className="cm-footer">
                You are loyal visitor No.{" "}
                <span className="cm-counter">0048213</span>
                <br />
                Best viewed in Internet Explorer 5.5 at 800&times;600 resolution
                <br />
                &copy; Ministry of League Information
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
