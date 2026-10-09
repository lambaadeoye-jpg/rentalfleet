import { describe, it, expect } from "vitest";
import { handoverMissing, checkVideo, validMileage, WALKTHROUGH_AREAS, QUICK_CHECKS, type HandoverState } from "./handover";

const ids = ["a", "b"];
const full: HandoverState = {
  identityVerified: true, agreementSigned: true, cardCharged: true,
  areaCounts: Object.fromEntries(WALKTHROUGH_AREAS.map((a) => [a.key, 1])),
  hasWalkthroughVideo: true,
  checks: Object.fromEntries(QUICK_CHECKS.map((c) => [c.key, true])),
  briefingAcked: ["a", "b"],
};

describe("handoverMissing", () => {
  it("is empty when everything is done", () => expect(handoverMissing(full, ids)).toEqual([]));
  it("lists what is missing in order", () => {
    const m = handoverMissing({ ...full, identityVerified: false, areaCounts: { front: 1 }, hasWalkthroughVideo: false, briefingAcked: ["a"] }, ids);
    expect(m[0]).toMatch(/ID/);
    expect(m.some((x) => x.startsWith("Photos still needed"))).toBe(true);
    expect(m).toContain("Record the walkthrough video");
    expect(m).toContain("Explain 1 more rule to the renter");
  });
  it("needs every quick check", () => expect(handoverMissing({ ...full, checks: { doors: true } }, ids)).toContain("Finish the quick checks"));
  it("blocks on agreement and card", () => {
    const m = handoverMissing({ ...full, agreementSigned: false, cardCharged: false }, ids);
    expect(m).toHaveLength(2);
  });
});

describe("checkVideo", () => {
  it("accepts 60 seconds", () => expect(checkVideo({ seconds: 60, bytes: 1000 }).ok).toBe(true));
  it("rejects 75 seconds", () => expect(checkVideo({ seconds: 75, bytes: 1000 }).ok).toBe(false));
  it("rejects unreadable", () => expect(checkVideo({ seconds: null, bytes: 1000 }).ok).toBe(false));
  it("rejects huge files", () => expect(checkVideo({ seconds: 30, bytes: 80 * 1024 * 1024 }).ok).toBe(false));
  it("rejects empty", () => expect(checkVideo({ seconds: 30, bytes: 0 }).ok).toBe(false));
});

describe("validMileage", () => {
  it("accepts whole numbers", () => { expect(validMileage("45210")).toBe(45210); expect(validMileage(0)).toBe(0); });
  it("rejects junk", () => { expect(validMileage("")).toBeNull(); expect(validMileage("12.5")).toBeNull(); expect(validMileage("-3")).toBeNull(); expect(validMileage("abc")).toBeNull(); });
});
