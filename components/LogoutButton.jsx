"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        router.refresh();
      }}
      className="rounded border border-ink-600 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:border-slate-400 hover:text-white"
    >
      Log out
    </button>
  );
}
