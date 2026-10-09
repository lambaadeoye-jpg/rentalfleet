import { describe, expect, it } from "vitest";
import { DEFAULT_FEES, localToIso, matchRental, parseMoney, totalToCharge, type RentalWindow } from "./tolls";

describe("localToIso (Central time)", () => {
  it("reads summer time as UTC-5 and winter as UTC-6", () => {
    expect(localToIso("2026-07-01T12:00")).toBe("2026-07-01T17:00:00.000Z");
    expect(localToIso("2026-01-15T12:00")).toBe("2026-01-15T18:00:00.000Z");
  });
  it("handles the daylight-saving change days", () => {
    expect(localToIso("2026-03-08T12:00")).toBe("2026-03-08T17:00:00.000Z"); // spring forward happened at 2am
    expect(localToIso("2026-11-01T12:00")).toBe("2026-11-01T18:00:00.000Z"); // fall back happened at 2am
  });
  it("rejects bad input", () => {
    expect(localToIso("")).toBeNull();
    expect(localToIso("2026-10-09")).toBeNull();
    expect(localToIso("2026-02-31T10:00")).toBeNull();
    expect(localToIso("garbage")).toBeNull();
  });
});

describe("parseMoney", () => {
  it("accepts normal amounts", () => {
    expect(parseMoney("4.50")).toBe(4.5);
    expect(parseMoney("$25")).toBe(25);
    expect(parseMoney(" 120.5 ")).toBe(120.5);
  });
  it("rejects zero, negatives, junk and extra decimals", () => {
    for (const bad of ["0", "-5", "abc", "1.234", "", "1,000", "9999999"]) expect(parseMoney(bad)).toBeNull();
  });
});

describe("totalToCharge", () => {
  it("adds the administrative fee from the agreement", () => {
    expect(totalToCharge(4.5, DEFAULT_FEES.toll)).toBe(10.5);
    expect(totalToCharge(60, DEFAULT_FEES.citation)).toBe(85);
    expect(totalToCharge(0.1, 0.2)).toBe(0.3); // no floating-point drift
  });
});

describe("matchRental", () => {
  const w = (id: string, startAt: string | null, endAt: string | null): RentalWindow => ({ rentalId: id, customerId: `c-${id}`, startAt, endAt });
  const windows = [
    w("old", "2026-09-01T10:00:00Z", "2026-09-20T10:00:00Z"),
    w("current", "2026-09-21T10:00:00Z", null),
    w("unstarted", null, null),
  ];
  it("finds the rental that had the car at that moment", () => {
    expect(matchRental(windows, "2026-09-10T00:00:00Z")?.rentalId).toBe("old");
    expect(matchRental(windows, "2026-10-05T00:00:00Z")?.rentalId).toBe("current"); // still out
  });
  it("returns null in the gap between rentals and before the first", () => {
    expect(matchRental(windows, "2026-09-20T18:00:00Z")).toBeNull();
    expect(matchRental(windows, "2026-08-01T00:00:00Z")).toBeNull();
  });
  it("includes the exact start and end moments", () => {
    expect(matchRental(windows, "2026-09-01T10:00:00Z")?.rentalId).toBe("old");
    expect(matchRental(windows, "2026-09-20T10:00:00Z")?.rentalId).toBe("old");
  });
  it("prefers the latest start when windows overlap, and survives a bad date", () => {
    const overlap = [w("a", "2026-09-01T00:00:00Z", null), w("b", "2026-09-10T00:00:00Z", null)];
    expect(matchRental(overlap, "2026-09-15T00:00:00Z")?.rentalId).toBe("b");
    expect(matchRental(overlap, "nope")).toBeNull();
  });
});
