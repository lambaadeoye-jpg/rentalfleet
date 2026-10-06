import { describe, it, expect, vi } from "vitest";
import { processRow, type ClaimedRow, type Deps } from "./outreach-dispatch";

const now = new Date("2026-10-06T18:00:00Z"); // 1pm Central
const row = (o: Partial<ClaimedRow> = {}): ClaimedRow => ({
  id: "m1", tenant_id: "t", lead_id: "l1", step_key: "sms_welcome", channel: "sms", attempts: 1,
  scheduled_for: now.toISOString(), first_name: "Sam", phone: "6155550101", email: "s@x.com",
  has_consent: true, red_flagged: false, stage: "new", customer_id: null, touches_sent: 0,
  has_inbound_reply: false, suppressed: false, ...o,
});
const deps = (o: Partial<Deps> = {}): Deps => ({
  smsConfigured: true,
  sendSms: vi.fn().mockResolvedValue({ ok: true, id: "SM1" }),
  fireCall: vi.fn().mockResolvedValue(true),
  fireEmail: vi.fn().mockResolvedValue(true),
  applyLink: "https://rentzivo.com/apply", now, ...o,
});

describe("processRow", () => {
  it("sends the welcome text with the first name", async () => {
    const d = deps();
    const o = await processRow(row(), d);
    expect(o.kind).toBe("sent");
    expect(d.sendSms).toHaveBeenCalledWith("+16155550101", expect.stringContaining("Sam"));
  });
  it("defers (does not send, does not fail) when Twilio is not configured", async () => {
    const d = deps({ smsConfigured: false });
    const o = await processRow(row(), d);
    expect(o).toMatchObject({ kind: "deferred", reason: "sms_provider_not_configured" });
    expect(d.sendSms).not.toHaveBeenCalled();
  });
  it("drops rows more than 6 hours late", async () => {
    const o = await processRow(row({ scheduled_for: new Date(now.getTime() - 7 * 3600e3).toISOString() }), deps());
    expect(o).toEqual({ kind: "skipped", reason: "stale" });
  });
  it("never sends a text without consent", async () => {
    const d = deps();
    expect(await processRow(row({ has_consent: false }), d)).toEqual({ kind: "skipped", reason: "no_consent" });
    expect(d.sendSms).not.toHaveBeenCalled();
  });
  it("defers during quiet hours", async () => {
    const o = await processRow(row(), deps({ now: new Date("2026-10-07T03:00:00Z") , }));
    // scheduled_for was 1pm yesterday so this is also stale; use fresh schedule
    expect(["deferred", "skipped"]).toContain(o.kind);
    const o2 = await processRow(row({ scheduled_for: "2026-10-07T03:00:00Z" }), deps({ now: new Date("2026-10-07T03:00:00Z") }));
    expect(o2.kind).toBe("deferred");
  });
  it("fires the AI call only through the call trigger", async () => {
    const d = deps();
    const o = await processRow(row({ step_key: "ai_call", channel: "call" }), d);
    expect(o.kind).toBe("sent");
    expect(d.fireCall).toHaveBeenCalledWith("l1");
  });
  it("emails even without consent, and reports a failed trigger as retry", async () => {
    const d = deps({ fireEmail: vi.fn().mockResolvedValue(false) });
    const o = await processRow(row({ step_key: "email_welcome", channel: "email", has_consent: false }), d);
    expect(o).toEqual({ kind: "retry", error: "email_trigger_failed", final: false });
    const o2 = await processRow(row({ step_key: "email_welcome", channel: "email", attempts: 3 }), d);
    expect(o2).toMatchObject({ kind: "retry", final: true });
  });
  it("stops when the lead progressed or opted out", async () => {
    expect(await processRow(row({ stage: "contacted" }), deps())).toMatchObject({ kind: "skipped", reason: "lead_progressed" });
    expect(await processRow(row({ customer_id: "c1" }), deps())).toMatchObject({ kind: "skipped", reason: "lead_progressed" });
    expect(await processRow(row({ suppressed: true }), deps())).toMatchObject({ kind: "skipped", reason: "suppressed" });
  });
  it("sms failure retries", async () => {
    const d = deps({ sendSms: vi.fn().mockResolvedValue({ ok: false, error: "boom" }) });
    expect(await processRow(row(), d)).toEqual({ kind: "retry", error: "boom", final: false });
  });
});
