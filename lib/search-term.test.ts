import { describe, it, expect } from "vitest";
import { safeSearchTerm, phoneDigits } from "./search-term";

describe("safeSearchTerm", () => {
  it("drops characters that change a filter", () => {
    expect(safeSearchTerm("a,id.neq.1),(b%_")).toBe("a id.neq.1 b");
  });
  it("trims, collapses spaces and caps the length", () => {
    expect(safeSearchTerm("  sam   lee ")).toBe("sam lee");
    expect(safeSearchTerm("x".repeat(100)).length).toBe(60);
  });
});

describe("phoneDigits", () => {
  it("keeps the last ten digits", () => expect(phoneDigits("+1 (615) 555-0111")).toBe("6155550111"));
  it("ignores short numbers", () => expect(phoneDigits("12")).toBe(""));
});
