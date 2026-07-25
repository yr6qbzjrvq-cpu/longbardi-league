"use client";

import { usePathname } from "next/navigation";

// Hides the main HSPN chrome on Commissioner Mode routes,
// which supply their own (gloriously outdated) chrome.
export default function SiteChrome({ strip, nav, footer, children }) {
  const pathname = usePathname();
  if (pathname.startsWith("/commissioner")) {
    return <>{children}</>;
  }
  return (
    <>
      {strip}
      {nav}
      <main className="flex-1">{children}</main>
      {footer}
    </>
  );
}
