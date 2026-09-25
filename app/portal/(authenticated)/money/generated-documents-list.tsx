"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { getDocumentDownloadUrl, type GeneratedDocumentSummary } from "./documents-actions";

export default function GeneratedDocumentsList({ documents }: { documents: GeneratedDocumentSummary[] }) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function handleDownload(doc: GeneratedDocumentSummary) {
    setLoadingId(doc.id);
    const url = await getDocumentDownloadUrl(doc.storageKey);
    setLoadingId(null);
    if (url) window.open(url, "_blank");
  }

  if (documents.length === 0) {
    return <p className="muted-text" style={{ fontSize: 14 }}>No receipts or invoices yet.</p>;
  }

  return (
    <div>
      {documents.map((d) => (
        <button
          key={d.id}
          onClick={() => handleDownload(d)}
          disabled={loadingId === d.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
            padding: "8px 0",
            background: "none",
            border: "none",
            borderBottom: "1px solid var(--border)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            <FileText size={14} />
            <span style={{ textTransform: "capitalize" }}>{d.documentType}</span> —{" "}
            {new Date(d.generatedAt).toLocaleDateString()}
          </span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>
            {loadingId === d.id ? "..." : d.amount != null ? `$${Number(d.amount).toFixed(2)}` : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
