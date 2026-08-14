"use client";

import { useState } from "react";

const MAX_EDGE = 1600;

// Shrink in the browser so a phone photo doesn't travel full size.
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 400_000) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    if (!blob) return file;
    return new File([blob], "image.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export default function ImageUploadForm() {
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  async function onPick(event) {
    const picked = event.target.files?.[0];
    if (!picked) return;

    setState("working");
    setError("");
    setUrl("");
    setCopied(false);

    try {
      const file = await shrink(picked);

      const res = await fetch("/api/admin/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Couldn't start the upload.");
        setState("idle");
        return;
      }

      const put = await fetch(json.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) {
        setError("Storage rejected the file.");
        setState("idle");
        return;
      }

      setUrl(json.publicUrl);
      setState("done");
    } catch {
      setError("Something went wrong. Try again.");
      setState("idle");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <label className="inline-block cursor-pointer rounded-md bg-espn px-6 py-2 font-display uppercase tracking-widest text-white transition-colors hover:bg-espn-dark">
        {state === "working" ? "Uploading..." : "Choose image"}
        <input
          type="file"
          accept="image/*"
          onChange={onPick}
          disabled={state === "working"}
          className="hidden"
        />
      </label>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {url && (
        <div className="mt-6">
          <p className="mb-2 font-display text-xs uppercase tracking-widest text-gray-500">
            Image address
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700"
            />
            <button
              type="button"
              onClick={copy}
              className="rounded-md border border-espn px-4 py-2 font-display text-xs uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-sm text-gray-500">
            Paste this into the Image URL field when you write an article.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            className="mt-4 w-full rounded-md border border-gray-200"
          />
        </div>
      )}
    </div>
  );
}
