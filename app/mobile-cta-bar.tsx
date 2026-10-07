"use client";

import { useEffect, useState } from "react";
import { Phone } from "lucide-react";

// Sticky bottom bar on phones: Call plus the main action. Hides while either form is on screen
// so it never covers a form's own button. The main action scrolls to the nearest form.
export default function MobileCtaBar({ phoneLive, phoneDisplay, phoneTel }: { phoneLive: boolean; phoneDisplay: string; phoneTel: string }) {
  const [formVisible, setFormVisible] = useState(false);

  useEffect(() => {
    const els = ["apply", "apply-bottom"].map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const seen = new Set<Element>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target));
      setFormVisible(seen.size > 0);
    }, { threshold: 0.15 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  function goToForm(e: React.MouseEvent) {
    const top = document.getElementById("apply");
    const bottom = document.getElementById("apply-bottom");
    if (!top || !bottom) return; // plain anchor behavior
    e.preventDefault();
    // Past the hero? The lower form is closer.
    const target = window.scrollY > top.offsetTop + top.offsetHeight ? bottom : top;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (formVisible) return null;
  return (
    <div className="mobile-cta-bar">
      {phoneLive && (
        <a href={`tel:${phoneTel}`} className="mobile-cta-call" aria-label={`Call ${phoneDisplay}`}>
          <Phone size={18} />
          Call
        </a>
      )}
      <a href="#apply" onClick={goToForm} data-cta="mobile_bar" className="mobile-cta-main">Find My Car</a>
    </div>
  );
}
