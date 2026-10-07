import { getConversations } from "./actions";
import InboxClient from "./inbox-client";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const conversations = await getConversations();

  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Inbox</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Messages across every connected channel, in one place. Currently live: SMS.
      </p>
      <InboxClient initialConversations={conversations} />
    </div>
  );
}
