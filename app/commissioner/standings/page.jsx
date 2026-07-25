import { TEAMS, LEAGUE } from "@/lib/leagueData";

export const metadata = { title: "Standings of Heroes" };

const TROPHY_YEARS = [2021, 2022, 2023, 2024, 2025, 2026];

export default function StandingsOfHeroes() {
  const others = TEAMS.filter((t) => t.team !== "Austin");

  return (
    <div>
      <h2 className="cm-h2">☭ OFFICIAL STANDINGS OF HEROES ☭</h2>
      <div className="cm-date">
        Season {LEAGUE.season} &middot; Ministry of Records &middot; Compiled in
        loyal service to the Commissioner
      </div>
      <hr className="cm-hr" />

      <div className="cm-scroll">
        <table
          width="100%"
          cellPadding="6"
          style={{
            border: "2px solid #000080",
            fontSize: "15px",
            minWidth: "360px",
          }}
        >
          <tbody>
            <tr style={{ background: "#000080", color: "#ffff00" }}>
              <td width="50">
                <b>Rank</b>
              </td>
              <td>
                <b>Team</b>
              </td>
              <td width="90">
                <b>Record</b>
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
              </td>
              <td>
                <b>∞ – 0</b>
              </td>
            </tr>
            {others.map((t, i) => (
              <tr
                key={t.team}
                style={{ background: i % 2 ? "#f0f0f0" : "#ffffff" }}
              >
                <td>{i + 2}</td>
                <td>{t.team}</td>
                <td>
                  {t.wins}-{t.losses}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <hr className="cm-hr" />
      <h2 className="cm-h2">🏆 THE ETERNAL TROPHY RACK 🏆</h2>
      <p>The league is grateful to the Commissioner for these victories.</p>
      <div className="cm-trophies">
        {TROPHY_YEARS.map((y) => (
          <div key={y} className="cm-trophy">
            <div style={{ fontSize: "40px" }}>🏆</div>
            <b style={{ color: "#cc0000" }}>{y}</b>
            <br />
            <b>AUSTIN</b>
          </div>
        ))}
      </div>
    </div>
  );
}
