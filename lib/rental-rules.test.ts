import { describe, it, expect } from "vitest";
import { buildRuleValues, briefingRules, postPickupMessage, quickAnswers, DEFAULT_INSURANCE_LINE } from "./rental-rules";

const v = buildRuleValues({ settings: { google_review_url: "https://g.page/r/abc/review", rules_instagram: "rentzivo" }, supportPhone: "(615) 555-0199" });

describe("rental rules", () => {
  it("uses the decided numbers by default", () => {
    expect(v.lateRentFee).toBe("50");
    expect(v.lateRentCutoff).toBe("5 PM");
    expect(v.lateReturnFee).toBe("250");
    expect(v.tollFee).toBe("6");
    expect(v.travelArea).toBe("Greater Nashville");
    expect(v.maintenanceDays).toBe(30);
    expect(v.ticketPayHours).toBe(24);
    expect(v.instagram).toBe("@rentzivo");
    expect(v.insuranceLine).toBe(DEFAULT_INSURANCE_LINE);
  });
  it("follows the approved agreement when it differs", () => {
    const x = buildRuleValues({ agreementVars: { late_rent_fee: "$60", travel_area: "Davidson County" } });
    expect(x.lateRentFee).toBe("60");
    expect(x.travelArea).toBe("Davidson County");
  });
  it("ignores junk settings", () => {
    const x = buildRuleValues({ settings: { rules_maintenance_days: "abc", google_review_url: "not a url", rules_instagram: "" } });
    expect(x.maintenanceDays).toBe(30);
    expect(x.reviewUrl).toBeNull();
    expect(x.instagram).toBe("@rentzivo");
  });
  it("has unique rule ids and no leftover placeholders", () => {
    const rules = briefingRules(v);
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
    for (const r of rules) expect(r.text).not.toMatch(/\{\{|undefined|NaN/);
  });
  it("never mentions Maryland or EZ Pass", () => {
    const all = JSON.stringify([briefingRules(v), postPickupMessage(v, "Sam"), quickAnswers(v)]);
    expect(all).not.toMatch(/Maryland|D\.C\.|EZ ?Pass|carrentalpro/i);
  });
  it("builds the renter message", () => {
    const m = postPickupMessage(v, "Sam");
    expect(m.emailText).toContain("Hey Sam,");
    expect(m.emailText).toContain("$50 late fee");
    expect(m.emailText).toContain("https://g.page/r/abc/review");
    expect(m.emailText).toContain("@rentzivo");
    expect(m.emailText).toContain("/guides/driver-signup");
    expect(m.sms.endsWith("Reply STOP to opt out.")).toBe(true);
    expect(m.sms.length).toBeLessThan(480);
  });
  it("skips the review line when no link is set", () => {
    const m = postPickupMessage(buildRuleValues({}), null);
    expect(m.emailText).not.toMatch(/leave a review/i);
    expect(m.emailText).toContain("Hey there,");
  });
  it("keeps the ticket threshold internal", () => {
    expect(JSON.stringify(postPickupMessage(v, "Sam"))).not.toMatch(/more than 5 tickets/);
    expect(quickAnswers(v).find((q) => q.q === "Tickets")!.a).toContain("more than 5 tickets");
  });
});
