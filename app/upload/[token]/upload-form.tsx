"use client";

import { useRef, useState } from "react";
import { Upload, CheckCircle2, Lock, AlertCircle } from "lucide-react";
import { prepareUploadFile } from "@/lib/image-compress";
import { reviewBadge } from "@/lib/upload-validation";
import { uploadViaToken } from "./actions";

export type UploadItem = { type: string; label: string; hint: string; reviewStatus: string | null; reviewNote: string | null };

function UploadBox({ token, item }: { token: string; item: UploadItem }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const uploadedBefore = item.reviewStatus !== null;
  const badge = reviewBadge(item.reviewStatus);

  async function onPick() {
    const original = inputRef.current?.files?.[0];
    if (!original) return;
    setState("uploading");
    setError(null);
    const file = await prepareUploadFile(original);
    const form = new FormData();
    form.set("file", file);
    try {
      const res = await uploadViaToken(token, item.type, form);
      if (!res.success) {
        setState("error");
        setError(res.error ?? "Upload failed. Please try again.");
      } else {
        setState("done");
      }
    } catch {
      setState("error");
      setError("Upload failed. Check your connection and try again.");
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="card" style={{ marginBottom: 14, padding: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{item.label}</div>
      <p className="muted-text" style={{ fontSize: 13, marginBottom: 10 }}>{item.hint}</p>

      {uploadedBefore && state !== "done" && (
        <p style={{ fontSize: 13, marginBottom: 8, color: badge.tone === "ok" ? "var(--signal-green, #16a34a)" : badge.tone === "warn" ? "var(--danger, #b91c1c)" : undefined }}>
          {badge.text}
          {item.reviewStatus === "rejected" && item.reviewNote ? `: ${item.reviewNote}` : ""}
        </p>
      )}

      <button
        type="button"
        className={state === "done" ? "button-secondary" : "button-primary"}
        style={{ width: "100%", display: "inline-flex", gap: 8, justifyContent: "center", alignItems: "center", minHeight: 48 }}
        disabled={state === "uploading"}
        onClick={() => inputRef.current?.click()}
      >
        {state === "done" ? <CheckCircle2 size={18} /> : <Upload size={18} />}
        {state === "uploading" ? "Uploading…" : state === "done" ? "Uploaded. Tap to replace" : uploadedBefore ? "Upload a new photo" : "Take or choose a photo"}
      </button>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" onChange={onPick} style={{ display: "none" }} />
      {error && (
        <p className="error-text" style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "flex-start" }}>
          <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} /> {error}
        </p>
      )}
    </div>
  );
}

export default function UploadForm({ token, items }: { token: string; items: UploadItem[] }) {
  return (
    <>
      {items.map((item) => (
        <UploadBox key={item.type} token={token} item={item} />
      ))}
      <p className="muted-text" style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
        <Lock size={12} /> Stored securely and used only to verify your rental application.
      </p>
    </>
  );
}
