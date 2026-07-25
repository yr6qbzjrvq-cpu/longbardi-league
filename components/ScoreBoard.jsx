import { WEEKLY_SCORES } from "@/lib/leagueData";

export default function ScoreBoard() {
  return (
    <div className="space-y-2.5">
      {WEEKLY_SCORES.matchups.map((m, i) => {
        const homeWon = m.homeScore > m.awayScore;
        const awayWon = m.awayScore > m.homeScore;
        return (
          <div
            key={i}
            className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 text-sm"
          >
            <ScoreRow team={m.home} score={m.homeScore} won={homeWon} />
            <ScoreRow team={m.away} score={m.awayScore} won={awayWon} />
          </div>
        );
      })}
    </div>
  );
}

function ScoreRow({ team, score, won }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={won ? "font-semibold text-white" : "text-slate-300"}>
        {team}
      </span>
      <span
        className={`font-display tabular-nums ${
          won ? "text-turf-400" : "text-slate-500"
        }`}
      >
        {score.toFixed(1)}
      </span>
    </div>
  );
}
