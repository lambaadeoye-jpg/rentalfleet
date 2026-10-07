"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { missingInitials, SIGNATURE_STATEMENT, type RenderedAgreement } from "@/lib/agreement";
import { signAgreement } from "./actions";

export default function SignForm({ token, rendered }: { token: string; rendered: RenderedAgreement }) {
  const router = useRouter();
  const [initials, setInitials] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = missingInitials(rendered.clauses, initials);

  async function submit() {
    setError(null);
    if (missing.length) { setError(`Please initial clause${missing.length > 1 ? "s" : ""} ${missing.join(", ")}.`); return; }
    if (!consent) { setError("Please confirm you agree to sign electronically."); return; }
    if (name.trim().split(/\s+/).length < 2) { setError("Type your full legal name."); return; }
    setBusy(true);
    const res = await signAgreement(token, name, initials, consent);
    setBusy(false);
    if (!res.success) { setError(res.error ?? "We couldn’t record your signature."); return; }
    router.refresh();
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{rendered.intro}</p>
      </div>
      {rendered.clauses.map((c) => (
        <div key={c.number} className="card" style={{ marginBottom: 12, borderColor: c.initial ? "var(--teal)" : undefined }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{c.number}. {c.title}</h2>
          <p style={{ fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{c.body}</p>
          {c.initial && (
            <label className="field" style={{ marginTop: 12, maxWidth: 220 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>Your initials for clause {c.number}</span>
              <input
                value={initials[String(c.number)] ?? ""}
                onChange={(e) => setInitials((x) => ({ ...x, [String(c.number)]: e.target.value.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() }))}
                autoCapitalize="characters" autoComplete="off" inputMode="text" maxLength={4} placeholder="e.g. AB"
              />
            </label>
          )}
        </div>
      ))}

      <div className="card" style={{ marginTop: 18 }}>
        <label className="checkbox-item" style={{ alignItems: "flex-start", marginBottom: 12, fontSize: 14 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
          <span>{SIGNATURE_STATEMENT} I agree to receive this agreement and related notices electronically.</span>
        </label>
        <label className="field">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Type your full legal name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        {error && <p className="error-text" style={{ marginBottom: 10 }}>{error}</p>}
        <button className="button-primary" style={{ width: "100%", minHeight: 48 }} disabled={busy} onClick={submit}>
          {busy ? "Signing…" : "Sign agreement"}
        </button>
        <p className="muted-text" style={{ fontSize: 12, marginTop: 10 }}>
          We record the time, your device and network address with your signature, and keep a copy you can download.
        </p>
      </div>
    </>
  );
}
