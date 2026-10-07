import { describe, it, expect } from "vitest";
import { noticeBody, decideNotice, dollars, type NoticeRow } from "./renter-notices";

const row = (over: Partial<NoticeRow> = {}): NoticeRow => ({ kind: "payment_received", data: { rent_cents: 45000, deposit_cents: 45000 }, first_name: "Ann", phone: "+16155550123", suppressed: false, ...over });
// Noon in Nashville (CDT): inside any sensible send window.
const NOON = new Date("2026-10-07T17:00:00Z");
const NIGHT = new Date("2026-10-07T07:00:00Z"); // 2 AM Nashville

describe("noticeBody", () => {
  it("formats dollars", () => {
    expect(dollars(45000)).toBe("$450.00");
    expect(dollars("abc")).toBe("$0.00");
  });
  it("cancelled with a refund promises a text, not a date", () => {
    const t = noticeBody("cancelled", { total_refund_cents: 9000 }, null)!;
    expect(t).toContain("$90.00");
    expect(t).toContain("will text you when it's issued");
    expect(t).toContain("Reply STOP");
  });
  it("cancelled with nothing owed says so", () => {
    expect(noticeBody("cancelled", { total_refund_cents: 0 }, null)).toContain("No refund is due");
  });
  it("refund timing only when it went to the card", () => {
    expect(noticeBody("refund_sent", { total_refund_cents: 9000, manual_cents: 0 }, null)).toContain("5 to 10 business days");
    expect(noticeBody("refund_sent", { total_refund_cents: 9000, manual_cents: 9000 }, null)).not.toContain("business days");
    expect(noticeBody("refund_sent", { total_refund_cents: 0 }, null)).toBeNull();
  });
  it("deposit return after a finished rental says deposit", () => {
    expect(noticeBody("refund_sent", { total_refund_cents: 45000, manual_cents: 0, reason: "rental_ended" }, null)).toContain("deposit refund of $450.00");
  });
  it("payment receipt splits rent and deposit", () => {
    const t = noticeBody("payment_received", { rent_cents: 45000, deposit_cents: 45000 }, null)!;
    expect(t).toContain("$900.00");
    expect(t).toContain("$450.00 rent + $450.00 refundable deposit");
  });
  it("failed charge adds support contact when known", () => {
    expect(noticeBody("weekly_charge_failed", { amount_cents: 45000 }, "615-555-0100")).toContain("Questions? 615-555-0100.");
    expect(noticeBody("weekly_charge_failed", { amount_cents: 45000 }, null)).not.toContain("Questions?");
  });
  it("never promises timing for approval or pickup", () => {
    for (const k of ["cancelled", "payment_received", "weekly_rent_charged", "weekly_charge_failed"] as const) {
      expect(noticeBody(k, { total_refund_cents: 100, rent_cents: 100, amount_cents: 100 }, null)).not.toMatch(/within \d+ ?(hours|days)|guarantee/i);
    }
  });
});

describe("decideNotice", () => {
  it("sends in the daytime", () => {
    const d = decideNotice(row(), NOON, true, null);
    expect(d.action).toBe("send");
  });
  it("skips suppressed numbers and missing phones", () => {
    expect(decideNotice(row({ suppressed: true }), NOON, true, null)).toEqual({ action: "skip", reason: "suppressed" });
    expect(decideNotice(row({ phone: null }), NOON, true, null)).toEqual({ action: "skip", reason: "no_phone" });
  });
  it("defers with no provider or at night", () => {
    expect(decideNotice(row(), NOON, false, null).action).toBe("defer");
    expect(decideNotice(row(), NIGHT, true, null)).toEqual({ action: "defer", reason: "quiet_hours" });
  });
});

describe("check-ins and referral ask", () => {
  const ctx = { siteUrl: "https://rentzivo.com/", firstName: "Ann", referralCode: "ABCD2345" };
  it("check-ins point to the portal and promise nothing about timing", () => {
    for (const k of ["checkin_day1", "checkin_day3"] as const) {
      const t = noticeBody(k, {}, null, ctx)!;
      expect(t).toContain("Hi Ann,");
      expect(t).toContain("https://rentzivo.com/portal");
      expect(t).toContain("Reply STOP");
      expect(t).not.toMatch(/within \d+ ?(hours|days)|guarantee|deposit/i);
    }
  });
  it("referral ask carries the renter's own link, and nothing without a code", () => {
    expect(noticeBody("referral_ask", {}, null, ctx)).toContain("https://rentzivo.com/?ref=ABCD2345");
    expect(noticeBody("referral_ask", {}, null, { ...ctx, referralCode: "" })).toBeNull();
    expect(noticeBody("referral_ask", {}, null, { ...ctx, referralCode: null })).toBeNull();
  });
  it("every new text fits in two segments", () => {
    for (const k of ["checkin_day1", "checkin_day3", "referral_ask"] as const) {
      expect(noticeBody(k, {}, null, ctx)!.length).toBeLessThanOrEqual(306);
    }
  });
  it("check-ins are skipped unless the rental is still running", () => {
    expect(decideNotice(row({ kind: "checkin_day1", rental_status: "active" }), NOON, true, null).action).toBe("send");
    expect(decideNotice(row({ kind: "checkin_day3", rental_status: "extended" }), NOON, true, null).action).toBe("send");
    for (const st of ["returned", "cancelled", "closed", null, undefined]) {
      expect(decideNotice(row({ kind: "checkin_day1", rental_status: st }), NOON, true, null))
        .toEqual({ action: "skip", reason: "rental_not_active" });
    }
  });
  it("the referral ask needs recorded consent and an active rental", () => {
    const base = { kind: "referral_ask" as const, rental_status: "active", referral_code: "ABCD2345" };
    expect(decideNotice(row({ ...base, has_consent: false }), NOON, true, null)).toEqual({ action: "skip", reason: "no_marketing_consent" });
    expect(decideNotice(row({ ...base, has_consent: true }), NOON, true, null).action).toBe("send");
    expect(decideNotice(row({ ...base, has_consent: true, rental_status: "returned" }), NOON, true, null))
      .toEqual({ action: "skip", reason: "rental_not_active" });
    expect(decideNotice(row({ ...base, has_consent: true, referral_code: null }), NOON, true, null))
      .toEqual({ action: "skip", reason: "nothing_to_say" });
  });
  it("check-ins still wait for quiet hours instead of being dropped", () => {
    expect(decideNotice(row({ kind: "checkin_day1", rental_status: "active" }), NIGHT, true, null))
      .toEqual({ action: "defer", reason: "quiet_hours" });
  });
});

describe("declined-card text", () => {
  const url = "https://rentzivo.com/card/" + "a".repeat(43);
  it("carries the private update-card link when there is one", () => {
    const t = noticeBody("weekly_charge_failed", { amount_cents: 45000 }, null, { cardUpdateUrl: url })!;
    expect(t).toContain(`Update your card here: ${url}`);
    expect(t).toContain("$450.00");
    expect(t).toContain("Reply STOP");
    expect(t.length).toBeLessThanOrEqual(306);
  });
  it("asks the renter to contact us when no link could be made", () => {
    const t = noticeBody("weekly_charge_failed", { amount_cents: 45000 }, "615-555-0100")!;
    expect(t).toContain("Please contact us");
    expect(t).not.toContain("/card/");
  });
  it("sends with the link through decideNotice", () => {
    const d = decideNotice(row({ kind: "weekly_charge_failed", data: { amount_cents: 45000 } }), NOON, true, null, { cardUpdateUrl: url });
    expect(d.action).toBe("send");
    if (d.action === "send") expect(d.body).toContain("/card/");
  });
});
