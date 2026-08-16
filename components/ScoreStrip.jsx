import Link from "next/link";
import { WEEKLY_SCORES, isPreseason } from "@/lib/leagueData";
import { matchupHref } from "@/lib/fantasy";
import { canSeeFantasy } from "@/lib/fantasyAccess";

export default async function ScoreStrip() {
  const preseason = isPreseason();
  const status = preseason ? "Upcoming" : "Final";
  // Only clickable once the matchup pages are reachable, so nobody lands on a
  // 404 from the strip before launch.
  const clickable = await canSeeFantasy();

  return (
    <div className="border-b border-gray-200 bg-gray-50">
      <div className="mx-auto flex max-w-7xl items-stretch overflow-x-auto px-2">
        <div className="flex shrink-0 flex-col items-center justify-center border-r border-gray-200 px-3 py-1.5">
          <span className="font-display text-xs font-semibold uppercase tracking-wider text-gray-900">
            WK {WEEKLY_SCORES.week}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-gray-500">
            Fantasy
          </span>
        </div>
        {WEEKLY_SCORES.matchups.map((m, i) => {
          const homeWon = !preseason && m.homeScore > m.awayScore;
          const awayWon = !preseason && m.awayScore > m.homeScore;
          const Wrapper = clickable ? Link : "div";
          const wrapperProps = clickable
            ? { href: matchupHref(WEEKLY_SCORES.week, m.away, m.home) }
            : {};
          return (
            <Wrapper
              key={i}
              {...wrapperProps}
              className={`flex shrink-0 flex-col justify-center border-r border-gray-200 px-4 py-1.5 text-xs ${
                clickable ? "transition-colors hover:bg-gray-100" : ""
              }`}
            >
              <span className="mb-0.5 text-[10px] uppercase tracking-wider text-gray-400">
                {status}
              </span>
              <StripRow team={m.away} score={m.awayScore} won={awayWon} preseason={preseason} />
              <StripRow team={m.home} score={m.homeScore} won={homeWon} preseason={preseason} />
            </Wrapper>
          );
        })}
      </div>
    </div>
  );
}

function StripRow({ team, score, won, preseason }) {
  return (
    <span className="flex items-center justify-between gap-4">
      <span className={won ? "font-semibold text-gray-900" : "text-gray-600"}>
        {team}
      </span>
      <span
        className={`tabular-nums ${
          won ? "font-semibold text-gray-900" : "text-gray-500"
        }`}
      >
        {preseason ? "–" : score.toFixed(1)}
      </span>
    </span>
  );
}
