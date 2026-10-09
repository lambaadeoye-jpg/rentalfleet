import { describe, expect, it } from "vitest";
import { agreementState, needsAttention, type SignRequestLite } from "./contracts";

const now = new Date("2026-10-09T12:00:00Z");
const req = (over: Partial<SignRequestLite> = {}): SignRequestLite => ({
  createdAt: "2026-10-08T12:00:00Z",
  expiresAt: "2026-10-11T12:00:00Z",
  signedAt: null,
  revokedAt: null,
  ...over,
});

describe("agreementState", () => {
  it("is signed when a signed document exists", () => {
    expect(agreementState({ signed: true, requests: [] }, now)).toBe("signed");
  });
  it("is not sent with no requests", () => {
    expect(agreementState({ signed: false, requests: [] }, now)).toBe("not_sent");
  });
  it("waits while the newest link is live", () => {
    expect(agreementState({ signed: false, requests: [req()] }, now)).toBe("waiting");
  });
  it("expires once the link's time is up", () => {
    expect(agreementState({ signed: false, requests: [req({ expiresAt: "2026-10-09T11:59:59Z" })] }, now)).toBe("expired");
  });
  it("only the newest request counts: a new link replaces an old expired one", () => {
    const old = req({ createdAt: "2026-10-01T00:00:00Z", expiresAt: "2026-10-04T00:00:00Z" });
    expect(agreementState({ signed: false, requests: [old, req()] }, now)).toBe("waiting");
    expect(agreementState({ signed: false, requests: [req(), old] }, now)).toBe("waiting"); // order doesn't matter
  });
  it("shows a cancelled link as cancelled", () => {
    expect(agreementState({ signed: false, requests: [req({ revokedAt: "2026-10-08T13:00:00Z" })] }, now)).toBe("revoked");
  });
  it("treats a signed request as signed even if the document row is missing", () => {
    expect(agreementState({ signed: false, requests: [req({ signedAt: "2026-10-08T14:00:00Z" })] }, now)).toBe("signed");
  });
});

describe("needsAttention", () => {
  it("flags cars that are out or about to go out without a signature", () => {
    expect(needsAttention("active", "not_sent")).toBe(true);
    expect(needsAttention("scheduled", "waiting")).toBe(true);
    expect(needsAttention("active", "expired")).toBe(true);
  });
  it("does not flag signed rentals or finished ones", () => {
    expect(needsAttention("active", "signed")).toBe(false);
    expect(needsAttention("returned", "not_sent")).toBe(false);
    expect(needsAttention("closed", "not_sent")).toBe(false);
    expect(needsAttention("approved", "not_sent")).toBe(false);
  });
});
