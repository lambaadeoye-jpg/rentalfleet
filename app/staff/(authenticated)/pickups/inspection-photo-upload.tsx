"use client";

import { useState, useRef } from "react";
import { Camera } from "lucide-react";
import { uploadInspectionPhoto } from "./inspection-actions";

export default function InspectionPhotoUpload({
  rentalId,
  vehicleId,
  inspectionType,
}: {
  rentalId: string;
  vehicleId: string;
  inspectionType: "pickup" | "return";
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadInspectionPhoto(rentalId, vehicleId, inspectionType, formData);
    setUploading(false);

    if (!result.success) {
      setError(result.error ?? "Couldn't upload that photo.");
      return;
    }
    setCount((c) => c + 1);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
        {inspectionType === "pickup" ? "Pre-pickup" : "Return"} photos {count > 0 && `(${count} uploaded)`}
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        disabled={uploading}
        style={{ fontSize: 13 }}
      />
      {uploading && <p className="muted-text" style={{ fontSize: 12, marginTop: 4 }}>Uploading...</p>}
      {error && <p className="error-text" style={{ fontSize: 12, marginTop: 4 }}>{error}</p>}
      <p className="muted-text" style={{ fontSize: 12, marginTop: 4 }}>
        <Camera size={12} style={{ display: "inline", marginRight: 4 }} />
        Optional but recommended -- real protection in a damage dispute.
      </p>
    </div>
  );
}
