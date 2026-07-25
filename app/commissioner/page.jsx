import Link from "next/link";
import { getPublishedArticles } from "@/lib/articles";
import { glorifyTitle, glorifyBody } from "@/lib/propaganda";

export const dynamic = "force-dynamic";

export default async function CommissionerFrontPage() {
  const articles = await getPublishedArticles();
  const [lead, ...rest] = articles;

  return (
    <div>
      {lead && (
        <table className="cm-article-box" width="100%" cellPadding="10">
          <tbody>
            <tr>
              <td width="240">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/pink-lady.svg"
                  alt="Official announcement broadcast"
                  width="240"
                  className="cm-img"
                />
                <div className="cm-caption">
                  Official broadcast, Ministry of League Information
                </div>
              </td>
              <td>
                <span className="cm-new">■ NEW!</span>
                <h2 className="cm-h2">
                  <Link href={`/commissioner/${lead.slug}`}>
                    {glorifyTitle(lead)}
                  </Link>
                </h2>
                <p>{glorifyBody(lead)[1]}</p>
                <p>
                  <Link href={`/commissioner/${lead.slug}`}>
                    &raquo;&raquo; Read the full proclamation
                  </Link>
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      )}

      <hr className="cm-hr" />
      <h3 className="cm-h3">FURTHER TRIUMPHS OF THE GLORIOUS LEAGUE:</h3>
      <br />
      {rest.map((a) => (
        <table key={a.id} className="cm-article-box" width="100%" cellPadding="8">
          <tbody>
            <tr>
              <td width="110">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/pink-lady.svg"
                  alt="Official announcement broadcast"
                  width="110"
                  className="cm-img"
                />
              </td>
              <td>
                <h3 className="cm-h3">
                  <Link href={`/commissioner/${a.slug}`}>
                    {glorifyTitle(a)}
                  </Link>
                </h3>
                <span className="cm-date">
                  Announced{" "}
                  {new Date(a.created_at).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}{" "}
                  in an atmosphere of great jubilation
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      ))}

      <p style={{ textAlign: "center", fontSize: "13px" }}>
        <b>
          Managers wishing to express additional gratitude to the Commissioner
          may do so at any time. Queues are expected.
        </b>
      </p>
    </div>
  );
}
