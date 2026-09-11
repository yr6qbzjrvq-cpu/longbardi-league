"use client";

import { useMemo, useState } from "react";
import {
  CHANNEL_NAME_MAX,
  validateChannelInput,
  youtubeIdFrom,
} from "@/lib/neighborhood/channels";

// ============================================================
// The TV lineup editor (milestone 28).
// ------------------------------------------------------------
// Two lists, one component. Every mutation goes to
// /api/admin/channels, which re-validates with the SAME module
// this form imports — the form is a courtesy, the route is the
// rule.
// ============================================================

const KINDS = [
  {
    kind: "tv",
    title: "YouTube TV (live broadcast)",
    blurb:
      "Channels the room can flip to while you're broadcasting YouTube TV from a popup window. Paste the link straight out of your YouTube TV tab — open the channel you want, then copy the address bar. Nothing here tries to understand the link; it just gets loaded into the popup.",
    placeholder: "https://tv.youtube.com/watch/...",
  },
  {
    kind: "youtube",
    title: "YouTube (nobody broadcasting)",
    blurb:
      "Public YouTube videos or live streams the screens play when you're not broadcasting. Paste a normal watch link, a youtu.be link, or a live link. Videos whose owner blocks embedding will show as unavailable in the room.",
    placeholder: "https://www.youtube.com/watch?v=...",
  },
];

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-espn focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";

const btnClass =
  "min-h-[38px] rounded-md border border-espn px-3 font-display text-xs uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white disabled:opacity-50";

const quietBtnClass =
  "min-h-[38px] rounded-md border border-gray-300 px-3 font-display text-xs uppercase tracking-widest text-gray-600 transition-colors hover:border-espn hover:text-espn disabled:opacity-50 dark:border-gray-600 dark:text-gray-300";

