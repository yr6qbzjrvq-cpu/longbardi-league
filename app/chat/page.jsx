import ChatRoom from "@/components/ChatRoom";

export const metadata = { title: "League Chat" };

export default function ChatPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="mb-2 border-b-2 border-espn pb-3 font-display text-3xl font-semibold uppercase tracking-wide text-gray-900">
        League Chat
      </h1>
      <p className="mb-6 text-sm text-gray-500">
        No account needed — enter a name and talk. Messages are visible to
        everyone with the link.
      </p>
      <ChatRoom />
    </div>
  );
}
