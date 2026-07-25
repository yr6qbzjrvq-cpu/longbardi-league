"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteOpinionButton({ id }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (!confirm("Delete this opinion? This cannot be undone.")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/opinions/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/discussion");
      router.refresh();
    } else {
      alert("Delete failed.");
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={busy}
      className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-espn hover:bg-red-50 disabled:opacity-50"
    >
      {busy ? "..." : "Delete"}
    </button>
  );
}
