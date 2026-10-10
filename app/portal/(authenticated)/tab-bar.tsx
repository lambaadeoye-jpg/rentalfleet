"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Car, Wallet, FileText, LifeBuoy } from "lucide-react";

const NAV_ITEMS = [
  { href: "/portal", label: "Home", icon: Home },
  { href: "/portal/rental", label: "Rental", icon: Car },
  { href: "/portal/money", label: "Money", icon: Wallet },
  { href: "/portal/documents", label: "Documents", icon: FileText },
  { href: "/portal/support", label: "Support", icon: LifeBuoy },
] as const;

// Bottom tab bar for the customer portal. The current tab is highlighted; Home only matches /portal itself.
// Pages reached from a tab (profile, rules, referrals) light up no tab, which is correct.
export default function PortalTabBar() {
  const pathname = usePathname();
  return (
    <nav className="portal-tabs" aria-label="Main">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = item.href === "/portal" ? pathname === "/portal" : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link key={item.href} href={item.href} className={active ? "portal-tab portal-tab--active" : "portal-tab"} aria-current={active ? "page" : undefined}>
            <Icon size={20} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
