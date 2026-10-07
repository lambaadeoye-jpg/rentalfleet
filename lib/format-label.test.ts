import { describe, it, expect } from "vitest";
import { sentenceCase } from "./format-label";

describe("sentenceCase", () => {
  it("turns database values into sentence case", () => {
    expect(sentenceCase("pending_approval")).toBe("Pending approval");
    expect(sentenceCase("drivers_license")).toBe("Drivers license");
    expect(sentenceCase("ACTIVE")).toBe("Active");
    expect(sentenceCase("admin")).toBe("Admin");
  });
  it("handles empty values and extra spaces", () => {
    expect(sentenceCase(null)).toBe("");
    expect(sentenceCase(undefined)).toBe("");
    expect(sentenceCase("  in   review ")).toBe("In review");
  });
});
