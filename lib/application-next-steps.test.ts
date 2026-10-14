import { describe, expect, it } from "vitest";
import { insuranceSummary, maskLicense, nextStepsFor, submittedViewFor } from "./application-next-steps";

const allCopy = (m: ReturnType<typeof nextStepsFor>) =>
  [m.headline, m.subline, ...m.timeline.flatMap((s) => [s.label, s.detail]), ...m.tips].join(" ");

describe("submittedViewFor", () => {
  it("maps statuses to the right screen", () => {
    expect(submittedViewFor("submitted")).toBe("in_review");
    expect(submittedViewFor("screening")).toBe("in_review");
    expect(submittedViewFor("review")).toBe("in_review");
    expect(submittedViewFor("approved")).toBe("approved");
    expect(submittedViewFor("conditionally_approved")).toBe("approved");
    expect(submittedViewFor("declined")).toBe("declined");
    expect(submittedViewFor("expired")).toBe("expired");
  });
});

describe("nextStepsFor", () => {
  it("in review: exactly one current step, and it is the review", () => {
    const m = nextStepsFor("submitted", "Sam");
    expect(m.timeline.filter((s) => s.state === "current")).toHaveLength(1);
    expect(m.timeline.find((s) => s.state === "current")?.key).toBe("review");
    expect(m.timeline[0].state).toBe("done");
    expect(m.subline).toContain("Thanks, Sam.");
  });

  it("approved: the current step is sign, pay and pickup", () => {
    const m = nextStepsFor("approved", "");
    expect(m.timeline.find((s) => s.state === "current")?.key).toBe("next");
    expect(m.subline.startsWith("Thanks.")).toBe(true);
  });

  it("declined and expired have no timeline", () => {
    expect(nextStepsFor("declined", "A").timeline).toEqual([]);
    expect(nextStepsFor("expired", "A").timeline).toEqual([]);
  });

  it("never promises timing, approval, a named channel, an amount or a provider", () => {
    for (const status of ["submitted", "approved", "declined", "expired"]) {
      const text = allCopy(nextStepsFor(status, "Sam"));
      expect(text).not.toMatch(/minutes|hours|24|same[- ]day|within|guarantee|instant|fast|quick/i);
      expect(text).not.toMatch(/\btexts?\b|\btexting\b|\bsms\b/i);
      expect(text).not.toMatch(/\$\d/);
      expect(text).not.toMatch(/bonzah|rentalcover/i);
    }
  });

  it("states the own-name payment rule without a cash line", () => {
    const text = allCopy(nextStepsFor("submitted", "Sam"));
    expect(text).toMatch(/own name/);
    expect(text).not.toMatch(/cash/i);
  });
});

describe("maskLicense", () => {
  it("shows only the last four", () => {
    expect(maskLicense("123456789")).toBe("••••6789");
    expect(maskLicense("12 34 56")).toBe("••••3456");
    expect(maskLicense("123")).toBe("••••");
    expect(maskLicense("")).toBe("");
    expect(maskLicense(null)).toBe("");
  });
});

describe("insuranceSummary", () => {
  it("uses general wording", () => {
    expect(insuranceSummary(true, "State Farm")).toBe("State Farm");
    expect(insuranceSummary(true, " ")).toBe("Your own coverage");
    expect(insuranceSummary(false, "")).toBe("We’ll help you get coverage sorted");
    expect(insuranceSummary(null, "")).toBe("Not answered");
  });
});
