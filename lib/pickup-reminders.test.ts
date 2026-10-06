import { describe, it, expect } from "vitest";
import { formatPickupWhen, decideReminder, REMINDER_TEMPLATES, YES_REPLY, CHANGE_REPLY, type DueMessage } from "./pickup-reminders";

// 2026-10-06 is CDT (UTC-5): 18:00Z = 1:00 PM Central.
const now = new Date("2026-10-06T18:00:00Z");
const row = (o: Partial<DueMessage> = {}): DueMessage => ({
  kind: "24h", pickup_at: "2026-10-07T19:30:00Z", first_name: "Sam", phone: "615-555-0101",
  location_name: "Main Lot", location_tz: "America/Chicago", suppressed: false, ...o,
});

describe("formatPickupWhen", () => {
  it("today / tomorrow / later in the location's time zone", () => {
    expect(formatPickupWhen("2026-10-06T21:30:00Z", "America/Chicago", now)).toBe("today at 4:30 PM");
    expect(formatPickupWhen("2026-10-07T19:30:00Z", "America/Chicago", now)).toBe("tomorrow at 2:30 PM");
    expect(formatPickupWhen("2026-10-09T15:00:00Z", "America/Chicago", now)).toBe("Friday, Oct 9 at 10:00 AM");
  });
  it("uses the local day, not the UTC day", () => {
    // 03:00Z on Oct 7 is 10:00 PM on Oct 6 in Chicago: still "today".
    expect(formatPickupWhen("2026-10-07T03:00:00Z", "America/Chicago", now)).toBe("today at 10:00 PM");
  });
  it("noon and midnight read correctly", () => {
    expect(formatPickupWhen("2026-10-07T17:00:00Z", "America/Chicago", now)).toBe("tomorrow at 12:00 PM");
    expect(formatPickupWhen("2026-10-07T05:00:00Z", "America/Chicago", now)).toBe("tomorrow at 12:00 AM");
  });
  it("bad time zone falls back to Central instead of throwing", () => {
    expect(formatPickupWhen("2026-10-07T19:30:00Z", "Not/AZone", now)).toBe("tomorrow at 2:30 PM");
  });
});

describe("decideReminder", () => {
  it("sends a filled-in text", () => {
    const d = decideReminder(row(), now, true, "https://rentzivo.com/portal/rental");
    expect(d.action).toBe("send");
    if (d.action === "send") {
      expect(d.to).toBe("+16155550101");
      expect(d.body).toContain("tomorrow at 2:30 PM");
      expect(d.body).toContain("Main Lot");
      expect(d.body).not.toMatch(/\{\w+\}/);
    }
  });
  it("skips opted-out and numberless renters", () => {
    expect(decideReminder(row({ suppressed: true }), now, true, "x")).toEqual({ action: "skip", reason: "suppressed" });
    expect(decideReminder(row({ phone: null }), now, true, "x")).toEqual({ action: "skip", reason: "no_phone" });
    expect(decideReminder(row({ phone: "12345" }), now, true, "x")).toEqual({ action: "skip", reason: "no_phone" });
  });
  it("defers (never fails) with no provider, and in quiet hours", () => {
    expect(decideReminder(row(), now, false, "x")).toEqual({ action: "defer", reason: "sms_provider_not_configured" });
    const night = new Date("2026-10-07T03:00:00Z"); // 10 PM Central
    expect(decideReminder(row(), night, true, "x")).toEqual({ action: "defer", reason: "quiet_hours" });
  });
  it("opt-out wins over everything else", () => {
    expect(decideReminder(row({ suppressed: true, phone: null }), now, false, "x")).toEqual({ action: "skip", reason: "suppressed" });
  });
  it("missed-pickup text makes no promise about rescheduling or fees", () => {
    const d = decideReminder(row({ kind: "missed" }), now, true, "x");
    expect(d.action === "send" && /next steps/.test(d.body)).toBe(true);
    expect(d.action === "send" && /new time|reschedul|fee/i.test(d.body)).toBe(false);
  });
});

describe("wording", () => {
  const all = [...Object.values(REMINDER_TEMPLATES), YES_REPLY, CHANGE_REPLY];
  it("every text names Zivo and offers STOP", () => {
    for (const t of all) { expect(t.startsWith("Zivo:")).toBe(true); expect(t).toMatch(/STOP/); }
  });
  it("never mentions approval, fees or money", () => {
    for (const t of all) expect(t.toLowerCase()).not.toMatch(/approv|declin|denied|fee|charge|refund|forfeit|\$/);
  });
  it("reminders keep the renter's options clear", () => {
    expect(REMINDER_TEMPLATES["24h"]).toMatch(/YES/);
    expect(REMINDER_TEMPLATES["24h"]).toMatch(/CHANGE/);
    expect(REMINDER_TEMPLATES["2h"]).toMatch(/CHANGE/);
  });
  it("stays within two text segments when filled", () => {
    const d = decideReminder(row({ location_name: "Zivo Main Pickup Lot, Nashville" }), now, true, "https://rentzivo.com/portal/rental");
    expect(d.action === "send" && d.body.length <= 306).toBe(true);
  });
});
