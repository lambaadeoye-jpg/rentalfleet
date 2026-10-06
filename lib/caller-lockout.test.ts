import { describe, it, expect } from "vitest";
import { callerKey, isLockedOut, MAX_FAILED_VERIFICATIONS } from "./caller-lockout";

describe("callerKey", () => {
  it("is the same for every common format of one number", () => {
    const k = callerKey("6155551234");
    expect(k).toBeTruthy();
    expect(callerKey("+16155551234")).toBe(k);
    expect(callerKey("(615) 555-1234")).toBe(k);
    expect(callerKey("1-615-555-1234")).toBe(k);
  });
  it("differs between numbers and never contains the number", () => {
    expect(callerKey("6155551234")).not.toBe(callerKey("6155551235"));
    expect(callerKey("6155551234")).not.toContain("6155551234");
  });
  it("returns null for missing or too-short numbers", () => {
    expect(callerKey("")).toBeNull();
    expect(callerKey("12345")).toBeNull();
  });
});

describe("isLockedOut", () => {
  it("locks at the limit, not before", () => {
    expect(isLockedOut(MAX_FAILED_VERIFICATIONS - 1)).toBe(false);
    expect(isLockedOut(MAX_FAILED_VERIFICATIONS)).toBe(true);
    expect(isLockedOut(MAX_FAILED_VERIFICATIONS + 5)).toBe(true);
  });
});
