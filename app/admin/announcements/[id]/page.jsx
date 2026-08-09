import Link from "next/link";
import { notFound } from "next/navigation";
import AdminLoginForm from "@/components/AdminLoginForm";
import AnnouncementForm from "@/components/AnnouncementForm";
import DeleteAnnouncementButton from "@/components/DeleteAnnouncementButton";
import { isAuthed } from "@/lib/auth";
import { getAnnouncementById } from "@/lib/announcements";

export const dynamic = "force-dynamic";

export const metadata = { title: "Edit Announcement" };

export default async function EditAnnouncementPage({ params }) {
  if (!(await isAuthed())) {
    return <AdminLoginForm />;
  }

  const { id } = await params;
  const announcement = await getAnnouncementById(id);
  if (!announcement) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <Link
          href="/admin/announcements"
          className="text-sm text-link hover:underline"
        >
          &larr; All announcements
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
          Edit Announcement
        </h1>
      </div>

      <AnnouncementForm announcement={announcement} />

      <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4">
        <Link
          href="/announcements"
          className="font-display text-xs uppercase tracking-widest text-link hover:underline"
        >
          View on site &rarr;
        </Link>
        <DeleteAnnouncementButton
          id={announcement.id}
          title={announcement.title}
        />
      </div>
    </div>
  );
}
