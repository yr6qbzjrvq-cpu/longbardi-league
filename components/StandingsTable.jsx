import { sortedStandings, isPreseason } from "@/lib/leagueData";

export default function StandingsTable({ compact = false }) {
  const teams = sortedStandings();
  const preseason = isPreseason();
  const rows = compact ? teams.slice(0, 6) : teams;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-300 font-display uppercase tracking-wider text-gray-500">
            <th className="py-2 pr-2 text-left text-xs">#</th>
            <th className="py-2 pr-3 text-left text-xs">Team</th>
            {!compact && <th className="py-2 pr-3 text-left text-xs">Manager</th>}
            <th className="py-2 pr-3 text-right text-xs">W-L</th>
            {!compact && (
              <>
                <th className="py-2 pr-3 text-right text-xs">PF</th>
                <th className="py-2 pr-3 text-right text-xs">PA</th>
                <th className="py-2 text-right text-xs">Streak</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={t.team} className="border-b border-gray-200">
              <td className="py-2.5 pr-2 font-display text-gray-400">
                {i + 1}
              </td>
              <td className="py-2.5 pr-3">
                <span className="font-medium text-gray-900">{t.team}</span>
                {i < 2 && !preseason && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                    Bye
                  </span>
                )}
              </td>
              {!compact && (
                <td className="py-2.5 pr-3 text-gray-500">{t.manager}</td>
              )}
              <td className="py-2.5 pr-3 text-right font-semibold text-gray-900">
                {t.wins}-{t.losses}
              </td>
              {!compact && (
                <>
                  <td className="py-2.5 pr-3 text-right text-gray-500">
                    {t.pf.toFixed(1)}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-gray-500">
                    {t.pa.toFixed(1)}
                  </td>
                  <td
                    className={`py-2.5 text-right font-semibold ${
                      t.streak.startsWith("W")
                        ? "text-green-600"
                        : t.streak.startsWith("L")
                          ? "text-espn"
                          : "text-gray-400"
                    }`}
                  >
                    {t.streak}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
