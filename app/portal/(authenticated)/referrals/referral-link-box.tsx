"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

export default function ReferralLinkBox({ referralLink }: { referralLink: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail (permissions, older browsers) -- the
      // link text is still selectable/visible either way, so this isn't
      // a dead end even if the copy button itself doesn't work.
    }
  }

  return (
    <div className="card">
      <p className="muted-text" style={{ fontSize: 13, marginBottom: 8 }}>Your referral link</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input readOnly value={referralLink} style={{ fontSize: 13, flex: 1 }} onClick={(e) => e.currentTarget.select()} />
        <button onClick={handleCopy} className="button-secondary" style={{ color: "var(--text)", borderColor: "var(--border)", flexShrink: 0 }}>
          {copied ? <Check size={16} color="var(--signal-green, #16a34a)" /> : <Copy size={16} />}
        </button>
      </div>
    </div>
  );
}
