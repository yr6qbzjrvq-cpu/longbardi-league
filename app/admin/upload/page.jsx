import Link from "next/link";
import AdminLoginForm from "@/components/AdminLoginForm";
import ImageUploadForm from "@/components/ImageUploadForm";
import { isAuthed } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Upload Image" };

export default async function AdminUploadPage() {
  if (!(await isAuthed())) {
    return <AdminLoginForm />;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <Link href="/admin" className="text-sm text-link hover:underline">
          &larr; Back to dashboard
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
          Upload Image
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Put a picture on the site and get back a web address for it. Big
          images are shrunk automatically before they upload.
        </p>
      </div>

      <ImageUploadForm />
    </div>
  );
}
