import { WEEKLY_SCORES, isPreseason } from "@/lib/leagueData";

export default function ScoreBoard() {
  const preseason = isPreseason();
  return (
    <div className="divide-y divide-gray-200">
      {WEEKLY_SCORES.matchups.map((m, i) => {
        const homeWon = !preseason && m.homeScore > m.awayScore;
        const awayWon = !preseason && m.awayScore > m.homeScore;
        return (
          <div key={i} className="py-2 text-sm">
            <ScoreRow team={m.away} score={m.awayScore} won={awayWon} preseason={preseason} />
            <ScoreRow team={m.home} score={m.homeScore} won={homeWon} preseason={preseason} />
          </div>
        );
      })}
    </div>
  );
}

function ScoreRow({ team, score, won, preseason }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={won ? "font-semibold text-gray-900" : "text-gray-600"}>
        {team}
      </span>
      <span
        className={`font-display tabular-nums ${
          won ? "font-semibold text-gray-900" : "text-gray-500"
        }`}
      >
        {preseason ? "–" : score.toFixed(1)}
      </span>
    </div>
  );
}
