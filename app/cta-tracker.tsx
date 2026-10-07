"use client";

import { useEffect } from "react";
import { rememberCta } from "@/lib/attribution";

// Notes which button was last clicked (any link marked data-cta) so the lead can be tagged with it.
export default function CtaTracker() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-cta]");
      const name = el?.getAttribute("data-cta");
      if (name) rememberCta(name);
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  return null;
}
