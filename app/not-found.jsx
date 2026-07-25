import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center">
      <p className="font-display text-7xl text-turf-500">4th &amp; 4</p>
      <h1 className="mt-4 font-display text-3xl uppercase tracking-wide text-white">
        Page Not Found
      </h1>
      <p className="mt-2 text-slate-400">
        That play isn&apos;t in the book. Punt it back to the front page.
      </p>
      <Link
        href="/"
        className="mt-8 inline-block rounded-lg bg-turf-500 px-8 py-3 font-display uppercase tracking-widest text-ink-950 hover:bg-turf-400"
      >
        Back Home
      </Link>
    </div>
  );
}
