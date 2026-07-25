"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LEAGUE } from "@/lib/leagueData";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/articles", label: "Articles" },
  { href: "/standings", label: "Standings" },
  { href: "/admin", label: "Admin" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-ink-700 bg-ink-900/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <span className="flex h-9 w-9 items-center justify-center rounded bg-turf-500 font-display text-lg font-bold text-ink-950">
            L
          </span>
          <span className="font-display text-2xl uppercase tracking-wider text-white">
            {LEAGUE.name}
            <span className="ml-1.5 text-turf-400">League</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded px-4 py-2 font-display text-sm uppercase tracking-widest transition-colors ${
                  active
                    ? "bg-ink-700 text-turf-400"
                    : "text-slate-300 hover:bg-ink-800 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={() => setOpen(!open)}
          className="flex h-10 w-10 items-center justify-center rounded text-slate-300 hover:bg-ink-800 md:hidden"
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

      {open && (
        <nav className="border-t border-ink-700 bg-ink-900 md:hidden">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block border-b border-ink-800 px-6 py-4 font-display text-sm uppercase tracking-widest text-slate-200 hover:bg-ink-800 hover:text-turf-400"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
