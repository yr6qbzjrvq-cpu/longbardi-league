import JohnnyOrStevieGame from "@/components/JohnnyOrStevieGame";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Johnny or Stevie",
  description: "Two identical black cats. Can you tell them apart?",
};

export default function JohnnyOrStevePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="mb-2 border-b-2 border-espn pb-3 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900 sm:text-4xl">
        Johnny or Stevie
      </h1>
      <p className="mb-8 text-sm text-gray-500">
        The Commissioner has two identical black cats. Good luck.
      </p>
      <JohnnyOrStevieGame />
    </div>
  );
}
