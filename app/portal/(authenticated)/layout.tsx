import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PortalSignOut from "./sign-out";
import PortalTabBar from "./tab-bar";
import { BrandLogo } from "@/app/brand-logo";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Second line of defense beyond middleware -- same pattern as the staff
  // portal’s layout.
  if (!user) {
    redirect("/portal/login");
  }

  return (
    <div style={{ minHeight: "100vh", paddingBottom: "calc(76px + env(safe-area-inset-bottom))", background: "var(--cloud)" }}>
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 720, margin: "0 auto" }}>
          <a href="/portal" aria-label="Zivo — my account" style={{ display: "flex" }}><BrandLogo variant="white" width={120} /></a>
          <PortalSignOut />
        </div>
      </header>

      <main className="app-shell" style={{ maxWidth: 720, margin: "0 auto" }}>{children}</main>

      <PortalTabBar />
    </div>
  );
}
