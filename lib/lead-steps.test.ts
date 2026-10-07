import { describe, it, expect } from "vitest";
import { validateStep1, validateStep2, cleanStep2, HEARD_ABOUT_OPTIONS } from "./lead-steps";

describe("validateStep1", () => {
  const ok = { firstName: "Ann", phone: "615-555-0123", email: "a@x.com" };
  it("accepts a normal first step", () => expect(validateStep1(ok)).toBeNull());
  it("needs first name, phone and email", () => {
    expect(validateStep1({ ...ok, firstName: " " })).toMatch(/required/);
    expect(validateStep1({ ...ok, phone: "" })).toMatch(/required/);
    expect(validateStep1({ ...ok, email: "" })).toMatch(/required/);
  });
  it("checks email and phone shape", () => {
    expect(validateStep1({ ...ok, email: "nope" })).toMatch(/valid email/);
    expect(validateStep1({ ...ok, phone: "12345" })).toMatch(/10-digit/);
  });
  it("rejects absurdly long names", () => expect(validateStep1({ ...ok, firstName: "a".repeat(81) })).toMatch(/too long/));
});

describe("validateStep2 / cleanStep2", () => {
  it("needs a last name", () => {
    expect(validateStep2({ lastName: "  " })).toMatch(/required/);
    expect(validateStep2({ lastName: "Lee" })).toBeNull();
    expect(validateStep2({ lastName: "x".repeat(81) })).toMatch(/too long/);
  });
  it("drops values the database would ignore", () => {
    const c = cleanStep2({ lastName: " Lee ", rentalOption: "monthly", urgency: "whenever", heardAbout: "tv", additionalInfo: "  " });
    expect(c).toEqual({ lastName: "Lee", rentalOption: null, urgency: null, heardAbout: null, additionalInfo: null });
  });
  it("keeps valid values", () => {
    const c = cleanStep2({ lastName: "Lee", rentalOption: "daily", urgency: "today", heardAbout: "friend", additionalInfo: "hi" });
    expect(c).toEqual({ lastName: "Lee", rentalOption: "daily", urgency: "today", heardAbout: "friend", additionalInfo: "hi" });
  });
  it("every heard-about option is accepted", () => {
    for (const o of HEARD_ABOUT_OPTIONS) expect(cleanStep2({ lastName: "L", heardAbout: o.value }).heardAbout).toBe(o.value);
  });
});
