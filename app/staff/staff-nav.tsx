"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, ClipboardList, Car } from "lucide-react";
import SignOutButton from "./(authenticated)/dashboard/sign-out-button";

const NAV_ITEMS = [
  { href: "/staff/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/staff/leads", label: "Leads", icon: Users },
  { href: "/staff/applications", label: "Applications", icon: ClipboardList },
] as const;

export default function StaffNav({
  tenantName,
  userEmail,
  roleName,
}: {
  tenantName: string;
  userEmail: string;
  roleName?: string;
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
              {item.label}
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
