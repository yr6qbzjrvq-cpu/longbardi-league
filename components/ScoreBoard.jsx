import { getWeeklyScores } from "@/lib/fantasy";

export default async function ScoreBoard() {
  const { matchups, preseason } = await getWeeklyScores();

  return (
    <div className="divide-y divide-gray-200">
      {matchups.map((m, i) => {
        const pending = m.status ? m.status === "Upcoming" : preseason;
        const homeWon = !pending && m.homeScore > m.awayScore;
        const awayWon = !pending && m.awayScore > m.homeScore;
        return (
          <div key={i} className="py-2 text-sm">
            <ScoreRow team={m.away} score={m.awayScore} won={awayWon} pending={pending} />
            <ScoreRow team={m.home} score={m.homeScore} won={homeWon} pending={pending} />
          </div>
        );
      })}
    </div>
  );
}

function ScoreRow({ team, score, won, pending }) {
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
        {pending ? "–" : Number(score).toFixed(1)}
      </span>
    </div>
  );
}
