"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Re-checks the payment every 3 seconds, up to 20 times, while the webhook catches up. */
export default function AutoRefresh() {
  const router = useRouter();
  const n = useRef(0);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      n.current += 1;
      if (n.current > 20) { clearInterval(id); setGaveUp(true); return; }
      router.refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [router]);
  if (!gaveUp) return null;
  return (
    <p className="muted-text" style={{ marginBottom: 12, fontWeight: 600 }}>
      This is taking longer than usual. If your card was charged, you don&rsquo;t need to do anything or pay again.
      We&rsquo;ll confirm by text or email. You can close this page.
    </p>
  );
}
