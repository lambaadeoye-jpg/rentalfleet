"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Mail, CheckCircle2, KeyRound } from "lucide-react";
import { sendStaffMagicLink, signInWithPassword } from "../actions";

export default function StaffLoginForm({ inactiveTimeout }: { inactiveTimeout: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"magic-link" | "password">("magic-link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleMagicLink(e: FormEvent) {
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

  async function handlePassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signInWithPassword(email, password);
    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    router.push("/staff/dashboard");
    router.refresh();
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
      <form onSubmit={mode === "magic-link" ? handleMagicLink : handlePassword} className="card" style={{ width: 360 }}>
        {mode === "magic-link" ? (
          <Mail size={28} color="var(--teal)" style={{ marginBottom: 12 }} />
        ) : (
          <KeyRound size={28} color="var(--teal)" style={{ marginBottom: 12 }} />
        )}
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Fleet Rental OS</h1>

        {inactiveTimeout && (
          <p style={{ fontSize: 13, color: "var(--warning, #b45309)", marginBottom: 12 }}>
            You were signed out after a period of inactivity. Sign in again to continue.
          </p>
        )}

        <p className="muted-text" style={{ marginBottom: 20 }}>
          {mode === "magic-link"
            ? "Enter your email and we'll send a secure sign-in link -- no password needed."
            : "Sign in with your email and password."}
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

        {mode === "password" && (
          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={{ marginTop: 4 }}
            />
          </label>
        )}

        {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

        <button type="submit" className="button-primary" disabled={loading} style={{ width: "100%", marginBottom: 12 }}>
          {loading ? "Please wait..." : "Continue"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "magic-link" ? "password" : "magic-link");
            setError(null);
          }}
          style={{ background: "none", border: "none", color: "var(--teal)", fontSize: 13, cursor: "pointer", width: "100%" }}
        >
          {mode === "magic-link" ? "Sign in with a password instead" : "Send me a sign-in link instead"}
        </button>
      </form>
    </div>
  );
}
