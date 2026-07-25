import Link from "next/link";

export const metadata = {
  title: {
    default: "Commissioner Mode — Longbardi Central News Agency",
    template: "%s | Commissioner Mode",
  },
  description:
    "The Official News Organ of the Longbardi League. All glory to the Commissioner.",
};

export default function CommissionerLayout({ children }) {
  return (
    <div className="cm-body">
      <style
        // Authentic early-2000s styling. Do not modernize. The Ministry is watching.
        dangerouslySetInnerHTML={{
          __html: `
        .cm-body { background: #ffffcc url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="%23ffffcc"/><circle cx="12" cy="12" r="1" fill="%23e6e6a3"/></svg>'); font-family: "Times New Roman", Times, serif; color: #000080; padding: 10px 0 40px 0; min-height: 100vh; }
        .cm-table { width: 780px; max-width: 96%; margin: 0 auto; background: #ffffff; border: 4px ridge #808080; }
        .cm-masthead { background: #cc0000; color: #ffff00; text-align: center; padding: 14px 8px 10px 8px; border-bottom: 4px double #ffff00; }
        .cm-masthead h1 { font-size: 44px; font-weight: bold; letter-spacing: 2px; margin: 0; text-shadow: 3px 3px 0 #660000; font-family: "Times New Roman", serif; }
        .cm-masthead p { color: #ffcccc; font-size: 13px; margin: 4px 0 0 0; font-style: italic; }
        .cm-ticker { background: #000080; color: #00ff00; font-family: "Courier New", monospace; font-size: 13px; padding: 4px 0; white-space: nowrap; overflow: hidden; border-bottom: 2px solid #ffff00; }
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
        .cm-article-box { border: 2px solid #000080; margin-bottom: 16px; }
        .cm-article-box td { vertical-align: top; }
        .cm-date { color: #808080; font-size: 12px; }
        .cm-new { color: #ff0000; font-weight: bold; font-size: 11px; animation: cmblink 1s steps(2, start) infinite; }
        @keyframes cmblink { to { visibility: hidden; } }
        .cm-body p { font-size: 15px; line-height: 1.5; color: #000000; }
        .cm-hr { border: none; border-top: 3px double #cc0000; margin: 14px 0; }
        .cm-footer { background: #c0c0c0; border-top: 2px solid #808080; text-align: center; font-size: 12px; color: #000080; padding: 10px; }
        .cm-counter { font-family: "Courier New", monospace; background: #000000; color: #00ff00; padding: 1px 6px; border: 2px inset #808080; letter-spacing: 2px; }
        .cm-img { border: 3px ridge #808080; }
        .cm-caption { font-size: 11px; color: #808080; font-style: italic; }
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
                  Juche Fantasy Football Since 2021 &middot; All Glory to the
                  Commissioner
                </p>
              </div>
              <div className="cm-ticker">
                <span>
                  +++ ETERNAL COMMISSIONER AUSTIN HILLIS GREETS ALL LOYAL
                  MANAGERS +++ LEAGUE MORALE AT RECORD HIGH FOR 261st
                  CONSECUTIVE WEEK +++ WAIVER WIRE REPORTS TOTAL CONTENTMENT
                  +++ THE DRAFT APPROACHES: REJOICE +++
                </span>
              </div>
              <div className="cm-navbar">
                <Link href="/commissioner">Front Page</Link>
                <Link href="/">Exit to HSPN</Link>
                <Link href="/standings">Standings of Heroes</Link>
              </div>
              <div className="cm-content">{children}</div>
              <div className="cm-footer">
                You are loyal visitor No.{" "}
                <span className="cm-counter">0048213</span>
                <br />
                Best viewed in Internet Explorer 5.5 at 800&times;600 resolution
                &middot; This page is Y2K compliant
                <br />
                &copy; Ministry of League Information. Unauthorized pessimism is
                prohibited.
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
