"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteAnnouncementButton({ id, title }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Delete "${title}"? This can't be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/announcements/${id}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (res.ok) {
      router.push("/admin/announcements");
      router.refresh();
    } else {
      window.alert("Couldn't delete that announcement.");
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={busy}
      className="text-sm text-red-600 underline hover:text-red-800 disabled:opacity-50"
    >
      {busy ? "Deleting..." : "Delete"}
    </button>
  );
}
