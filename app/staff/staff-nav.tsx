"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, ClipboardList, Car, ShieldCheck, UserCog, DollarSign, KeyRound, Megaphone, User, IdCard, Gift } from "lucide-react";
import SignOutButton from "./(authenticated)/dashboard/sign-out-button";

const NAV_ITEMS = [
  { href: "/staff/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/staff/pickups", label: "Pickups & Dropoffs", icon: KeyRound },
  { href: "/staff/leads", label: "Leads", icon: Users },
  { href: "/staff/applications", label: "Applications", icon: ClipboardList },
  { href: "/staff/customers", label: "Customers", icon: IdCard },
  { href: "/staff/referrals", label: "Referrals", icon: Gift },
  { href: "/staff/fleet", label: "Fleet", icon: Car },
  { href: "/staff/insurance", label: "Insurance", icon: ShieldCheck },
  { href: "/staff/team", label: "Team", icon: UserCog },
  { href: "/staff/pricing", label: "Pricing", icon: DollarSign },
  { href: "/staff/settings", label: "Marketing Settings", icon: Megaphone },
  { href: "/staff/profile", label: "My Profile", icon: User },
] as const;

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

  return (
    <nav
      style={{
        width: 220,
        background: "var(--midnight)",
        color: "white",
        display: "flex",
        flexDirection: "column",
        padding: "20px 12px",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", marginBottom: 28 }}>
        <Car size={20} color="var(--teal)" />
        <span style={{ fontWeight: 700, fontSize: 14 }}>{tenantName}</span>
      </div>

      <div style={{ flex: 1 }}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const badgeCount = badgeCounts[item.href] ?? 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                marginBottom: 4,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
                color: isActive ? "white" : "rgba(255,255,255,0.65)",
                background: isActive ? "rgba(0,169,157,0.18)" : "transparent",
              }}
            >
              <Icon size={17} />
              <span style={{ flex: 1 }}>{item.label}</span>
              {badgeCount > 0 && (
                <span
                  style={{
                    background: "var(--warning, #f59e0b)",
                    color: "#1a1a1a",
                    fontSize: 11,
                    fontWeight: 800,
                    borderRadius: 10,
                    padding: "1px 7px",
                    minWidth: 18,
                    textAlign: "center",
                  }}
                >
                  {badgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 14, marginTop: 14 }}>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginBottom: 2 }}>{userEmail}</p>
        {roleName && (
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 10, textTransform: "capitalize" }}>
            {roleName}
          </p>
        )}
        <SignOutButton />
      </div>
    </nav>
  );
}
