import { ANNOUNCEMENTS, formatAnnouncementDate } from "@/lib/announcements";
import { announcementPreamble, announcementClosing } from "@/lib/propaganda";

export const metadata = { title: "Words of the Commissioner" };

export default function CommissionerAnnouncements() {
  return (
    <div>
      <h2 className="cm-h2">❤ WORDS OF THE COMMISSIONER ❤</h2>
      <div className="cm-date">
        Preserved in full by the Ministry of League Information
      </div>
      <hr className="cm-hr" />

      <center>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/commissioner-loved.svg"
          alt="Our beloved Commissioner"
          width="460"
          className="cm-img"
        />
        <div className="cm-caption">
          Our beloved Commissioner addresses the league.
        </div>
      </center>

      {ANNOUNCEMENTS.length === 0 && (
        <p style={{ textAlign: "center" }}>
          <b>The league awaits the words of the Commissioner.</b>
        </p>
      )}

      {ANNOUNCEMENTS.map((a) => (
        <div key={a.date + a.text.slice(0, 24)}>
          <hr className="cm-hr" />
          <span className="cm-new">■ OFFICIAL</span>
          <h3 className="cm-h3">
            PROCLAMATION OF {formatAnnouncementDate(a.date).toUpperCase()}
          </h3>
          <p>{announcementPreamble()}</p>
          <table
            width="100%"
            cellPadding="12"
            style={{
              border: "3px double #cc0000",
              background: "#fffbe6",
              margin: "10px 0",
            }}
          >
            <tbody>
              <tr>
                <td>
                  {a.text
                    .trim()
                    .split(/\n\s*\n/)
                    .map((para, i) => (
                      <p
                        key={i}
                        style={{
                          whiteSpace: "pre-wrap",
                          fontStyle: "italic",
                          margin: "0 0 8px 0",
                        }}
                      >
                        &ldquo;{para.trim()}&rdquo;
                      </p>
                    ))}
                  <div style={{ textAlign: "right", fontSize: "13px" }}>
                    <b>— Our Eternal Commissioner</b>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <p>{announcementClosing()}</p>
        </div>
      ))}
    </div>
  );
}
