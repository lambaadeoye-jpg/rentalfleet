import { describe, it, expect } from "vitest";
import { greeting } from "./greeting";

describe("greeting", () => {
  it("uses Central time, not UTC", () => {
    // 15:00 UTC on 7 Oct 2026 = 10:00 CDT
    expect(greeting(new Date("2026-10-07T15:00:00Z"))).toBe("Good morning");
    // 18:00 UTC = 13:00 CDT
    expect(greeting(new Date("2026-10-07T18:00:00Z"))).toBe("Good afternoon");
    // 03:00 UTC on the 8th = 22:00 CDT on the 7th (UTC would say morning)
    expect(greeting(new Date("2026-10-08T03:00:00Z"))).toBe("Good evening");
    // 22:00 UTC = 17:00 CDT
    expect(greeting(new Date("2026-10-07T22:00:00Z"))).toBe("Good evening");
  });
  it("switches at midnight", () => {
    // 05:00 UTC = 00:00 CDT
    expect(greeting(new Date("2026-10-07T05:00:00Z"))).toBe("Good morning");
  });
});
