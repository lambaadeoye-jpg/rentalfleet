"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RUNNER_NAV } from "@/lib/runner-access";

// Bottom bar for the phone: the four things a runner needs, nothing else.
export default function RunnerNav() {
  const pathname = usePathname();
  return (
    <nav className="runner-nav" aria-label="Runner">
      {RUNNER_NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link key={item.href} href={item.href} className={active ? "runner-nav__link runner-nav__link--active" : "runner-nav__link"} aria-current={active ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
