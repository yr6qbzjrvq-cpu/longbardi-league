import CatUploadForm from "@/components/CatUploadForm";
import DeleteCatButton from "@/components/DeleteCatButton";
import { isAuthed } from "@/lib/auth";
import { getPublicClient, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const metadata = { title: "Cats" };

function publicUrl(path) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/cat-photos/${path}`;
}

export default async function CatsPage() {
  const admin = await isAuthed();

  let photos = [];
  const supabase = getPublicClient();
  if (supabase) {
    const { data } = await supabase
      .from("cat_photos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    photos = data || [];
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="mb-2 border-b-2 border-espn pb-3 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
        Cats
      </h1>
      <p className="mb-8 text-sm text-gray-500">
        Post a picture of your cat. Or any cat.
      </p>

      {!isSupabaseConfigured() ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Photo uploads aren&apos;t connected yet.
        </p>
      ) : (
        <>
          <CatUploadForm />

          {photos.length === 0 ? (
            <p className="rounded-md border border-gray-200 px-5 py-12 text-center text-gray-500">
              No cats yet. Be the first.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {photos.map((p) => (
                <figure
                  key={p.id}
                  className="group relative overflow-hidden rounded-md border border-gray-200"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={publicUrl(p.path)}
                    alt={p.caption || `Cat posted by ${p.name}`}
                    loading="lazy"
                    className="aspect-square w-full bg-gray-100 object-cover"
                  />
                  {admin && <DeleteCatButton id={p.id} />}
                  <figcaption className="px-3 py-2">
                    {p.caption && (
                      <p className="text-sm leading-snug text-gray-800">
                        {p.caption}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-gray-500">
                      {p.name} &middot;{" "}
                      {new Date(p.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
