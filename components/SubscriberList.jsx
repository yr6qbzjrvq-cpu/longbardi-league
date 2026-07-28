"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function CopyButton({ emails, label }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const text = emails.join(", ");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs a secure context; fall back to a temp textarea.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (emails.length === 0) return null;

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md bg-espn px-4 py-2 font-display text-xs uppercase tracking-widest text-white transition-colors hover:bg-espn-dark"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

function Group({ title, blurb, rows, onRemove, busyId }) {
  const emails = rows.map((r) => r.email);

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b-2 border-espn pb-2">
        <div>
          <h2 className="font-display text-lg font-semibold uppercase tracking-wide text-gray-900">
            {title} ({rows.length})
          </h2>
          <p className="text-xs text-gray-500">{blurb}</p>
        </div>
        <CopyButton emails={emails} label="Copy BCC list" />
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-sm text-gray-500">Nobody yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-4 py-2"
            >
              <span className="break-all text-sm text-gray-800">{r.email}</span>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-gray-400">
                  {new Date(r.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(r.id, r.email)}
                  disabled={busyId === r.id}
                  className="text-xs text-red-600 underline hover:text-red-800 disabled:opacity-50"
                >
                  {busyId === r.id ? "Removing..." : "Remove"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function SubscriberList({ subscribers }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const all = subscribers.filter((s) => s.tier === "all");
  const announcements = subscribers.filter((s) => s.tier === "announcements");
  const everyone = subscribers.map((s) => s.email);

  async function handleRemove(id, email) {
    if (!window.confirm(`Remove ${email} from the list?`)) return;
    setBusyId(id);
    setError("");
    const res = await fetch(`/api/admin/subscribers/${id}`, {
      method: "DELETE",
    });
    setBusyId(null);
    if (!res.ok) {
      setError("Couldn't remove that address.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <div className="mb-8 rounded-md border border-gray-200 bg-gray-50 px-4 py-4">
        <p className="mb-3 text-sm text-gray-700">
          <strong>Posting an announcement?</strong> Copy the &ldquo;everyone&rdquo;
          list. <strong>Posting a news article?</strong> Copy just the
          announcements-and-news list. Paste into the <strong>BCC</strong> field
          of a new email so nobody sees anyone else&rsquo;s address.
        </p>
        <CopyButton
          emails={everyone}
          label={`Copy everyone (${everyone.length})`}
        />
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <Group
        title="Announcements + News"
        blurb="Gets every article and every announcement."
        rows={all}
        onRemove={handleRemove}
        busyId={busyId}
      />
      <Group
        title="Announcements Only"
        blurb="Only wants commissioner announcements. Leave these out of article emails."
        rows={announcements}
        onRemove={handleRemove}
        busyId={busyId}
      />
    </div>
  );
}
