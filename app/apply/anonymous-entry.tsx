"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { beginAnonymousSession } from "./actions";

export default function AnonymousEntry() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    beginAnonymousSession().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error ?? "Couldn't start your application. Please try again.");
        return;
      }
      // Reload so the server component now sees a real (anonymous) user
      // and proceeds straight into the workspace -- no page navigation the
      // applicant has to notice or act on.
      router.refresh();
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return (
      <div style={{ maxWidth: 420, margin: "80px auto", padding: "0 24px", textAlign: "center" }}>
        <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>
        <button onClick={() => window.location.reload()} className="button-primary">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: "80px auto", padding: "0 24px", textAlign: "center" }}>
      <p className="muted-text">Setting up your application...</p>
    </div>
  );
}
