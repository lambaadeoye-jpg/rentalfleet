import { describe, it, expect } from "vitest";
import { formatPhone } from "./format-phone";

describe("formatPhone", () => {
  it("formats US numbers", () => {
    expect(formatPhone("+16155550111")).toBe("(615) 555-0111");
    expect(formatPhone("615-555-0111")).toBe("(615) 555-0111");
    expect(formatPhone("16155550111")).toBe("(615) 555-0111");
  });
  it("leaves other values alone and handles empty", () => {
    expect(formatPhone("+442071838750")).toBe("+442071838750");
    expect(formatPhone("")).toBe("");
    expect(formatPhone(null)).toBe("");
  });
});
