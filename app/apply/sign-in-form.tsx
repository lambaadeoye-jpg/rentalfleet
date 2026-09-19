"use client";

import { useState, type FormEvent } from "react";
import { Mail, CheckCircle2 } from "lucide-react";
import { sendMagicLink } from "./actions";

export default function SignInForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await sendMagicLink(email);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="card" style={{ maxWidth: 420, margin: "80px auto", textAlign: "center", padding: 40 }}>
        <CheckCircle2 size={40} color="var(--teal)" style={{ marginBottom: 12 }} />
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Check your email</h1>
        <p className="muted-text">
          We sent a secure sign-in link to <strong>{email}</strong>. Open it on this device to
          continue your application.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: "80px auto", padding: "0 24px" }}>
      <form onSubmit={handleSubmit} className="card">
        <Mail size={28} color="var(--teal)" style={{ marginBottom: 12 }} />
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Let&apos;s get you on the road.</h1>
        <p className="muted-text" style={{ marginBottom: 20 }}>
          Enter your email and we&apos;ll send a secure link to start or continue your
          application — no password needed.
        </p>
        <label htmlFor="email" style={{ display: "block", marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Email</span>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            style={{ marginTop: 4 }}
          />
        </label>
        {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}
        <button type="submit" className="button-primary" disabled={loading} style={{ width: "100%" }}>
          {loading ? "Sending..." : "Continue"}
        </button>
      </form>
    </div>
  );
}
