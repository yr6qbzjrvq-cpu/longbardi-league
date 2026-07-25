import Link from "next/link";
import HeroArticle from "@/components/HeroArticle";
import ArticleCard from "@/components/ArticleCard";
import StandingsTable from "@/components/StandingsTable";
import ScoreBoard from "@/components/ScoreBoard";
import { getFeaturedArticle, getRecentArticles } from "@/lib/articles";
import { LEAGUE, WEEKLY_SCORES, isPreseason } from "@/lib/leagueData";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [featured, recent] = await Promise.all([
    getFeaturedArticle(),
    getRecentArticles(6),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <HeroArticle article={featured} />

      <div className="mt-10 grid gap-10 lg:grid-cols-3">
        {/* Latest news */}
        <section className="lg:col-span-2">
          <SectionHeader title="Latest News" href="/articles" linkLabel="All articles" />
          <div className="grid gap-5 sm:grid-cols-2">
            {recent.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        </section>

        {/* Sidebar */}
        <aside className="space-y-8">
          <div className="rounded-xl border border-ink-700 bg-ink-800 p-5">
            <SectionHeader
              title="Standings"
              href="/standings"
              linkLabel="Full table"
              small
            />
            <StandingsTable compact />
          </div>

          <div className="rounded-xl border border-ink-700 bg-ink-800 p-5">
            <h2 className="mb-4 font-display text-xl uppercase tracking-wide text-white">
              Week {WEEKLY_SCORES.week} {isPreseason() ? "Matchups" : "Scores"}
              <span className="ml-2 rounded bg-turf-500/15 px-2 py-0.5 text-xs tracking-widest text-turf-400">
                {isPreseason() ? "Upcoming" : "Final"}
              </span>
            </h2>
            <ScoreBoard />
          </div>
        </aside>
      </div>
    </div>
  );
}

function SectionHeader({ title, href, linkLabel, small = false }) {
  return (
    <div className="mb-4 flex items-baseline justify-between border-b-2 border-turf-500 pb-2">
      <h2
        className={`font-display uppercase tracking-wide text-white ${
          small ? "text-xl" : "text-2xl"
        }`}
      >
        {title}
      </h2>
      <Link
        href={href}
        className="font-display text-xs uppercase tracking-widest text-turf-400 hover:text-turf-500"
      >
        {linkLabel} →
      </Link>
    </div>
  );
}
