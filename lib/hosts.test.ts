import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hostAction, isAdminOnlyPath, originFor, portalForHost, portalForRole, portalForRoles } from "./hosts";

const ENV = { ...process.env };
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUBDOMAINS = "on";
  process.env.NEXT_PUBLIC_ROOT_DOMAIN = "rentzivo.com";
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("portalForHost", () => {
  it("maps known hosts and treats everything else as the site", () => {
    expect(portalForHost("my.rentzivo.com")).toBe("my");
    expect(portalForHost("ADMIN.rentzivo.com")).toBe("admin");
    expect(portalForHost("team.rentzivo.com")).toBe("team");
    expect(portalForHost("field.rentzivo.com")).toBe("field");
    expect(portalForHost("rentzivo.com")).toBe("site");
    expect(portalForHost("deploy-preview-3--x.netlify.app")).toBe("site");
    expect(portalForHost("my.rentzivo.com.evil.com")).toBe("site");
    expect(portalForHost(null)).toBe("site");
  });
  it("builds origins", () => {
    expect(originFor("my")).toBe("https://my.rentzivo.com");
    expect(originFor("site")).toBe("https://rentzivo.com");
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "localhost:3000";
    expect(originFor("field")).toBe("http://field.localhost:3000");
    expect(portalForHost("team.localhost:3000")).toBe("team");
  });
});

describe("roles", () => {
  it("routes roles to hosts", () => {
    expect(portalForRole("admin")).toBe("admin");
    expect(portalForRole("manager")).toBe("team");
    expect(portalForRole("field_staff")).toBe("field");
    expect(portalForRole("something_new")).toBe("team");
    expect(portalForRoles(["field_staff", "admin"])).toBe("admin");
    expect(portalForRoles(["field_staff", "manager"])).toBe("team");
    expect(portalForRoles(["field_staff"])).toBe("field");
  });
});

describe("hostAction", () => {
  it("does nothing when the switch is off", () => {
    process.env.NEXT_PUBLIC_SUBDOMAINS = "off";
    expect(hostAction("site", "/staff/dashboard")).toEqual({ kind: "allow" });
    expect(hostAction("my", "/privacy")).toEqual({ kind: "allow" });
  });
  it("sends old apex paths to the right host", () => {
    expect(hostAction("site", "/portal/rental")).toEqual({ kind: "redirect", portal: "my", path: "/portal/rental" });
    expect(hostAction("site", "/staff/login")).toEqual({ kind: "redirect", portal: "admin", path: "/staff/login" });
    expect(hostAction("site", "/privacy")).toEqual({ kind: "allow" });
    expect(hostAction("site", "/apply")).toEqual({ kind: "allow" });
    expect(hostAction("site", "/api/automation/x")).toEqual({ kind: "allow" });
  });
  it("renter host", () => {
    expect(hostAction("my", "/")).toEqual({ kind: "redirect", portal: "my", path: "/portal" });
    expect(hostAction("my", "/portal/rental")).toEqual({ kind: "allow" });
    expect(hostAction("my", "/apply/resume")).toEqual({ kind: "allow" });
    expect(hostAction("my", "/auth/callback")).toEqual({ kind: "allow" });
    expect(hostAction("my", "/api/x")).toEqual({ kind: "allow" });
    expect(hostAction("my", "/logo.png")).toEqual({ kind: "allow" });
    expect(hostAction("my", "/staff/dashboard")).toEqual({ kind: "redirect", portal: "admin", path: "/staff/dashboard" });
    expect(hostAction("my", "/privacy")).toEqual({ kind: "redirect", portal: "site", path: "/privacy" });
  });
  it("staff hosts", () => {
    for (const p of ["admin", "team", "field"] as const) {
      expect(hostAction(p, "/")).toEqual({ kind: "redirect", portal: p, path: "/staff/dashboard" });
      expect(hostAction(p, "/staff/pickups")).toEqual({ kind: "allow" });
      expect(hostAction(p, "/staff/login")).toEqual({ kind: "allow" });
      expect(hostAction(p, "/portal")).toEqual({ kind: "redirect", portal: "my", path: "/portal" });
      expect(hostAction(p, "/terms")).toEqual({ kind: "redirect", portal: "site", path: "/terms" });
      expect(hostAction(p, "/auth/callback")).toEqual({ kind: "allow" });
      expect(hostAction(p, "/api/telematics/x")).toEqual({ kind: "allow" });
    }
    expect(hostAction("admin", "/staffing")).toEqual({ kind: "redirect", portal: "site", path: "/staffing" });
  });
  it("admin-only paths", () => {
    expect(isAdminOnlyPath("/staff/team")).toBe(true);
    expect(isAdminOnlyPath("/staff/settings/x")).toBe(true);
    expect(isAdminOnlyPath("/staff/teamwork")).toBe(false);
    expect(isAdminOnlyPath("/staff/pickups")).toBe(false);
  });
});
