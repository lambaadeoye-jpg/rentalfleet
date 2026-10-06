import { describe, it, expect } from "vitest";
import {
  parseInboundKeyword, isWithinSendWindow, nextSendTime, decideSend, OUTREACH_PLAN,
  MAX_TOUCHES, areaCodeOf, renderTemplate, SMS_TEMPLATES, type LeadState,
} from "./outreach-rules";

const base: LeadState = {
  hasConsent: true, suppressed: false, redFlagged: false, hasInboundReply: false,
  progressed: false, touchesSent: 0, hasPhone: true, hasEmail: true,
};
const step = (k: string) => OUTREACH_PLAN.find((s) => s.key === k)!;
// 2026-10-06 is CDT (UTC-5). 18:00Z = 1pm Central; 03:00Z = 10pm Central.
const noon = new Date("2026-10-06T18:00:00Z");
const night = new Date("2026-10-07T03:00:00Z");

describe("parseInboundKeyword", () => {
  it.each(["STOP", "stop.", " Stop ", "UNSUBSCRIBE", "cancel", "End", "QUIT", "stop all", "stop texting me", "don't text me", "Please remove me", "opt out", "no more texts"])(
    "stop: %s", (b) => expect(parseInboundKeyword(b)).toBe("stop")
  );
  it("start/help/yes/change", () => {
    expect(parseInboundKeyword("START")).toBe("start");
    expect(parseInboundKeyword("help")).toBe("help");
    expect(parseInboundKeyword("Yes!")).toBe("yes");
    expect(parseInboundKeyword("change")).toBe("change");
  });
  it("ordinary text is null", () => {
    expect(parseInboundKeyword("what time can I pick up?")).toBeNull();
    expect(parseInboundKeyword("")).toBeNull();
  });
});

describe("send window", () => {
  it("Nashville midday ok, 10pm not", () => {
    expect(isWithinSendWindow("615-555-0101", noon)).toBe(true);
    expect(isWithinSendWindow("615-555-0101", night)).toBe(false);
  });
  it("unknown area code uses strict window", () => {
    expect(areaCodeOf("+1 (999) 555-0101")).toBe("999");
    expect(isWithinSendWindow("999-555-0101", noon)).toBe(true);
    expect(isWithinSendWindow("999-555-0101", new Date("2026-10-06T14:30:00Z"))).toBe(false); // 9:30am CT < 10am
  });
  it("eastern number at 8:30am CT is 9:30 ET ok but 8:30am ET (7:30 CT) is not", () => {
    expect(isWithinSendWindow("865-555-0101", new Date("2026-10-06T13:30:00Z"))).toBe(true);
    expect(isWithinSendWindow("865-555-0101", new Date("2026-10-06T12:30:00Z"))).toBe(false);
  });
  it("nextSendTime moves night to next morning", () => {
    const t = nextSendTime("615-555-0101", night);
    expect(isWithinSendWindow("615-555-0101", t)).toBe(true);
    expect(t.getTime()).toBeGreaterThan(night.getTime());
  });
});

describe("decideSend", () => {
  it("sends welcome sms with consent in hours", () => {
    expect(decideSend(step("sms_welcome"), base, "6155550101", noon).action).toBe("send");
  });
  it("skips sms/call without consent but still emails", () => {
    const l = { ...base, hasConsent: false };
    expect(decideSend(step("sms_welcome"), l, "6155550101", noon)).toEqual({ action: "skip", reason: "no_consent" });
    expect(decideSend(step("ai_call"), l, "6155550101", noon)).toEqual({ action: "skip", reason: "no_consent" });
    expect(decideSend(step("email_welcome"), l, "6155550101", noon).action).toBe("send");
  });
  it("defers during quiet hours", () => {
    const d = decideSend(step("ai_call"), base, "6155550101", night);
    expect(d.action).toBe("defer");
  });
  it("suppressed blocks everything including email", () => {
    expect(decideSend(step("email_nudge"), { ...base, suppressed: true }, "6155550101", noon).action).toBe("skip");
  });
  it("red flag, progressed, replied stop follow-ups", () => {
    expect(decideSend(step("sms_nudge"), { ...base, redFlagged: true }, "6155550101", noon)).toEqual({ action: "skip", reason: "red_flag_staff_review" });
    expect(decideSend(step("sms_nudge"), { ...base, progressed: true }, "6155550101", noon)).toEqual({ action: "skip", reason: "lead_progressed" });
    expect(decideSend(step("ai_call"), { ...base, hasInboundReply: true }, "6155550101", noon)).toEqual({ action: "skip", reason: "person_replied" });
  });
  it("touch cap", () => {
    expect(decideSend(step("sms_last"), { ...base, touchesSent: MAX_TOUCHES }, "6155550101", noon)).toEqual({ action: "skip", reason: "touch_cap" });
  });
});

describe("plan and templates", () => {
  it("has 8 steps with unique keys, email needs no consent", () => {
    expect(OUTREACH_PLAN).toHaveLength(8);
    expect(new Set(OUTREACH_PLAN.map((s) => s.key)).size).toBe(8);
    expect(OUTREACH_PLAN.filter((s) => s.channel === "email").every((s) => !s.needsConsent)).toBe(true);
    expect(OUTREACH_PLAN.filter((s) => s.channel !== "email").every((s) => s.needsConsent)).toBe(true);
  });
  it("every sms names Zivo, has STOP, and never mentions approval", () => {
    for (const t of Object.values(SMS_TEMPLATES)) {
      expect(t.startsWith("Zivo:")).toBe(true);
      expect(t).toMatch(/STOP/);
      expect(t.toLowerCase()).not.toMatch(/approv|declin|denied|accepted/);
    }
  });
  it("renders vars", () => expect(renderTemplate("Hi {first} {x}", { first: "Sam" })).toBe("Hi Sam "));
});
