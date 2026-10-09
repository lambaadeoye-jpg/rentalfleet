import { describe, expect, it } from "vitest";
import { failureTarget, safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps real destinations", () => {
    expect(safeNext("/apply")).toBe("/apply");
    expect(safeNext("/portal")).toBe("/portal");
    expect(safeNext("/staff/dashboard")).toBe("/staff/dashboard");
    expect(safeNext("/staff/onboard")).toBe("/staff/onboard");
  });
  it("defaults to /apply", () => {
    expect(safeNext(null)).toBe("/apply");
    expect(safeNext(undefined)).toBe("/apply");
  });
  it("rejects anything that could leave the site", () => {
    expect(safeNext("@evil.com")).toBe("/apply");
    expect(safeNext("//evil.com")).toBe("/apply");
    expect(safeNext("/\\evil.com")).toBe("/apply");
    expect(safeNext("/apply@evil.com")).toBe("/apply");
    expect(safeNext("https://evil.com")).toBe("/apply");
    expect(safeNext("/pay/abc")).toBe("/apply");
    expect(safeNext("/applyevil")).toBe("/apply");
  });
});

describe("failureTarget", () => {
  it("returns the matching sign-in page", () => {
    expect(failureTarget("/staff/dashboard")).toBe("/staff/login");
    expect(failureTarget("/portal")).toBe("/portal/login");
    expect(failureTarget("/apply")).toBe("/apply/resume");
  });
});
