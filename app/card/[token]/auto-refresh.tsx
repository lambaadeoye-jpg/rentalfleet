"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Re-checks the payment every 3 seconds, up to 20 times, while the webhook catches up. */
export default function AutoRefresh() {
  const router = useRouter();
  const n = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      n.current += 1;
      if (n.current > 20) { clearInterval(id); return; }
      router.refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
