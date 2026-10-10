// Portal hosts. One app serves every portal; the host name decides who may use it.
//   my.<root>     renters           (pages under /portal)
//   admin.<root>  owner / admin     (pages under /staff)
//   team.<root>   manager / VA      (pages under /staff)
//   field.<root>  field runners     (pages under /staff)
//   <root>        marketing site, apply flow, legal pages, public token links, webhooks
// Everything here is OFF unless NEXT_PUBLIC_SUBDOMAINS=on, so deploying the code changes nothing until DNS,
// the Supabase redirect list and that switch are all in place. Pure functions only (safe in the proxy).

export type Portal = "site" | "my" | "admin" | "team" | "field";
export type StaffPortal = "admin" | "team" | "field";

const SUBS: Record<Exclude<Portal, "site">, string> = { my: "my", admin: "admin", team: "team", field: "field" };

export function subdomainsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SUBDOMAINS === "on";
}

/** Root domain, with port when testing locally (e.g. "localhost:3000"). */
export function rootDomain(): string {
  return (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "rentzivo.com").toLowerCase();
}

function scheme(): string {
  return rootDomain().startsWith("localhost") ? "http" : "https";
}

/** Which portal a Host header belongs to. Any host we don't recognise (Netlify previews, localhost) is "site". */
export function portalForHost(host: string | null | undefined): Portal {
  if (!host) return "site";
  const h = host.toLowerCase();
  const root = rootDomain();
  for (const p of Object.keys(SUBS) as Exclude<Portal, "site">[]) {
    if (h === `${SUBS[p]}.${root}`) return p;
  }
  return "site";
}

export function originFor(portal: Portal): string {
  const root = rootDomain();
  return portal === "site" ? `${scheme()}://${root}` : `${scheme()}://${SUBS[portal]}.${root}`;
}

/** The portal a staff role signs in on. Admin → admin., field_staff → field., every other office role → team. */
export function portalForRole(role: string | null | undefined): StaffPortal {
  if (role === "admin") return "admin";
  if (role === "field_staff") return "field";
  return "team";
}

/** For someone with several memberships: the most powerful one decides. */
export function portalForRoles(roles: (string | null | undefined)[]): StaffPortal {
  if (roles.includes("admin")) return "admin";
  if (roles.some((r) => r && r !== "field_staff")) return "team";
  return "field";
}

export type HostAction = { kind: "allow" } | { kind: "redirect"; portal: Portal; path: string };

const SHARED_PREFIXES = ["/api", "/auth", "/_next"];

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

/**
 * Decide what a request for `pathname` on `portal` should do. "allow" means serve it as normal.
 * Files (anything with an extension) and /api, /auth, /_next are allowed everywhere so images, webhooks and
 * sign-in links work on every host.
 */
export function hostAction(portal: Portal, pathname: string): HostAction {
  if (!subdomainsEnabled()) return { kind: "allow" };
  const shared = SHARED_PREFIXES.some((p) => under(pathname, p)) || /\.[a-z0-9]{2,5}$/i.test(pathname);

  if (portal === "site") {
    if (under(pathname, "/portal")) return { kind: "redirect", portal: "my", path: pathname };
    if (under(pathname, "/staff")) return { kind: "redirect", portal: "admin", path: pathname };
    return { kind: "allow" };
  }
  if (shared) return { kind: "allow" };

  if (portal === "my") {
    if (pathname === "/") return { kind: "redirect", portal: "my", path: "/portal" };
    if (under(pathname, "/portal") || under(pathname, "/apply")) return { kind: "allow" };
    if (under(pathname, "/staff")) return { kind: "redirect", portal: "admin", path: pathname };
    return { kind: "redirect", portal: "site", path: pathname };
  }
  // Staff hosts.
  if (pathname === "/") return { kind: "redirect", portal, path: "/staff/dashboard" };
  if (under(pathname, "/staff")) return { kind: "allow" };
  if (under(pathname, "/portal")) return { kind: "redirect", portal: "my", path: pathname };
  return { kind: "redirect", portal: "site", path: pathname };
}

/** Pages only the owner/admin may open. A manager who types one in is sent to the dashboard. */
const ADMIN_ONLY = ["/staff/team", "/staff/pricing", "/staff/settings", "/staff/export"];
export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY.some((p) => under(pathname, p));
}
