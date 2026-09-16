"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// A dependency-free crop step. Shows the picked image with a draggable /
// resizable crop rectangle, aspect presets, and a confirm action. On confirm
// (or "use full image") it draws the selection to a canvas and hands back a
// File in the requested format (webp, matching the site's upload pipeline).
//
// Works with mouse and touch (pointer events), adapts to light/dark via the
// site's remapped neutral utilities, and never leaks the object URL.

const MIN_CROP = 32; // smallest crop box on screen, in display pixels

const PRESETS = [
  { key: "free", label: "Free", ratio: null },
  { key: "16:9", label: "16:9", ratio: 16 / 9 },
  { key: "1:1", label: "1:1", ratio: 1 },
];

// "contain" the natural image inside the stage box.
function fitRect(stageW, stageH, natW, natH) {
  if (!stageW || !stageH || !natW || !natH) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const scale = Math.min(stageW / natW, stageH / natH);
  const w = natW * scale;
  const h = natH * scale;
  return { x: (stageW - w) / 2, y: (stageH - h) / 2, w, h };
}

// Centered crop of a given aspect ratio that fits inside the image rect.
function centeredCrop(imgRect, ratio) {
  if (!ratio) {
    const inset = 0.08;
    return {
      x: imgRect.x + imgRect.w * inset,
      y: imgRect.y + imgRect.h * inset,
      w: imgRect.w * (1 - inset * 2),
      h: imgRect.h * (1 - inset * 2),
    };
  }
  let w = imgRect.w;
  let h = w / ratio;
  if (h > imgRect.h) {
    h = imgRect.h;
    w = h * ratio;
  }
  return {
    x: imgRect.x + (imgRect.w - w) / 2,
    y: imgRect.y + (imgRect.h - h) / 2,
    w,
    h,
  };
}

function clampCropToImage(crop, imgRect) {
  let { x, y, w, h } = crop;
  w = Math.min(w, imgRect.w);
  h = Math.min(h, imgRect.h);
  x = Math.max(imgRect.x, Math.min(x, imgRect.x + imgRect.w - w));
  y = Math.max(imgRect.y, Math.min(y, imgRect.y + imgRect.h - h));
  return { x, y, w, h };
}

