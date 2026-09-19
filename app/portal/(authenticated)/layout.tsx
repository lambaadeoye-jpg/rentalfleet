import { redirect } from "next/navigation";
import Link from "next/link";
import { Home, Car, Wallet, FileText, LifeBuoy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

const NAV_ITEMS = [
  { href: "/portal", label: "Home", icon: Home },
  { href: "/portal/rental", label: "Rental", icon: Car },
  { href: "/portal/money", label: "Money", icon: Wallet },
  { href: "/portal/documents", label: "Docs", icon: FileText },
  { href: "/portal/support", label: "Help", icon: LifeBuoy },
] as const;

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Second line of defense beyond middleware -- same pattern as the staff
  // portal's layout.
  if (!user) {
    redirect("/portal/login");
  }

  return (
    <div style={{ minHeight: "100vh", paddingBottom: 76, background: "var(--cloud)" }}>
      <header
        style={{
          background: "var(--midnight)",
          color: "white",
          padding: "16px 20px",
          position: "sticky",
          top: 0,
          zIndex: 40,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 15 }}>My Account</span>
      </header>

      <main>{children}</main>

      {/* Mobile-first bottom tab bar -- the customer portal is explicitly
          mobile-first per the design system spec, unlike the staff portal's
          desktop-first sidebar. */}
      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "white",
          borderTop: "1px solid var(--border)",
          display: "flex",
          zIndex: 50,
        }}
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                padding: "10px 0",
                color: "var(--text-secondary)",
                textDecoration: "none",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              <Icon size={20} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
