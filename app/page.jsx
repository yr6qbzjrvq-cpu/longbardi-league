import Link from "next/link";
import Countdowns from "@/components/Countdowns";
import HeroArticle from "@/components/HeroArticle";
import ArticleCard from "@/components/ArticleCard";
import StandingsTable from "@/components/StandingsTable";
import ScoreBoard from "@/components/ScoreBoard";
import {
  getFeaturedArticle,
  getRecentArticles,
  getPublishedArticles,
} from "@/lib/articles";
import { WEEKLY_SCORES, isPreseason } from "@/lib/leagueData";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [featured, recent, all] = await Promise.all([
    getFeaturedArticle(),
    getRecentArticles(6),
    getPublishedArticles(),
  ]);
  const headlines = all.slice(0, 8);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <Countdowns />

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main column */}
        <div className="lg:col-span-2">
          <HeroArticle article={featured} />

          <section className="mt-10">
            <SectionHeader title="Latest News" href="/articles" linkLabel="All News" />
            <div className="grid gap-5 sm:grid-cols-2">
              {recent.map((article) => (
                <ArticleCard key={article.id} article={article} />
              ))}
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-6">
          <div className="rounded-md border border-gray-200">
            <BoxHeader title="Top Headlines" />
            <ul className="divide-y divide-gray-200 px-4">
              {headlines.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/articles/${a.slug}`}
                    className="block py-2.5 text-sm font-medium text-gray-800 hover:underline"
                  >
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-md border border-gray-200">
            <BoxHeader title="Standings" href="/standings" linkLabel="Full Table" />
            <div className="px-4 pb-3">
              <StandingsTable compact />
            </div>
          </div>

          <div className="rounded-md border border-gray-200">
            <BoxHeader
              title={`Week ${WEEKLY_SCORES.week} ${isPreseason() ? "Matchups" : "Scores"}`}
            />
            <div className="px-4 pb-2">
              <ScoreBoard />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SectionHeader({ title, href, linkLabel }) {
  return (
    <div className="mb-4 flex items-baseline justify-between border-b-2 border-espn pb-2">
      <h2 className="font-display text-2xl font-semibold uppercase tracking-wide text-gray-900">
        {title}
      </h2>
      {href && (
        <Link
          href={href}
          className="font-display text-xs uppercase tracking-widest text-link hover:underline"
        >
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}

function BoxHeader({ title, href, linkLabel }) {
  return (
    <div className="flex items-baseline justify-between border-b border-gray-200 bg-gray-50 px-4 py-2.5">
      <h2 className="font-display text-base font-semibold uppercase tracking-wide text-gray-900">
        {title}
      </h2>
      {href && (
        <Link
          href={href}
          className="font-display text-[11px] uppercase tracking-widest text-link hover:underline"
        >
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}
