"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard, Users, ClipboardList, Car, ShieldCheck, UserCog, DollarSign, KeyRound, Settings, User,
  IdCard, Gift, Download, Receipt, AlertTriangle, MessageSquare, ShieldAlert, Undo2, Filter, CalendarClock,
  Wrench, Bell,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import SignOutButton from "./(authenticated)/dashboard/sign-out-button";
import GlobalSearchBar from "./global-search-bar";
import { sentenceCase } from "@/lib/format-label";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { title: string | null; adminOnly?: boolean; items: NavItem[] };

// Grouped by the job staff are doing, not by database table. Every item here
// is a page that exists today -- new pages are added to their group as they ship.
export const NAV_GROUPS: NavGroup[] = [
  {
    title: null,
    items: [
      { href: "/staff/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/staff/inbox", label: "Inbox", icon: MessageSquare },
    ],
  },
  {
    title: "Sales",
    items: [
      { href: "/staff/leads", label: "Leads", icon: Users },
      { href: "/staff/applications", label: "Applications", icon: ClipboardList },
      { href: "/staff/customers", label: "Customers", icon: IdCard },
      { href: "/staff/referrals", label: "Referrals", icon: Gift },
      { href: "/staff/funnel", label: "Funnel", icon: Filter },
      { href: "/staff/red-flags", label: "Red flags", icon: AlertTriangle },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/staff/pickups", label: "Pickups & dropoffs", icon: KeyRound },
      { href: "/staff/fleet", label: "Fleet", icon: Car },
      { href: "/staff/fleet/maintenance", label: "Maintenance", icon: Wrench },
      { href: "/staff/recovery", label: "Recovery", icon: ShieldAlert },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/staff/charges", label: "Charges", icon: Receipt },
      { href: "/staff/billing", label: "Weekly billing", icon: CalendarClock },
      { href: "/staff/refunds", label: "Refunds", icon: Undo2 },
      { href: "/staff/insurance", label: "Insurance", icon: ShieldCheck },
    ],
  },
  {
    title: "Admin",
    adminOnly: true,
    items: [
      { href: "/staff/team", label: "Team", icon: UserCog },
      { href: "/staff/pricing", label: "Pricing", icon: DollarSign },
      { href: "/staff/settings", label: "Settings", icon: Settings },
      { href: "/staff/export", label: "Export", icon: Download },
    ],
  },
  {
    title: null,
    items: [{ href: "/staff/profile", label: "My profile", icon: User }],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

// An item is active when it is the longest matching prefix, so
// /staff/fleet/maintenance lights up Maintenance and not Fleet as well.
function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const item of ALL_ITEMS) {
    const match = pathname === item.href || pathname.startsWith(item.href + "/");
    if (match && (!best || item.href.length > best.length)) best = item.href;
  }
  return best;
}

function NotificationsBell({ items }: { items: { href: string; label: string; count: number }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const total = items.reduce((sum, i) => sum + i.count, 0);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={ref} className="nav-bell">
      <button
        type="button"
        className="nav-bell__button"
        aria-label={total > 0 ? `Needs attention: ${total}` : "Nothing needs attention"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={17} />
        {total > 0 && <span className="nav-bell__count">{total > 99 ? "99+" : total}</span>}
      </button>
      {open && (
        <div className="nav-bell__panel" role="menu">
          <div className="nav-bell__title">Needs attention</div>
          {items.length === 0 ? (
            <div className="nav-bell__empty">You&apos;re all caught up.</div>
          ) : (
            items.map((i) => (
              <Link key={i.href} href={i.href} className="nav-bell__row" role="menuitem" onClick={() => setOpen(false)}>
                <span>{i.label}</span>
                <span className="nav-badge">{i.count}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function StaffNav({
  tenantName,
  userEmail,
  roleName,
  badgeCounts = {},
}: {
  tenantName: string;
  userEmail: string;
  roleName?: string;
  badgeCounts?: Record<string, number>;
}) {
  const pathname = usePathname();
  const current = activeHref(pathname);
  // Only "admin" exists beyond field staff today (field staff get their own
  // layout), so this hides nothing yet. It is here so a future role such as
  // "manager" doesn't see Pricing and Team without a deliberate decision.
  const isAdmin = roleName === "admin";

  const attention = ALL_ITEMS.map((i) => ({ href: i.href, label: i.label, count: badgeCounts[i.href] ?? 0 })).filter(
    (i) => i.count > 0
  );

  return (
    <nav className="staff-nav">
      <div className="staff-nav__brand">
        <Car size={20} color="var(--teal)" />
        <span className="staff-nav__name">{tenantName}</span>
        <NotificationsBell items={attention} />
      </div>

      <GlobalSearchBar />

      <div className="staff-nav__scroll">
        {NAV_GROUPS.filter((g) => !g.adminOnly || isAdmin).map((group, gi) => (
          <div key={group.title ?? `g${gi}`} className="staff-nav__group">
            {group.title && <div className="staff-nav__label">{group.title}</div>}
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = item.href === current;
              const badgeCount = badgeCounts[item.href] ?? 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={isActive ? "staff-nav__link staff-nav__link--active" : "staff-nav__link"}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon size={17} />
                  <span className="staff-nav__text">{item.label}</span>
                  {badgeCount > 0 && <span className="nav-badge">{badgeCount}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className="staff-nav__footer">
        <p className="staff-nav__email">{userEmail}</p>
        {roleName && <p className="staff-nav__role">{sentenceCase(roleName)}</p>}
        <SignOutButton />
      </div>
    </nav>
  );
}
