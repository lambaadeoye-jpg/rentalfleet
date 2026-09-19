"use client";

import { useState, useRef } from "react";
import { Upload, CheckCircle2 } from "lucide-react";
import { uploadApplicantDocument } from "./actions";

export default function DocumentUpload({
  customerId,
  documentType,
  label,
}: {
  customerId: string;
  documentType: string;
  label: string;
}) {
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleChange() {
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    setStatus("uploading");
    setError(null);

    const formData = new FormData();
    formData.set("file", file);

    const result = await uploadApplicantDocument(customerId, documentType, formData);

    if (!result.success) {
      setStatus("error");
      setError(result.error ?? "Upload failed.");
      return;
    }
    setStatus("done");
  }

  return (
    <div className="field">
      <label>{label}</label>
      <div
        className="card"
        style={{
          padding: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          cursor: "pointer",
          borderStyle: status === "done" ? "solid" : "dashed",
        }}
        onClick={() => inputRef.current?.click()}
      >
        {status === "done" ? (
          <CheckCircle2 size={20} color="var(--signal-green, #16a34a)" />
        ) : (
          <Upload size={20} color="var(--teal)" />
        )}
        <span style={{ fontSize: 14 }}>
          {status === "uploading" && "Uploading..."}
          {status === "done" && "Uploaded — tap to replace"}
          {status === "idle" && "Tap to upload a photo or PDF"}
          {status === "error" && "Upload failed — tap to try again"}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.pdf"
          onChange={handleChange}
          style={{ display: "none" }}
        />
      </div>
      {error && <p className="error-text" style={{ marginTop: 6 }}>{error}</p>}
    </div>
  );
}
