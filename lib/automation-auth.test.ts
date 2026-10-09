import { describe, it, expect, afterEach } from "vitest";
import { isAutomationAuthorized } from "./automation-auth";

const req = (secret?: string) => new Request("https://x.test/api", { method: "POST", headers: secret ? { "x-automation-secret": secret } : {} });
const original = process.env.AUTOMATION_API_SECRET;
afterEach(() => { if (original === undefined) delete process.env.AUTOMATION_API_SECRET; else process.env.AUTOMATION_API_SECRET = original; });

describe("isAutomationAuthorized", () => {
  it("accepts the right secret", () => {
    process.env.AUTOMATION_API_SECRET = "s3cret";
    expect(isAutomationAuthorized(req("s3cret"))).toBe(true);
  });
  it("rejects wrong, missing and different-length secrets", () => {
    process.env.AUTOMATION_API_SECRET = "s3cret";
    expect(isAutomationAuthorized(req("nope"))).toBe(false);
    expect(isAutomationAuthorized(req("s3cret-and-more"))).toBe(false);
    expect(isAutomationAuthorized(req())).toBe(false);
  });
  it("rejects everything when no secret is configured", () => {
    delete process.env.AUTOMATION_API_SECRET;
    expect(isAutomationAuthorized(req("anything"))).toBe(false);
    expect(isAutomationAuthorized(req(""))).toBe(false);
  });
  it("supports rotation with several secrets", () => {
    process.env.AUTOMATION_API_SECRET = "old, new";
    expect(isAutomationAuthorized(req("old"))).toBe(true);
    expect(isAutomationAuthorized(req("new"))).toBe(true);
    expect(isAutomationAuthorized(req("older"))).toBe(false);
  });
});
