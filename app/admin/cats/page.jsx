import Link from "next/link";
import AdminLoginForm from "@/components/AdminLoginForm";
import CatAdminUploader from "@/components/CatAdminUploader";
import DeleteCatButton from "@/components/DeleteCatButton";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const metadata = { title: "Johnny or Stevie Photos" };

function publicUrl(path) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/cat-photos/${path}`;
}

export default async function AdminCatsPage() {
  if (!(await isAuthed())) {
    return <AdminLoginForm />;
  }

  let photos = [];
  let loadError = null;
  const supabase = getAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("cat_photos")
      .select("*")
      .order("created_at", { ascending: false });
    photos = data || [];
    loadError = error?.message || null;
  }

  const johnny = photos.filter((p) => p.cat === "johnny").length;
  const stevie = photos.filter((p) => p.cat === "stevie").length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-link hover:underline">
          &larr; Back to dashboard
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
          Johnny or Stevie Photos
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {photos.length} total &middot; {johnny} Johnny &middot; {stevie} Stevie
          {photos.length < 20 && (
            <>
              {" "}
              &middot;{" "}
              <span className="text-amber-700">
                {20 - photos.length} more for a full 20-photo round
              </span>
            </>
          )}
        </p>
      </div>

      <CatAdminUploader />

      {loadError && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          Couldn&apos;t load photos: {loadError}
        </div>
      )}

      {photos.length === 0 ? (
        <p className="rounded-md border border-gray-200 px-5 py-12 text-center text-gray-500">
          No photos yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {photos.map((p) => (
            <figure
              key={p.id}
              className="group relative overflow-hidden rounded-md border border-gray-200"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={publicUrl(p.path)}
                alt={p.cat || "Unlabeled"}
                loading="lazy"
                className="aspect-square w-full bg-gray-100 object-cover"
              />
              <DeleteCatButton id={p.id} />
              <figcaption className="px-3 py-2 font-display text-xs uppercase tracking-widest text-espn">
                {p.cat === "johnny"
                  ? "Johnny"
                  : p.cat === "stevie"
                    ? "Stevie"
                    : "Unlabeled"}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