export default function AdminChannels({ initial }) {
  const [channels, setChannels] = useState(initial || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState({ tv: { name: "", url: "" }, youtube: { name: "", url: "" } });
  const [editing, setEditing] = useState(null); // { id, name, url }

  const byKind = useMemo(() => {
    const out = { tv: [], youtube: [] };
    for (const c of channels) {
      if (out[c.kind]) out[c.kind].push(c);
    }
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => a.sort - b.sort);
    }
    return out;
  }, [channels]);

  async function send(payload) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/admin/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError((json && json.error) || "That didn't save.");
        return null;
      }
      return json || {};
    } catch {
      setError("That didn't save.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    try {
      const res = await fetch("/api/admin/channels");
      const json = await res.json();
      if (json && json.channels) setChannels(json.channels);
    } catch {
      // the optimistic update already moved the list
    }
  }

  async function add(kind) {
    const draft = drafts[kind];
    const check = validateChannelInput({ kind, name: draft.name, url: draft.url });
    if (!check.ok) {
      setError(check.error);
      return;
    }
    const sort = (byKind[kind].length ? byKind[kind][byKind[kind].length - 1].sort : -1) + 1;
    const out = await send({ action: "create", kind, name: draft.name, url: draft.url, sort });
    if (!out) return;
    setDrafts((d) => ({ ...d, [kind]: { name: "", url: "" } }));
    setNote(`Added ${check.value.name}.`);
    await refresh();
  }

  async function saveEdit() {
    if (!editing) return;
    const row = channels.find((c) => c.id === editing.id);
    if (!row) return;
    const out = await send({
      action: "update",
      id: editing.id,
      kind: row.kind,
      name: editing.name,
      url: editing.url,
      sort: row.sort,
      enabled: row.enabled,
    });
    if (!out) return;
    setEditing(null);
    await refresh();
  }

  async function remove(row) {
    if (!window.confirm(`Remove "${row.name}" from the lineup?`)) return;
    const out = await send({ action: "delete", id: row.id });
    if (!out) return;
    setChannels((cs) => cs.filter((c) => c.id !== row.id));
  }

  async function toggle(row) {
    const out = await send({ action: "toggle", id: row.id, enabled: !row.enabled });
    if (!out) return;
    setChannels((cs) =>
      cs.map((c) => (c.id === row.id ? { ...c, enabled: !row.enabled } : c))
    );
  }

  async function move(row, delta) {
    const list = byKind[row.kind];
    const i = list.findIndex((c) => c.id === row.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    const next = list.slice();
    next.splice(j, 0, next.splice(i, 1)[0]);
    setChannels((cs) =>
      cs.map((c) => {
        const at = next.findIndex((n) => n.id === c.id);
        return at >= 0 && c.kind === row.kind ? { ...c, sort: at } : c;
      })
    );
    const out = await send({ action: "reorder", kind: row.kind, ids: next.map((c) => c.id) });
    if (!out) await refresh();
  }

  return (
    <div className="space-y-10">
      {(error || note) && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            error
              ? "border-red-300 bg-red-50 text-red-800"
              : "border-green-300 bg-green-50 text-green-800"
          }`}
        >
          {error || note}
        </div>
      )}

      {KINDS.map(({ kind, title, blurb, placeholder }) => (
        <section key={kind}>
          <h2 className="font-display text-xl font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100">
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">{blurb}</p>

          <div className="mt-4 space-y-3">
            {byKind[kind].map((row, i) => {
              const isEditing = editing && editing.id === row.id;
              return (
                <div
                  key={row.id}
                  className="rounded-md border border-gray-200 px-4 py-3 dark:border-gray-700"
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        className={inputClass}
                        value={editing.name}
                        maxLength={CHANNEL_NAME_MAX}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        aria-label="Channel name"
                      />
                      <input
                        className={inputClass}
                        value={editing.url}
                        onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                        aria-label="Channel link"
                      />
                      <div className="flex gap-2">
                        <button type="button" className={btnClass} onClick={saveEdit} disabled={busy}>
                          Save
                        </button>
                        <button
                          type="button"
                          className={quietBtnClass}
                          onClick={() => setEditing(null)}
                          disabled={busy}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 dark:text-gray-100">
                          <span className="mr-2 font-display text-xs text-gray-400">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          {row.name}
                          {!row.enabled && (
                            <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 font-display text-[10px] uppercase tracking-widest text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                              Off
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {row.url}
                          {kind === "youtube" && row.videoId ? ` — id ${row.videoId}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className={quietBtnClass}
                          onClick={() => move(row, -1)}
                          disabled={busy || i === 0}
                          aria-label={`Move ${row.name} up`}
                        >
                          &uarr;
                        </button>
                        <button
                          type="button"
                          className={quietBtnClass}
                          onClick={() => move(row, 1)}
                          disabled={busy || i === byKind[kind].length - 1}
                          aria-label={`Move ${row.name} down`}
                        >
                          &darr;
                        </button>
                        <button
                          type="button"
                          className={quietBtnClass}
                          onClick={() => toggle(row)}
                          disabled={busy}
                        >
                          {row.enabled ? "Turn off" : "Turn on"}
                        </button>
                        <button
                          type="button"
                          className={quietBtnClass}
                          onClick={() => setEditing({ id: row.id, name: row.name, url: row.url })}
                          disabled={busy}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="min-h-[38px] rounded-md border border-red-300 px-3 font-display text-xs uppercase tracking-widest text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                          onClick={() => remove(row)}
                          disabled={busy}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {byKind[kind].length === 0 && (
              <p className="rounded-md border border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                No channels yet.
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-gray-300 p-3 dark:border-gray-600">
            <div className="min-w-[10rem] flex-1">
              <label className="font-display text-[11px] uppercase tracking-widest text-gray-500">
                Name
              </label>
              <input
                className={inputClass}
                value={drafts[kind].name}
                maxLength={CHANNEL_NAME_MAX}
                placeholder={kind === "tv" ? "ESPN" : "Red Zone Highlights"}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [kind]: { ...d[kind], name: e.target.value } }))
                }
              />
            </div>
            <div className="min-w-[16rem] flex-[2]">
              <label className="font-display text-[11px] uppercase tracking-widest text-gray-500">
                Link
              </label>
              <input
                className={inputClass}
                value={drafts[kind].url}
                placeholder={placeholder}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [kind]: { ...d[kind], url: e.target.value } }))
                }
              />
            </div>
            <button type="button" className={btnClass} onClick={() => add(kind)} disabled={busy}>
              Add channel
            </button>
          </div>

          {kind === "youtube" && drafts.youtube.url && !youtubeIdFrom(drafts.youtube.url) && (
            <p className="mt-2 text-xs text-amber-700">
              That link has no video id in it. Open the video (or the live stream) itself and copy
              that address.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
