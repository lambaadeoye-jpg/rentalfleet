import { describe, it, expect } from "vitest";
import { banKeys, validateBanReason } from "./ban";

describe("banKeys", () => {
  it("normalizes phone and email", () => {
    expect(banKeys("(615) 555-0101", " Bad@Example.COM ")).toEqual({ phoneNorm: "6155550101", email: "bad@example.com" });
    expect(banKeys("+1 615 555 0101", null)).toEqual({ phoneNorm: "6155550101", email: null });
  });
  it("drops junk", () => expect(banKeys("123", "nope")).toEqual({ phoneNorm: null, email: null }));
});
describe("validateBanReason", () => {
  it("needs a real reason", () => { expect(validateBanReason("  ").ok).toBe(false); expect(validateBanReason("abc").ok).toBe(false); });
  it("tidies and caps", () => {
    const r = validateBanReason("  Did not   return the car  ");
    expect(r).toEqual({ ok: true, reason: "Did not return the car" });
    const long = validateBanReason("x".repeat(500));
    expect(long.ok && long.reason.length).toBe(300);
  });
});
