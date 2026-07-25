import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticleBySlug } from "@/lib/articles";
import { glorifyTitle, glorifyBody } from "@/lib/propaganda";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) return { title: "Proclamation Not Found" };
  return { title: glorifyTitle(article) };
}

export default async function ProclamationPage({ params }) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) notFound();

  const paragraphs = glorifyBody(article);
  const date = new Date(article.created_at).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div>
      <span className="cm-new">■ OFFICIAL</span>
      <h2 className="cm-h2">{glorifyTitle(article)}</h2>
      <div className="cm-date">
        Proclaimed {date} &middot; Ministry of League Information &middot;
        Approved for universal rejoicing
      </div>
      <hr className="cm-hr" />
      <center>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/pink-lady.svg"
          alt="Official announcement broadcast"
          width="420"
          className="cm-img"
        />
        <div className="cm-caption">
          The announcement is delivered to a grateful nation of twelve
          managers.
        </div>
      </center>
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <hr className="cm-hr" />
      <p style={{ textAlign: "center" }}>
        <Link href="/commissioner">&laquo;&laquo; Return to the Front Page</Link>
        {" | "}
        <Link href={`/articles/${article.slug}`}>
          View decadent Western coverage of this event
        </Link>
      </p>
    </div>
  );
}
