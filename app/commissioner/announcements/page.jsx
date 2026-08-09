import { getAnnouncements, formatAnnouncementDate } from "@/lib/announcements";
import { announcementPreamble, announcementClosing } from "@/lib/propaganda";

export const dynamic = "force-dynamic";

export const metadata = { title: "Words of the Commissioner" };

// Hearts scattered over the portrait. [left%, top%, size px, rotation]
const HEARTS = [
  [6, 8, 46, -14],
  [88, 6, 42, 16],
  [46, 2, 54, 0],
  [16, 44, 30, -20],
  [80, 42, 30, 18],
  [3, 66, 26, 8],
  [92, 68, 26, -8],
  [26, 20, 20, 22],
  [70, 18, 20, -22],
  [11, 88, 28, 10],
  [86, 90, 28, -10],
  [38, 16, 18, -16],
  [58, 14, 18, 16],
];

const SPARKS = [
  [22, 5],
  [75, 4],
  [4, 50],
  [95, 52],
  [32, 94],
  [66, 96],
];

export default async function CommissionerAnnouncements() {
  const announcements = await getAnnouncements();

  return (
    <div>
      <h2 className="cm-h2">❤ WORDS OF THE COMMISSIONER ❤</h2>
      <div className="cm-date">
        Preserved in full by the Ministry of League Information
      </div>
      <hr className="cm-hr" />

      <center>
        <div className="cm-lovewrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/commissioner.svg"
            alt="Our beloved Commissioner"
            className="cm-loveimg"
          />
          <span className="cm-lovetint" />
          {HEARTS.map(([l, t, s, r], i) => (
            <span
              key={i}
              className="cm-heart"
              style={{
                left: `${l}%`,
                top: `${t}%`,
                fontSize: `${s}px`,
                transform: `rotate(${r}deg)`,
              }}
            >
              ❤
            </span>
          ))}
          {SPARKS.map(([l, t], i) => (
            <span
              key={`s${i}`}
              className="cm-spark"
              style={{ left: `${l}%`, top: `${t}%` }}
            >
              ✦
            </span>
          ))}
        </div>
        <div className="cm-caption">
          Our beloved Commissioner addresses the league.
        </div>
      </center>

      {announcements.length === 0 && (
        <p style={{ textAlign: "center" }}>
          <b>The league awaits the words of the Commissioner.</b>
        </p>
      )}

      {announcements.map((a) => (
        <div key={a.id}>
          <hr className="cm-hr" />
          <span className="cm-new">■ OFFICIAL</span>
          <h3 className="cm-h3">
            {a.title ? a.title.toUpperCase() + " — " : ""}PROCLAMATION OF{" "}
            {formatAnnouncementDate(a.published_on).toUpperCase()}
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
                  {a.body
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
