"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { getConversationMessages, sendReply, type ConversationSummary, type ConversationMessage } from "./actions";

export default function InboxClient({ initialConversations }: { initialConversations: ConversationSummary[] }) {
  const [conversations] = useState(initialConversations);
  const [selected, setSelected] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openConversation(conversation: ConversationSummary) {
    setSelected(conversation);
    setLoadingThread(true);
    setError(null);
    const msgs = await getConversationMessages(
      conversation.customerId,
      conversation.leadId,
      conversation.customerId || conversation.leadId ? null : conversation.phone
    );
    setMessages(msgs);
    setLoadingThread(false);
  }

  async function handleSend() {
    if (!selected || !selected.phone) return;
    setSending(true);
    setError(null);
    const result = await sendReply({
      customerId: selected.customerId,
      leadId: selected.leadId,
      phone: selected.phone,
      channel: selected.channel,
      message: replyText,
    });
    setSending(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't send that message.");
      return;
    }
    setReplyText("");
    // Optimistic append rather than a full re-fetch -- keeps the reply
    // box feeling immediate.
    setMessages((prev) => [...prev, { id: `temp-${Date.now()}`, channel: selected.channel, direction: "outbound", body: replyText, createdAt: new Date().toISOString() }]);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20, height: "70vh" }}>
      <div style={{ overflowY: "auto", borderRight: "1px solid var(--border)" }}>
        {conversations.length === 0 && (
          <p className="muted-text" style={{ fontSize: 14, padding: 12 }}>
            No messages yet.
          </p>
        )}
        {conversations.map((c) => (
          <button
            key={c.key}
            onClick={() => openConversation(c)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: 12,
              border: "none",
              borderBottom: "1px solid var(--border)",
              background: selected?.key === c.key ? "var(--cloud, #f7f9fc)" : "transparent",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14 }}>{c.displayName}</div>
            <div className="muted-text" style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {c.lastDirection === "outbound" ? "You: " : ""}
              {c.lastMessage}
            </div>
            <div className="muted-text" style={{ fontSize: 11, textTransform: "uppercase", marginTop: 2 }}>
              {c.channel} · {new Date(c.lastMessageAt).toLocaleDateString()}
            </div>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {!selected && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted, #667085)" }}>
            <MessageSquare size={32} style={{ marginBottom: 8 }} />
            <p>Select a conversation</p>
          </div>
        )}
        {selected && (
          <>
            <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: 12, marginBottom: 12 }}>
              <strong>{selected.displayName}</strong>{" "}
              <span className="muted-text" style={{ fontSize: 13 }}>
                {selected.phone}
              </span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
              {loadingThread && <p className="muted-text">Loading...</p>}
              {!loadingThread &&
                messages.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      maxWidth: "70%",
                      marginLeft: m.direction === "outbound" ? "auto" : 0,
                      background: m.direction === "outbound" ? "var(--teal)" : "var(--cloud, #f7f9fc)",
                      color: m.direction === "outbound" ? "white" : "var(--text)",
                      borderRadius: 10,
                      padding: "8px 12px",
                      marginBottom: 8,
                      fontSize: 14,
                    }}
                  >
                    {m.body}
                  </div>
                ))}
            </div>
            {error && <p className="error-text" style={{ marginBottom: 8 }}>{error}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Type a reply..."
                style={{ flex: 1 }}
                onKeyDown={(e) => e.key === "Enter" && !sending && handleSend()}
              />
              <button onClick={handleSend} disabled={sending || !replyText.trim()} className="button-primary">
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
