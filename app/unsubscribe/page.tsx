import type { Metadata } from "next";
import { verifyUnsubscribeToken, maskEmail } from "@/lib/unsubscribe";
import { SUPPORT_EMAIL } from "@/lib/site-config";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string; done?: string }> }) {
  const { t, done } = await searchParams;
  const email = t ? verifyUnsubscribeToken(t) : null;
  const box = { maxWidth: 460, margin: "80px auto", padding: "0 24px", textAlign: "center", lineHeight: 1.6 } as const;

  if (done) {
    return (
      <main style={box}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>You&apos;re unsubscribed</h1>
        <p className="muted-text">We won&apos;t send you marketing emails anymore. Messages about an active application or rental can still be sent.</p>
        <p style={{ marginTop: 20 }}><a href="/">Back to Zivo</a></p>
      </main>
    );
  }
  if (!email) {
    return (
      <main style={box}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>This link isn&apos;t valid</h1>
        <p className="muted-text">Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we&apos;ll take you off the list.</p>
      </main>
    );
  }
  return (
    <main style={box}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Unsubscribe</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>Stop marketing emails to {maskEmail(email)}?</p>
      <form action="/api/unsubscribe" method="post">
        <input type="hidden" name="t" value={t} />
        <button type="submit" className="button-primary">Yes, unsubscribe me</button>
      </form>
    </main>
  );
}
