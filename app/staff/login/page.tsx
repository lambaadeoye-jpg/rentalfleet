"use client";

import { useState, type FormEvent } from "react";
import { Mail, CheckCircle2 } from "lucide-react";
import { sendStaffMagicLink } from "../actions";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await sendStaffMagicLink(email);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="card" style={{ width: 360, textAlign: "center" }}>
          <CheckCircle2 size={40} color="var(--teal)" style={{ marginBottom: 12 }} />
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Check your email</h1>
          <p className="muted-text">
            We sent a secure sign-in link to <strong>{email}</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <form onSubmit={handleSubmit} className="card" style={{ width: 360 }}>
        <Mail size={28} color="var(--teal)" style={{ marginBottom: 12 }} />
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Fleet Rental OS</h1>
        <p className="muted-text" style={{ marginBottom: 20 }}>
          Enter your email and we&apos;ll send a secure sign-in link -- no password needed.
        </p>

        <label style={{ display: "block", marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
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
