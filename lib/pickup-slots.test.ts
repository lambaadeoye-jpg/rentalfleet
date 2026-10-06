import { describe, it, expect } from "vitest";
import {
  groupSlotsByDay, formatSlotTime, slotErrorMessage, extractSlotErrorCode, confirmOutcomeMessage,
  validateWeeklyRules, minutesOfDay, clampHoldMinutes, type WeeklyRuleInput,
} from "./pickup-slots";

describe("groupSlotsByDay", () => {
  it("groups by the location's local day, not UTC", () => {
    // 2026-10-08 03:30Z is still Oct 7, 10:30pm in Chicago (CDT).
    const slots = [
      { startsAt: "2026-10-08T03:30:00Z", endsAt: "2026-10-08T04:00:00Z", spotsLeft: 1 },
      { startsAt: "2026-10-08T15:00:00Z", endsAt: "2026-10-08T15:30:00Z", spotsLeft: 1 },
      { startsAt: "2026-10-08T15:30:00Z", endsAt: "2026-10-08T16:00:00Z", spotsLeft: 2 },
    ];
    const days = groupSlotsByDay(slots, "America/Chicago");
    expect(days.map((d) => d.dayKey)).toEqual(["2026-10-07", "2026-10-08"]);
    expect(days[0].slots[0].label).toBe("10:30 PM");
    expect(days[1].slots.map((s) => s.label)).toEqual(["10:00 AM", "10:30 AM"]);
    expect(days[1].label).toBe("Thu, Oct 8");
  });
  it("falls back to Central for a missing or bad zone and skips bad dates", () => {
    const slots = [
      { startsAt: "2026-10-08T15:00:00Z", endsAt: "x", spotsLeft: 1 },
      { startsAt: "garbage", endsAt: "x", spotsLeft: 1 },
    ];
    expect(groupSlotsByDay(slots, null)[0].slots[0].label).toBe("10:00 AM");
    expect(groupSlotsByDay(slots, "Not/AZone")[0].slots).toHaveLength(1);
  });
  it("empty in, empty out", () => expect(groupSlotsByDay([], "America/Chicago")).toEqual([]));
});

describe("formatSlotTime", () => {
  it("formats in zone", () => expect(formatSlotTime("2026-10-08T15:00:00Z", "America/Chicago")).toBe("Thu, Oct 8 at 10:00 AM"));
  it("bad date is empty", () => expect(formatSlotTime("nope", null)).toBe(""));
});

describe("error mapping", () => {
  it("finds a code inside a database error", () => {
    expect(extractSlotErrorCode("rpc failed: slot_unavailable (P0001)")).toBe("slot_unavailable");
    expect(slotErrorMessage("slot_unavailable")).toMatch(/just taken/);
    expect(slotErrorMessage("needs_staff")).toMatch(/team/);
  });
  it("unknown or empty is generic and never leaks internals", () => {
    expect(slotErrorMessage("relation \"slot_hold\" does not exist")).toBe("Something went wrong. Please try again.");
    expect(slotErrorMessage(undefined)).toBe("Something went wrong. Please try again.");
  });
  it("confirm outcomes", () => {
    expect(confirmOutcomeMessage("confirmed")).toBeNull();
    expect(confirmOutcomeMessage("already_confirmed")).toBeNull();
    expect(confirmOutcomeMessage("expired")).toMatch(/ran out/);
    expect(confirmOutcomeMessage("payment_required")).toMatch(/Payment/);
    expect(confirmOutcomeMessage("not_active")).toMatch(/can't be confirmed/);
  });
});

describe("validateWeeklyRules", () => {
  const ok: WeeklyRuleInput = { weekday: 1, open: true, startTime: "10:00", endTime: "12:00", slotMinutes: 30, capacity: 1 };
  it("accepts a good day and ignores closed days", () => {
    expect(validateWeeklyRules([ok, { ...ok, weekday: 2, open: false, startTime: "", endTime: "" }])).toBeNull();
  });
  it("rejects bad times, order, slot length, capacity, duplicates", () => {
    expect(validateWeeklyRules([{ ...ok, startTime: "9am" }])).toMatch(/Monday/);
    expect(validateWeeklyRules([{ ...ok, startTime: "12:00", endTime: "10:00" }])).toMatch(/after opening/);
    expect(validateWeeklyRules([{ ...ok, slotMinutes: 25 }])).toMatch(/slot length/);
    expect(validateWeeklyRules([{ ...ok, startTime: "10:00", endTime: "10:20", slotMinutes: 30 }])).toMatch(/shorter/);
    expect(validateWeeklyRules([{ ...ok, capacity: 0 }])).toMatch(/1 to 20/);
    expect(validateWeeklyRules([{ ...ok, capacity: 21 }])).toMatch(/1 to 20/);
    expect(validateWeeklyRules([ok, ok])).toMatch(/once/);
    expect(validateWeeklyRules([{ ...ok, weekday: 7 }])).toMatch(/Invalid/);
  });
  it("minutesOfDay", () => {
    expect(minutesOfDay("09:30")).toBe(570);
    expect(minutesOfDay("24:00")).toBeNull();
    expect(minutesOfDay("9:30")).toBeNull();
  });
});

describe("clampHoldMinutes", () => {
  it("clamps like the database", () => {
    expect(clampHoldMinutes(1)).toBe(5);
    expect(clampHoldMinutes(999)).toBe(240);
    expect(clampHoldMinutes(30)).toBe(30);
    expect(clampHoldMinutes(NaN)).toBe(30);
  });
});
