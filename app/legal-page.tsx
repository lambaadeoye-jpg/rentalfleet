import type { ReactNode } from "react";
import { PHONE_DISPLAY, PHONE_TEL, SUPPORT_EMAIL } from "@/lib/site-config";

export const LEGAL_UPDATED = "October 7, 2026";

export default function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px 80px", lineHeight: 1.65 }}>
      <p style={{ marginBottom: 24 }}>
        <a href="/" style={{ fontSize: 14 }}>← Zivo</a>
      </p>
      <h1 style={{ fontSize: 30, marginBottom: 6 }}>{title}</h1>
      <p className="muted-text" style={{ fontSize: 14, marginBottom: 32 }}>Last updated {LEGAL_UPDATED}</p>
      {children}
      <h2 style={{ fontSize: 20, margin: "32px 0 8px" }}>Contact</h2>
      <p>
        Zivo Mobility LLC, Middle Tennessee. Call <a href={`tel:${PHONE_TEL}`}>{PHONE_DISPLAY}</a>, email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>, or
        sign in to your account at <a href="/portal/login">rentzivo.com/portal</a> and send us a message.
      </p>
    </main>
  );
}
