"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const MAX_DIMENSION = 2400;

function browserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const supabase = browserClient();

// Resize before upload. Storage allows 50MB now, but a 12MB original displayed
// in a small square is wasted bandwidth on phones.
async function resize(file) {
  if (file.type === "image/gif") return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const scale = Math.min(
    1,
    MAX_DIMENSION / Math.max(bitmap.width, bitmap.height)
  );
  if (scale === 1) return file;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((r) =>
    canvas.toBlob(r, "image/jpeg", 0.9)
  );
  if (!blob) return file;
  return new File([blob], "cat.jpg", { type: "image/jpeg" });
}

export default function CatAdminUploader() {
  const router = useRouter();
  const fileRef = useRef(null);
  const [cat, setCat] = useState("johnny");
  const [count, setCount] = useState(0);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function uploadOne(file) {
    const prepared = await resize(file);

    const urlRes = await fetch("/api/admin/cats/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: prepared.type }),
    });
    if (!urlRes.ok) throw new Error("Couldn't start upload");
    const { path, token } = await urlRes.json();

    // Straight to Supabase Storage, bypassing the serverless body limit.
    const { error: upErr } = await supabase.storage
      .from("cat-photos")
      .uploadToSignedUrl(path, token, prepared, {
        contentType: prepared.type,
      });
    if (upErr) throw new Error("Upload failed");

    const rowRes = await fetch("/api/cats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, cat }),
    });
    if (!rowRes.ok) throw new Error("Couldn't save photo");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const files = [...(fileRef.current?.files || [])];
    if (files.length === 0) {
      setError("Pick some photos first.");
      return;
    }
    setError("");
    setDone("");

    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      setProgress({ current: i + 1, total: files.length });
      try {
        await uploadOne(files[i]);
        ok += 1;
      } catch {
        // Keep going; report the tally at the end.
      }
    }

    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
    setCount(0);
    const failed = files.length - ok;
    setDone(
      `Uploaded ${ok} photo${ok === 1 ? "" : "s"} as ${
        cat === "johnny" ? "Johnny" : "Stevie"
      }${failed ? `. ${failed} failed.` : "."}`
    );
    router.refresh();
  }

  if (!supabase) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Storage isn&apos;t connected.
      </p>
    );
  }

  const busy = progress !== null;

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-8 rounded-md border border-gray-200 bg-gray-50 p-4 sm:p-5"
    >
      <h2 className="mb-1 font-display text-lg font-semibold uppercase tracking-wide text-gray-900">
        Add photos
      </h2>
      <p className="mb-4 text-sm text-gray-500">
        Pick as many as you like, tell me whose they are, upload. Do one cat at a
        time.
      </p>

      <div className="mb-4 flex gap-2">
        {[
          ["johnny", "Johnny"],
          ["stevie", "Stevie"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setCat(value)}
            disabled={busy}
            className={`rounded-md px-6 py-2 font-display text-sm uppercase tracking-widest transition-colors disabled:opacity-50 ${
              cat === value
                ? "bg-espn text-white"
                : "border border-gray-300 bg-white text-gray-600 hover:border-espn hover:text-espn"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/gif"
        disabled={busy}
        onChange={(e) => {
          setCount(e.target.files?.length || 0);
          setDone("");
          setError("");
        }}
        className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-espn file:px-4 file:py-2 file:font-display file:text-xs file:uppercase file:tracking-widest file:text-white hover:file:bg-espn-dark"
      />

      {count > 0 && !busy && (
        <p className="mt-2 text-sm text-gray-600">
          {count} photo{count === 1 ? "" : "s"} selected.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-espn px-6 py-2 font-display text-sm uppercase tracking-widest text-white transition-colors hover:bg-espn-dark disabled:opacity-50"
        >
          {busy
            ? `Uploading ${progress.current} of ${progress.total}...`
            : `Upload as ${cat === "johnny" ? "Johnny" : "Stevie"}`}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
        {done && <span className="text-sm text-green-700">{done}</span>}
      </div>
    </form>
  );
}
