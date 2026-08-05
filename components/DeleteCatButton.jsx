"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteCatButton({ id }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!window.confirm("Delete this photo?")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/cats/${id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh();
    else window.alert("Couldn't delete that photo.");
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={busy}
      className="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-white opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100 disabled:opacity-50"
    >
      {busy ? "..." : "Delete"}
    </button>
  );
}
