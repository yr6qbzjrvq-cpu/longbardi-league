"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import { BRAND, NEIGHBORHOOD_PUBLIC, PICKEM_PUBLIC } from "@/lib/leagueData";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/articles", label: "News" },
  { href: "/announcements", label: "Announcements" },
  // Hidden until Pick 'Em is opened up to the league.
  ...(PICKEM_PUBLIC ? [{ href: "/pickem", label: "Pick 'Em" }] : []),
  { href: "/johnny-or-stevie", label: "Johnny or Stevie" },
  { href: "/standings", label: "Standings" },
  { href: "/chat", label: "Chat" },
  // Hidden until HSPNeighborhood is opened up to the league.
  ...(NEIGHBORHOOD_PUBLIC
    ? [{ href: "/neighborhood", label: "HSPNeighborhood" }]
    : []),
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 bg-nav shadow-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2 sm:gap-3"
          onClick={() => setOpen(false)}
        >
          <span className="flex shrink-0 -skew-x-6 items-center gap-1.5 bg-espn px-3 py-1">
            <svg
              width="18"
              height="12"
              viewBox="0 0 24 15"
              className="skew-x-6"
              aria-hidden="true"
            >
              <ellipse cx="12" cy="7.5" rx="11" ry="7" fill="#fff" />
              <line x1="7" y1="7.5" x2="17" y2="7.5" stroke="#0057B8" strokeWidth="1.4" />
              <line x1="9" y1="5.5" x2="9" y2="9.5" stroke="#0057B8" strokeWidth="1.4" />
              <line x1="12" y1="5.5" x2="12" y2="9.5" stroke="#0057B8" strokeWidth="1.4" />
              <line x1="15" y1="5.5" x2="15" y2="9.5" stroke="#0057B8" strokeWidth="1.4" />
            </svg>
            <span className="skew-x-6 font-display text-xl font-bold italic uppercase tracking-wide text-white">
              {BRAND.abbr}
            </span>
          </span>
          {/* Shown at every width. Small and tightly tracked on phones so it
              fits beside the logo and the menu button. */}
          <span className="min-w-0 font-display text-[9px] uppercase leading-tight tracking-wide text-gray-300 sm:text-[11px] md:text-xs md:tracking-widest lg:text-sm">
            {BRAND.full}
          </span>
        </Link>

        <nav className="hidden h-full items-stretch md:flex">
          {LINKS.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center border-b-[3px] px-2 lg:px-3 font-display text-sm uppercase tracking-widest transition-colors ${
                  active
                    ? "border-espn text-white"
                    : "border-transparent text-gray-300 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1">
          <ThemeToggle />

          <button
            onClick={() => setOpen(!open)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-gray-300 hover:text-white md:hidden"
            aria-label="Toggle menu"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {open ? (
                <path d="M6 6l12 12M18 6L6 18" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-nav-light bg-nav md:hidden">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block border-b border-nav-light px-6 py-4 font-display text-sm uppercase tracking-widest text-gray-200 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