export default function ImageCropper({
  file,
  initialAspect = "16:9",
  outputType = "image/webp",
  quality = 0.9,
  maxEdge = 1600,
  onConfirm,
  onCancel,
}) {
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null);

  const [src, setSrc] = useState("");
  const [natural, setNatural] = useState(null);
  const [imgRect, setImgRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [crop, setCrop] = useState(null);
  const [presetKey, setPresetKey] = useState(
    PRESETS.some((p) => p.key === initialAspect) ? initialAspect : "free"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ratio = PRESETS.find((p) => p.key === presetKey)?.ratio ?? null;

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const layout = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !natural) return;
    const rect = fitRect(
      stage.clientWidth,
      stage.clientHeight,
      natural.w,
      natural.h
    );
    setImgRect((prev) => {
      setCrop((prevCrop) => {
        if (!prevCrop || !prev.w) {
          return centeredCrop(rect, ratio);
        }
        const sx = rect.w / prev.w;
        const sy = rect.h / prev.h;
        return clampCropToImage(
          {
            x: rect.x + (prevCrop.x - prev.x) * sx,
            y: rect.y + (prevCrop.y - prev.y) * sy,
            w: prevCrop.w * sx,
            h: prevCrop.h * sy,
          },
          rect
        );
      });
      return rect;
    });
  }, [natural, ratio]);

  useLayoutEffect(() => {
    layout();
  }, [layout]);

  useEffect(() => {
    if (!natural) return undefined;
    const onResize = () => layout();
    window.addEventListener("resize", onResize);
    let ro;
    if (typeof ResizeObserver !== "undefined" && stageRef.current) {
      ro = new ResizeObserver(onResize);
      ro.observe(stageRef.current);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      if (ro) ro.disconnect();
    };
  }, [natural, layout]);

  function onImgLoad(e) {
    const el = e.currentTarget;
    setNatural({ w: el.naturalWidth, h: el.naturalHeight });
  }

  function choosePreset(key) {
    setPresetKey(key);
    const r = PRESETS.find((p) => p.key === key)?.ratio ?? null;
    setCrop(centeredCrop(imgRect, r));
  }

  function pointerPos(e) {
    const rect = stageRef.current.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  }

  function startDrag(e, mode) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode,
      start: pointerPos(e),
      startCrop: { ...crop },
    };
  }

  function onPointerMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const { px, py } = pointerPos(e);
    const dx = px - drag.start.px;
    const dy = py - drag.start.py;
    const s = drag.startCrop;
    const minX = imgRect.x;
    const minY = imgRect.y;
    const maxX = imgRect.x + imgRect.w;
    const maxY = imgRect.y + imgRect.h;

    if (drag.mode === "move") {
      setCrop(
        clampCropToImage({ x: s.x + dx, y: s.y + dy, w: s.w, h: s.h }, imgRect)
      );
      return;
    }

    const anchorX = drag.mode === "nw" || drag.mode === "sw" ? s.x + s.w : s.x;
    const anchorY = drag.mode === "nw" || drag.mode === "ne" ? s.y + s.h : s.y;
    const curX = Math.max(minX, Math.min(maxX, px));
    const curY = Math.max(minY, Math.min(maxY, py));

    let w = Math.abs(curX - anchorX);
    let h = Math.abs(curY - anchorY);

    if (ratio) {
      if (w / ratio > h) h = w / ratio;
      else w = h * ratio;
      const availX = curX >= anchorX ? maxX - anchorX : anchorX - minX;
      const availY = curY >= anchorY ? maxY - anchorY : anchorY - minY;
      if (w > availX) {
        w = availX;
        h = w / ratio;
      }
      if (h > availY) {
        h = availY;
        w = h * ratio;
      }
    }

    w = Math.max(MIN_CROP, w);
    h = Math.max(ratio ? MIN_CROP / ratio : MIN_CROP, h);

    const dirX = curX >= anchorX ? 1 : -1;
    const dirY = curY >= anchorY ? 1 : -1;
    const nx = dirX === 1 ? anchorX : anchorX - w;
    const ny = dirY === 1 ? anchorY : anchorY - h;

    setCrop(clampCropToImage({ x: nx, y: ny, w, h }, imgRect));
  }

  function endDrag(e) {
    if (dragRef.current) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      dragRef.current = null;
    }
  }

  async function render(fullImage) {
    setBusy(true);
    setError("");
    try {
      const img = imgRef.current;
      const nat = natural;
      let sx;
      let sy;
      let sw;
      let sh;
      if (fullImage || !crop || !imgRect.w) {
        sx = 0;
        sy = 0;
        sw = nat.w;
        sh = nat.h;
      } else {
        const scaleX = nat.w / imgRect.w;
        const scaleY = nat.h / imgRect.h;
        sx = (crop.x - imgRect.x) * scaleX;
        sy = (crop.y - imgRect.y) * scaleY;
        sw = crop.w * scaleX;
        sh = crop.h * scaleY;
      }
      sx = Math.max(0, Math.min(sx, nat.w));
      sy = Math.max(0, Math.min(sy, nat.h));
      sw = Math.max(1, Math.min(sw, nat.w - sx));
      sh = Math.max(1, Math.min(sh, nat.h - sy));

      let outW = Math.round(sw);
      let outH = Math.round(sh);
      const longest = Math.max(outW, outH);
      if (longest > maxEdge) {
        const sc = maxEdge / longest;
        outW = Math.max(1, Math.round(outW * sc));
        outH = Math.max(1, Math.round(outH * sc));
      }

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

      let type = outputType;
      let blob = await new Promise((r) => canvas.toBlob(r, type, quality));
      if (!blob && type !== "image/jpeg") {
        type = "image/jpeg";
        blob = await new Promise((r) => canvas.toBlob(r, type, quality));
      }
      if (!blob) throw new Error("encode-failed");

      const ext = type === "image/webp" ? "webp" : "jpg";
      const out = new File([blob], `crop.${ext}`, { type });
      onConfirm(out);
    } catch {
      setError('Couldn’t process that image. Try “Use full image”.');
      setBusy(false);
    }
  }

  const handleBase =
    "absolute h-6 w-6 rounded-full border-2 border-white bg-espn shadow touch-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6">
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <h2 className="font-display text-base font-semibold uppercase tracking-widest text-gray-900">
            Crop image
          </h2>
          <div className="flex gap-1.5" role="group" aria-label="Aspect ratio">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => choosePreset(p.key)}
                className={`min-h-[36px] rounded-md px-3 py-1.5 font-display text-xs uppercase tracking-widest transition-colors ${
                  presetKey === p.key
                    ? "bg-espn text-white"
                    : "border border-gray-300 text-gray-600 hover:border-espn hover:text-espn"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-gray-100 p-3">
          <div
            ref={stageRef}
            className="relative mx-auto h-[46vh] w-full select-none sm:h-[52vh]"
            style={{ touchAction: "none" }}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={imgRef}
                src={src}
                alt="Crop preview"
                onLoad={onImgLoad}
                draggable={false}
                className="pointer-events-none absolute select-none"
                style={{
                  left: imgRect.x,
                  top: imgRect.y,
                  width: imgRect.w || "auto",
                  height: imgRect.h || "auto",
                }}
              />
            )}

            {crop && imgRect.w > 0 && (
              <div
                onPointerDown={(e) => startDrag(e, "move")}
                className="absolute cursor-move"
                style={{
                  left: crop.x,
                  top: crop.y,
                  width: crop.w,
                  height: crop.h,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
                  outline: "2px solid #fff",
                }}
              >
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute left-1/3 top-0 h-full w-px bg-white/40" />
                  <div className="absolute left-2/3 top-0 h-full w-px bg-white/40" />
                  <div className="absolute left-0 top-1/3 h-px w-full bg-white/40" />
                  <div className="absolute left-0 top-2/3 h-px w-full bg-white/40" />
                </div>
                {["nw", "ne", "sw", "se"].map((corner) => {
                  const pos = {
                    nw: { left: -12, top: -12, cursor: "nwse-resize" },
                    ne: { right: -12, top: -12, cursor: "nesw-resize" },
                    sw: { left: -12, bottom: -12, cursor: "nesw-resize" },
                    se: { right: -12, bottom: -12, cursor: "nwse-resize" },
                  }[corner];
                  return (
                    <div
                      key={corner}
                      onPointerDown={(e) => startDrag(e, corner)}
                      className={handleBase}
                      style={pos}
                      aria-label={`Resize ${corner}`}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {error && (
          <p className="border-t border-gray-200 px-4 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-[44px] rounded-md border border-gray-300 px-4 py-2 font-display text-xs uppercase tracking-widest text-gray-500 transition-colors hover:text-gray-900 disabled:opacity-50"
          >
            Cancel
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => render(true)}
              disabled={busy || !natural}
              className="min-h-[44px] rounded-md border border-espn px-4 py-2 font-display text-xs uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white disabled:opacity-50"
            >
              Use full image
            </button>
            <button
              type="button"
              onClick={() => render(false)}
              disabled={busy || !natural}
              className="min-h-[44px] rounded-md bg-espn px-6 py-2 font-display text-xs uppercase tracking-widest text-white transition-colors hover:bg-espn-dark disabled:opacity-50"
            >
              {busy ? "Working..." : "Crop & use"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
