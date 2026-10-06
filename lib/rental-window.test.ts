import { describe, it, expect } from "vitest";
import { validateRentalWindow, defaultDropoff, isDefaultDropoff } from "./rental-window";

const pickup = new Date("2026-10-10T14:00:00Z");
const plus = (ms: number) => new Date(pickup.getTime() + ms);
const DAY = 24 * 60 * 60 * 1000;

describe("validateRentalWindow", () => {
  it("accepts exactly 7 days", () => {
    expect(validateRentalWindow(pickup, plus(7 * DAY))).toEqual({ ok: true, days: 7 });
  });
  it("rejects anything under 7 days, even by a minute", () => {
    const r = validateRentalWindow(pickup, plus(7 * DAY - 60 * 1000));
    expect(r.ok).toBe(false);
  });
  it("rejects a drop-off before pickup", () => {
    expect(validateRentalWindow(pickup, plus(-DAY)).ok).toBe(false);
  });
  it("rounds partial days up for billing", () => {
    expect(validateRentalWindow(pickup, plus(7 * DAY + 3 * 60 * 60 * 1000))).toEqual({ ok: true, days: 8 });
  });
  it("counts a longer rental in whole days", () => {
    expect(validateRentalWindow(pickup, plus(14 * DAY))).toEqual({ ok: true, days: 14 });
  });
  it("rejects invalid dates", () => {
    expect(validateRentalWindow(new Date("nope"), plus(8 * DAY)).ok).toBe(false);
  });
});

describe("defaultDropoff / isDefaultDropoff", () => {
  it("defaults to exactly 7 days after pickup", () => {
    expect(defaultDropoff(pickup).getTime()).toBe(pickup.getTime() + 7 * DAY);
  });
  it("treats the default (and tiny rounding) as automatic", () => {
    expect(isDefaultDropoff(pickup, plus(7 * DAY))).toBe(true);
    expect(isDefaultDropoff(pickup, plus(7 * DAY + 30 * 1000))).toBe(true);
  });
  it("treats any real change as a staff override", () => {
    expect(isDefaultDropoff(pickup, plus(8 * DAY))).toBe(false);
    expect(isDefaultDropoff(pickup, plus(7 * DAY + 5 * 60 * 1000))).toBe(false);
  });
});
