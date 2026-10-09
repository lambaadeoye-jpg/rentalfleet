import { describe, expect, it } from "vitest";
import { agreementSmsBody, decideAgreementSms, lastFour, phoneNorm } from "./agreement-notice";

// 615 = Nashville (Central). 2:00pm Central on a weekday in October is 19:00 UTC.
const DAY = new Date("2026-10-09T19:00:00Z");
const NIGHT = new Date("2026-10-10T04:00:00Z"); // 11pm Central

describe("phoneNorm / lastFour", () => {
  it("reduces US numbers to ten digits", () => {
    expect(phoneNorm("(615) 555-0142")).toBe("6155550142");
    expect(phoneNorm("+1 615 555 0142")).toBe("6155550142");
    expect(phoneNorm("1-615-555-0142")).toBe("6155550142");
    expect(lastFour("615.555.0142")).toBe("0142");
  });
  it("returns null for junk", () => {
    expect(phoneNorm("555")).toBeNull();
    expect(phoneNorm(null)).toBeNull();
    expect(lastFour("")).toBeNull();
  });
});

describe("decideAgreementSms", () => {
  const ok = { phone: "(615) 555-0142", suppressed: false, smsConfigured: true, now: DAY };
  it("sends to a valid, opted-in number during the day", () => {
    expect(decideAgreementSms(ok)).toEqual({ action: "send", to: "+16155550142" });
  });
  it("blocks with no usable phone", () => {
    expect(decideAgreementSms({ ...ok, phone: null })).toMatchObject({ action: "blocked", code: "no_phone" });
    expect(decideAgreementSms({ ...ok, phone: "12345" })).toMatchObject({ action: "blocked", code: "no_phone" });
  });
  it("blocks opted-out numbers before anything else about delivery", () => {
    expect(decideAgreementSms({ ...ok, suppressed: true })).toMatchObject({ action: "blocked", code: "suppressed" });
    expect(decideAgreementSms({ ...ok, suppressed: true, smsConfigured: false, now: NIGHT })).toMatchObject({ code: "suppressed" });
  });
  it("blocks when texting isn't set up", () => {
    expect(decideAgreementSms({ ...ok, smsConfigured: false })).toMatchObject({ action: "blocked", code: "not_configured" });
  });
  it("blocks outside texting hours", () => {
    expect(decideAgreementSms({ ...ok, now: NIGHT })).toMatchObject({ action: "blocked", code: "quiet_hours" });
  });
});

describe("agreementSmsBody", () => {
  const url = "https://rentzivo.com/sign/abc123";
  it("includes the link, the 72-hour note and STOP", () => {
    const b = agreementSmsBody("Jane", url, "615-555-0100");
    expect(b).toContain(url);
    expect(b).toContain("Hi Jane, your rental agreement");
    expect(b).toContain("72 hours");
    expect(b).toContain("Questions? 615-555-0100.");
    expect(b.endsWith("Reply STOP to opt out.")).toBe(true);
    expect(b.startsWith("Zivo:")).toBe(true);
  });
  it("copes with no name or support number", () => {
    const b = agreementSmsBody(null, url, null);
    expect(b).toContain("Zivo: Your rental agreement");
    expect(b).not.toContain("Questions?");
  });
  it("stays within two text segments", () => {
    expect(agreementSmsBody("Christopher", "https://rentzivo.com/sign/" + "x".repeat(43), "615-555-0100").length).toBeLessThan(320);
  });
});
