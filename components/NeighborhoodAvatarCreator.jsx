"use client";

import { useEffect, useRef, useState } from "react";
import {
  BODY_SHAPES,
  BODY_SIZES,
  DEFAULT_AVATAR,
  EYE_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  MOUTH_STYLES,
  PANTS_COLORS,
  PANTS_STYLES,
  SHIRT_COLORS,
  SHIRT_STYLES,
  SHOE_COLORS,
  SHOE_STYLES,
  SKIN_TONES,
  STYLE_LABELS,
  drawAvatar,
  normalizeAvatar,
  randomAvatar,
} from "@/lib/neighborhoodAvatar";
import {
  USERNAME_MAX,
  loadPlayer,
  savePlayer,
  validateUsername,
} from "@/lib/neighborhoodPlayer";

// Fixed backing resolution for the preview canvas; CSS scales
// it responsively and it stays crisp on phone DPRs.
const CANVAS_W = 480;
const CANVAS_H = 520;

function label(value) {
  return STYLE_LABELS[value] || value;
}

function OptionChips({ title, options, selected, onPick }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
        {title}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = opt === selected;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onPick(opt)}
              aria-pressed={active}
              className={`min-h-[44px] rounded-full border px-4 text-sm font-medium transition-colors ${
                active
                  ? "border-espn bg-espn text-white"
                  : "border-gray-300 bg-white text-gray-700 hover:border-espn hover:text-espn dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
              }`}
            >
              {label(opt)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ColorSwatches({ title, colors, selected, onPick }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
        {title}
      </p>
      <div className="flex flex-wrap gap-2">
        {colors.map((color) => {
          const active = color === selected;
          return (
            <button
              key={color}
              type="button"
              onClick={() => onPick(color)}
              aria-pressed={active}
              aria-label={`${title} ${color}`}
              style={{ backgroundColor: color }}
              className={`h-11 w-11 rounded-full border-2 transition-transform ${
                active
                  ? "scale-110 border-espn ring-2 ring-espn ring-offset-2 ring-offset-white dark:ring-offset-gray-900"
                  : "border-black/10 hover:scale-105 dark:border-white/20"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h2 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export default function NeighborhoodAvatarCreator() {
  const canvasRef = useRef(null);
  const [avatar, setAvatar] = useState(DEFAULT_AVATAR);
  const [username, setUsername] = useState("");
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [isReturning, setIsReturning] = useState(false);

  // Load the saved character once, client-side only.
  useEffect(() => {
    const existing = loadPlayer();
    if (existing) {
      setAvatar(existing.avatar);
      setUsername(existing.username || "");
      if (existing.username) setIsReturning(true);
    }
  }, []);

  // Live preview — same drawAvatar the rooms will use.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawAvatar(ctx, avatar, CANVAS_W / 2, CANVAS_H - 60, 2.4);
  }, [avatar]);

  // Clear the "Saved!" note after a moment.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  function update(patch) {
    setAvatar((prev) => normalizeAvatar({ ...prev, ...patch }));
    setDirty(true);
    setSaved(false);
  }

  function updateSlot(slot, patch) {
    setAvatar((prev) =>
      normalizeAvatar({ ...prev, [slot]: { ...prev[slot], ...patch } })
    );
    setDirty(true);
    setSaved(false);
  }

  function handleRandomize() {
    setAvatar(randomAvatar());
    setDirty(true);
    setSaved(false);
  }

  function handleSave() {
    const result = validateUsername(username);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setUsername(result.value);
    savePlayer({ username: result.value, avatar });
    setDirty(false);
    setSaved(true);
    setIsReturning(true);
  }

  return (
    <div className="mx-auto max-w-md space-y-4 md:max-w-4xl md:grid md:grid-cols-2 md:items-start md:gap-6 md:space-y-0">
      {/* Preview */}
      <div className="space-y-4 md:sticky md:top-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="mx-auto w-full max-w-[300px] touch-manipulation rounded-lg bg-gradient-to-b from-sky-100 to-emerald-100 dark:from-slate-800 dark:to-slate-700"
            aria-label="Preview of your character"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="min-h-[1.25rem] text-sm text-gray-500 dark:text-gray-400">
              {saved
                ? "Saved! See you in the neighborhood."
                : dirty
                  ? "Unsaved changes"
                  : isReturning
                    ? "Welcome back — this is your saved character."
                    : "This is exactly how you'll look in the world."}
            </p>
            <button
              type="button"
              onClick={handleRandomize}
              className="min-h-[44px] shrink-0 rounded-md border border-espn px-4 font-display text-sm uppercase tracking-widest text-espn transition-colors hover:bg-espn hover:text-white"
            >
              Randomize
            </button>
          </div>
        </div>

        {/* Username */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <label
            htmlFor="neighborhood-username"
            className="mb-2 block font-display text-lg font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100"
          >
            Your Name
          </label>
          <input
            id="neighborhood-username"
            type="text"
            value={username}
            maxLength={USERNAME_MAX}
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            enterKeyHint="done"
            placeholder="e.g. Gridiron Gary"
            onChange={(e) => {
              setUsername(e.target.value);
              setDirty(true);
              setSaved(false);
              if (error) setError(null);
            }}
            className="h-12 w-full rounded-md border border-gray-300 bg-white px-3 text-base text-gray-900 outline-none transition-colors focus:border-espn focus:ring-2 focus:ring-espn/30 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          {error ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              2–16 characters. Name claims are first-come once multiplayer
              opens.
            </p>
          )}
          <button
            type="button"
            onClick={handleSave}
            className="mt-3 h-12 w-full rounded-md bg-espn font-display uppercase tracking-widest text-white transition-colors hover:bg-espn-dark"
          >
            Save Character
          </button>
        </div>
      </div>

      {/* Options */}
      <div className="space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Section title="Body">
          <OptionChips
            title="Shape"
            options={BODY_SHAPES}
            selected={avatar.body.shape}
            onPick={(v) => updateSlot("body", { shape: v })}
          />
          <OptionChips
            title="Height"
            options={BODY_SIZES}
            selected={avatar.body.size}
            onPick={(v) => updateSlot("body", { size: v })}
          />
          <ColorSwatches
            title="Skin Tone"
            colors={SKIN_TONES}
            selected={avatar.skin}
            onPick={(v) => update({ skin: v })}
          />
        </Section>

        <Section title="Hair">
          <OptionChips
            title="Style"
            options={HAIR_STYLES}
            selected={avatar.hair.style}
            onPick={(v) => updateSlot("hair", { style: v })}
          />
          <ColorSwatches
            title="Color"
            colors={HAIR_COLORS}
            selected={avatar.hair.color}
            onPick={(v) => updateSlot("hair", { color: v })}
          />
        </Section>

        <Section title="Face">
          <OptionChips
            title="Eyes"
            options={EYE_STYLES}
            selected={avatar.eyes}
            onPick={(v) => update({ eyes: v })}
          />
          <OptionChips
            title="Mouth"
            options={MOUTH_STYLES}
            selected={avatar.mouth}
            onPick={(v) => update({ mouth: v })}
          />
        </Section>

        <Section title="Shirt">
          <OptionChips
            title="Style"
            options={SHIRT_STYLES}
            selected={avatar.shirt.style}
            onPick={(v) => updateSlot("shirt", { style: v })}
          />
          <ColorSwatches
            title="Color"
            colors={SHIRT_COLORS}
            selected={avatar.shirt.color}
            onPick={(v) => updateSlot("shirt", { color: v })}
          />
        </Section>

        <Section title="Pants">
          <OptionChips
            title="Style"
            options={PANTS_STYLES}
            selected={avatar.pants.style}
            onPick={(v) => updateSlot("pants", { style: v })}
          />
          <ColorSwatches
            title="Color"
            colors={PANTS_COLORS}
            selected={avatar.pants.color}
            onPick={(v) => updateSlot("pants", { color: v })}
          />
        </Section>

        <Section title="Shoes">
          <OptionChips
            title="Style"
            options={SHOE_STYLES}
            selected={avatar.shoes.style}
            onPick={(v) => updateSlot("shoes", { style: v })}
          />
          <ColorSwatches
            title="Color"
            colors={SHOE_COLORS}
            selected={avatar.shoes.color}
            onPick={(v) => updateSlot("shoes", { color: v })}
          />
        </Section>
      </div>
    </div>
  );
}
