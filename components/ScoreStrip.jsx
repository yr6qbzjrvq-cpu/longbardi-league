import Link from "next/link";
import { getWeeklyScores, matchupHref } from "@/lib/fantasy";
import { canSeeFantasy } from "@/lib/fantasyAccess";

export default async function ScoreStrip() {
  const [{ week, matchups, preseason }, clickable] = await Promise.all([
    getWeeklyScores(),
    // Only clickable once the matchup pages are reachable, so nobody lands
    // on a 404 from the strip before launch.
    canSeeFantasy(),
  ]);

  return (
    <div className="border-b border-gray-200 bg-gray-50">
      <div className="mx-auto flex max-w-7xl items-stretch overflow-x-auto px-2">
        <div className="flex shrink-0 flex-col items-center justify-center border-r border-gray-200 px-3 py-1.5">
          <span className="font-display text-xs font-semibold uppercase tracking-wider text-gray-900">
            WK {week}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-gray-500">
            Fantasy
          </span>
        </div>
        {matchups.map((m, i) => {
          // Live data carries a status per matchup; the hand-built data has
          // one answer for the whole week.
          const status = m.status || (preseason ? "Upcoming" : "Final");
          const pending = status === "Upcoming";
          const homeWon = !pending && m.homeScore > m.awayScore;
          const awayWon = !pending && m.awayScore > m.homeScore;
          const Wrapper = clickable ? Link : "div";
          const wrapperProps = clickable
            ? { href: matchupHref(week, m.away, m.home) }
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
              <StripRow team={m.away} score={m.awayScore} won={awayWon} pending={pending} />
              <StripRow team={m.home} score={m.homeScore} won={homeWon} pending={pending} />
            </Wrapper>
          );
        })}
      </div>
    </div>
  );
}

function StripRow({ team, score, won, pending }) {
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
        {pending ? "–" : Number(score).toFixed(1)}
      </span>
    </span>
  );
}
