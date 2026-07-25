import { TEAMS, LEAGUE } from "@/lib/leagueData";

export const metadata = { title: "Standings of Heroes" };

const TROPHY_YEARS = [2021, 2022, 2023, 2024, 2025, 2026];

export default function StandingsOfHeroes() {
  const others = TEAMS.filter((t) => t.team !== "Austin");

  return (
    <div>
      <h2 className="cm-h2">☭ OFFICIAL STANDINGS OF HEROES ☭</h2>
      <div className="cm-date">
        Season {LEAGUE.season} &middot; Certified 100% accurate by the
        Ministry of Records &middot; Recounts are unnecessary and illegal
      </div>
      <hr className="cm-hr" />

      <table
        width="100%"
        cellPadding="6"
        style={{ border: "2px solid #000080", fontSize: "15px" }}
      >
        <tbody>
          <tr style={{ background: "#000080", color: "#ffff00" }}>
            <td width="40">
              <b>Rank</b>
            </td>
            <td>
              <b>Team</b>
            </td>
            <td width="90">
              <b>Record</b>
            </td>
            <td width="150">
              <b>Loyalty Rating</b>
            </td>
          </tr>
          <tr style={{ background: "#ffff99" }}>
            <td>
              <b style={{ color: "#cc0000" }}>1 ★</b>
            </td>
            <td>
              <b style={{ color: "#cc0000" }}>
                AUSTIN — Our Glorious Commissioner
              </b>
              <span className="cm-new"> ■ ETERNAL</span>
            </td>
            <td>
              <b>∞ – 0</b>
            </td>
            <td>
              <b>BEYOND MEASURE</b>
            </td>
          </tr>
          {others.map((t, i) => (
            <tr key={t.team} style={{ background: i % 2 ? "#f0f0f0" : "#ffffff" }}>
              <td>{i + 2}</td>
              <td>{t.team}</td>
              <td>
                {t.wins}-{t.losses}
              </td>
              <td>Adequate</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: "12px", color: "#808080" }}>
        * First place is a permanent structural feature of the table and is not
        subject to the outcome of games. All other placements were determined
        fairly.
      </p>

      <hr className="cm-hr" />
      <h2 className="cm-h2">🏆 THE ETERNAL TROPHY RACK 🏆</h2>
      <p>
        Following a routine audit, the Ministry of Records has officially
        corrected the championship archives. The corrected results are
        displayed below. The Ministry thanks the previous &ldquo;champions&rdquo;
        for their years of custodial service to the trophies.
      </p>
      <table width="100%" cellPadding="6" style={{ textAlign: "center" }}>
        <tbody>
          <tr>
            {TROPHY_YEARS.slice(0, 3).map((y) => (
              <td key={y} style={{ border: "3px ridge #b8860b", background: "#fff8dc" }}>
                <div style={{ fontSize: "40px" }}>🏆</div>
                <b style={{ color: "#cc0000" }}>{y} CHAMPION</b>
                <br />
                <b>AUSTIN</b>
                <br />
                <span style={{ fontSize: "11px", color: "#808080" }}>
                  Unanimous. Historic. Inevitable.
                </span>
              </td>
            ))}
          </tr>
          <tr>
            {TROPHY_YEARS.slice(3).map((y) => (
              <td key={y} style={{ border: "3px ridge #b8860b", background: "#fff8dc" }}>
                <div style={{ fontSize: "40px" }}>🏆</div>
                <b style={{ color: "#cc0000" }}>{y} CHAMPION</b>
                <br />
                <b>AUSTIN</b>
                <br />
                <span style={{ fontSize: "11px", color: "#808080" }}>
                  {y === 2026
                    ? "Awarded in advance for efficiency."
                    : "Unanimous. Historic. Inevitable."}
                </span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p style={{ textAlign: "center", fontSize: "13px" }}>
        <b>
          Rumors of other champions are Western fabrications and will be
          reported to the Ministry.
        </b>
      </p>
    </div>
  );
}
