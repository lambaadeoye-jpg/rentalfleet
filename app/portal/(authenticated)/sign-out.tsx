"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function PortalSignOut() {
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      await createClient().auth.signOut();
    } catch {
      // Even if the call fails, leave the page; the next load re-checks the session.
    }
    window.location.assign("/portal/login");
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={busy}
      style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.4)", color: "white", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, minHeight: 36 }}
    >
      {busy ? "Signing out..." : "Sign out"}
    </button>
  );
}
