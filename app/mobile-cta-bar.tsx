"use client";

import { useEffect, useState } from "react";
import { Phone } from "lucide-react";

// Sticky bottom bar on phones. Always offers the main action; adds Call once a real number is live.
// Hides while the form itself is on screen so it never covers the form's own button.
export default function MobileCtaBar({ phoneLive, phoneDisplay, phoneTel }: { phoneLive: boolean; phoneDisplay: string; phoneTel: string }) {
  const [formVisible, setFormVisible] = useState(false);

  useEffect(() => {
    const el = document.getElementById("apply");
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setFormVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (formVisible) return null;
  return (
    <div className="mobile-cta-bar">
      {phoneLive && (
        <a href={`tel:${phoneTel}`} className="mobile-cta-call" aria-label={`Call ${phoneDisplay}`}>
          <Phone size={18} />
          Call
        </a>
      )}
      <a href="#apply" data-cta="mobile_bar" className="mobile-cta-main">Find My Car</a>
    </div>
  );
}
