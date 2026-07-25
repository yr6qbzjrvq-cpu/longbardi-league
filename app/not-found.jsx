import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center">
      <p className="font-display text-7xl font-bold text-espn">404</p>
      <h1 className="mt-4 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
        Page Not Found
      </h1>
      <p className="mt-2 text-gray-500">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        href="/"
        className="mt-8 inline-block rounded-md bg-espn px-8 py-3 font-display uppercase tracking-widest text-white hover:bg-espn-dark"
      >
        Back Home
      </Link>
    </div>
  );
}
