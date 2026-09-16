"use client";

import { useRef, useState } from "react";
import ImageCropper from "@/components/ImageCropper";

export default function ImageUploadForm() {
  const inputRef = useRef(null);
  const [state, setState] = useState("idle"); // idle | cropping | working | done
  const [pending, setPending] = useState(null); // File waiting to be cropped
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  function resetInput() {
    if (inputRef.current) inputRef.current.value = "";
  }

  function onPick(event) {
    const picked = event.target.files?.[0];
    if (!picked) return;

    setError("");
    setUrl("");
    setCopied(false);

    // Animated GIFs can't survive a canvas crop, so upload them untouched.
    if (picked.type === "image/gif") {
      uploadFile(picked);
      resetInput();
      return;
    }

    // Everything else gets the crop step first.
    setPending(picked);
    setState("cropping");
  }

  async function uploadFile(file) {
    setState("working");
    setError("");

    try {
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

  function onCropConfirm(croppedFile) {
    setPending(null);
    resetInput();
    uploadFile(croppedFile);
  }

  function onCropCancel() {
    setPending(null);
    resetInput();
    setState("idle");
  }

  return (
    <div>
      <label className="inline-block cursor-pointer rounded-md bg-espn px-6 py-2 font-display uppercase tracking-widest text-white transition-colors hover:bg-espn-dark">
        {state === "working" ? "Uploading..." : "Choose image"}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={onPick}
          disabled={state === "working" || state === "cropping"}
          className="hidden"
        />
      </label>

      {state === "cropping" && pending && (
        <ImageCropper
          file={pending}
          initialAspect="16:9"
          onConfirm={onCropConfirm}
          onCancel={onCropCancel}
        />
      )}

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
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
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
