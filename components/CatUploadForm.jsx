"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_DIMENSION = 1600;
const MAX_BYTES = 5 * 1024 * 1024;

export default function CatUploadForm() {
  const router = useRouter();
  const fileRef = useRef(null);
  const [name, setName] = useState("");
  const [caption, setCaption] = useState("");
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  function onPick(e) {
    const f = e.target.files?.[0];
    setError("");
    if (!f) {
      setPreview(null);
      return;
    }
    setPreview(URL.createObjectURL(f));
  }

  async function prepare(file) {
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
    if (scale === 1 && file.size <= MAX_BYTES) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    if (!blob) return file;
    return new File([blob], "cat.jpg", { type: "image/jpeg" });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Pick a photo first.");
      return;
    }
    setStatus("uploading");
    setError("");

    let toSend;
    try {
      toSend = await prepare(file);
    } catch {
      toSend = file;
    }

    if (toSend.size > MAX_BYTES) {
      setStatus("idle");
      setError("That image is too large even after resizing. Try another.");
      return;
    }

    const body = new FormData();
    body.append("file", toSend);
    body.append("name", name);
    body.append("caption", caption);

    let res, json;
    try {
      res = await fetch("/api/cats", { method: "POST", body });
      json = await res.json();
    } catch {
      setStatus("idle");
      setError("Upload failed. Try again.");
      return;
    }

    if (!res.ok) {
      setStatus("idle");
      setError(json?.error || "Upload failed. Try again.");
      return;
    }

    try {
      window.localStorage.setItem("hspn_chat_name", name.trim());
    } catch {}

    setStatus("idle");
    setCaption("");
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  const input =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-espn";

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-10 rounded-md border border-gray-200 bg-gray-50 p-4 sm:p-5"
    >
      <h2 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-gray-900">
        Add a cat
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={40}
          required
          className={input}
        />
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption (optional)"
          maxLength={140}
          className={input}
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={onPick}
        required
        className="mt-3 block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-espn file:px-4 file:py-2 file:font-display file:text-xs file:uppercase file:tracking-widest file:text-white hover:file:bg-espn-dark"
      />

      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Preview"
          className="mt-3 max-h-48 rounded-md border border-gray-200 object-contain"
        />
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={status === "uploading" || !name.trim()}
          className="rounded-md bg-espn px-6 py-2 font-display text-sm uppercase tracking-widest text-white transition-colors hover:bg-espn-dark disabled:opacity-50"
        >
          {status === "uploading" ? "Uploading..." : "Post Photo"}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </form>
  );
}
