import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ScoreStrip from "@/components/ScoreStrip";
import SiteChrome from "@/components/SiteChrome";
import { LEAGUE, BRAND } from "@/lib/leagueData";

export const metadata = {
  title: {
    default: `${BRAND.abbr} — ${BRAND.full}`,
    template: `%s | ${BRAND.abbr}`,
  },
  description: `${BRAND.full}. ${LEAGUE.tagline}.`,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Oswald:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <SiteChrome
          strip={<ScoreStrip />}
          nav={<Navbar />}
          footer={<Footer />}
        >
          {children}
        </SiteChrome>
      </body>
    </html>
  );
}
