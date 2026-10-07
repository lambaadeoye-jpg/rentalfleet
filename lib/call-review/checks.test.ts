import { describe, it, expect } from "vitest";
import { redact } from "./redact";
import { normalizeCall } from "./normalize";
import { runChecks, scanText, reportedOutcome } from "./checks";
import type { NormalizedCall } from "./types";

const base = (over: Partial<NormalizedCall>): NormalizedCall => ({
  id: "c1", assistantKey: "front_desk", startedAt: null, endedAt: null, durationS: 60, endedReason: "customer-ended-call",
  turns: [], toolCalls: [], phone: null, ...over,
});
const rules = (c: NormalizedCall) => runChecks(c).map((f) => f.rule);

describe("redact", () => {
  it("masks phones, emails, links, long numbers and spoken numbers", () => {
    const out = redact("Call 615-555-1234 or (615) 555 1234, mail me at sam@example.com, https://x.co/a?t=1, card 4242 4242 4242 4242, six one five five five five one two three four, sam dot lee at gmail dot com");
    expect(out).not.toMatch(/615|sam@|4242|https|gmail|six one/i);
    expect(out).toContain("[PHONE]");
    expect(out).toContain("[EMAIL]");
    expect(out).toContain("[LINK]");
    expect(out).toContain("[NUMBER]");
  });
  it("leaves ordinary text and prices alone", () => {
    expect(redact("Weekly is $450 and the first 3 days are $220.")).toBe("Weekly is $450 and the first 3 days are $220.");
  });
});

describe("normalizeCall", () => {
  it("reads Vapi artifact messages, tool calls and results", () => {
    const c = normalizeCall({
      id: "abc", assistantId: "0b75801d-6873-4358-ae1b-94fb7cce5650", startedAt: "2026-10-07T15:00:00Z", endedAt: "2026-10-07T15:02:30Z",
      endedReason: "assistant-ended-call", customer: { number: "+16155551234" },
      artifact: { messages: [
        { role: "assistant", message: "Thanks for calling Zivo." },
        { role: "user", message: "Hi, status check" },
        { role: "tool_calls", toolCalls: [{ id: "t1", function: { name: "verify_caller", arguments: "{\"email\":\"a@b.co\"}" } }] },
        { role: "tool_call_result", toolCallId: "t1", name: "verify_caller", result: "{\"verified\":true}" },
        { role: "tool_calls", toolCalls: [{ id: "t2", function: { name: "get_application_status", arguments: { email: "a@b.co" } } }] },
        { role: "tool_call_result", toolCallId: "t2", name: "get_application_status", result: "This tool is unavailable right now." },
      ] },
    });
    expect(c?.assistantKey).toBe("front_desk");
    expect(c?.durationS).toBe(150);
    expect(c?.turns).toHaveLength(2);
    expect(c?.toolCalls.map((t) => [t.name, t.failed])).toEqual([["verify_caller", false], ["get_application_status", true]]);
    expect(c?.phone).toBe("+16155551234");
  });
  it("ignores calls from other assistants and falls back to a plain transcript", () => {
    expect(normalizeCall({ id: "x", assistantId: "someone-else" })).toBeNull();
    const c = normalizeCall({ id: "y", assistantId: "31cb3413-5f3e-4ac3-a74b-0eed9e9a577b", transcript: "AI: Hey there\nUser: hello" });
    expect(c?.turns.map((t) => t.role)).toEqual(["assistant", "user"]);
  });
});

describe("runChecks", () => {
  it("flags promises, guarantees, deposit amounts, mileage and approval hints", () => {
    const c = base({ turns: [
      { role: "assistant", text: "You'll have a car within 24 hours, guaranteed." },
      { role: "assistant", text: "The deposit is $300." },
      { role: "assistant", text: "You get 150 miles per day." },
      { role: "assistant", text: "Good news, you're approved!" },
    ] });
    expect(rules(c)).toEqual(expect.arrayContaining(["promised_timeframe", "guarantee", "deposit_amount", "mileage_limit", "outcome_hint"]));
  });
  it("allows the approved timing phrase, unlimited mileage, and negated guarantees", () => {
    const c = base({ turns: [
      { role: "assistant", text: "Many customers can move through the process in less than 24 hours when the required information is completed promptly." },
      { role: "assistant", text: "Both plans include unlimited mileage, so no 150 miles per day cap." },
      { role: "assistant", text: "I can't guarantee approval." },
      { role: "assistant", text: "Weekly is $450, and a refundable deposit is set by the team." },
    ] });
    expect(rules(c)).toEqual([]);
  });
  it("flags callback timing promises but not pickup talk", () => {
    expect(rules(base({ turns: [{ role: "assistant", text: "A team member will call you back within an hour." }] }))).toContain("callback_timing");
    expect(rules(base({ assistantKey: "pickup", turns: [{ role: "assistant", text: "See you tomorrow at two for pickup." }] }))).not.toContain("callback_timing");
  });
  it("downgrades approval wording for the pickup assistant", () => {
    const f = runChecks(base({ assistantKey: "pickup", toolCalls: [{ name: "report_pickup_outcome", args: {}, result: null, failed: false }], turns: [{ role: "assistant", text: "You're approved, so just bring your license." }] }));
    expect(f.find((x) => x.rule === "outcome_hint")?.severity).toBe("medium");
  });
  it("catches an AI denial and a missing AI disclosure, and accepts an honest answer", () => {
    const ask = { role: "user" as const, text: "Wait, am I talking to a real person?" };
    expect(rules(base({ turns: [ask, { role: "assistant", text: "Yes, I'm a real person." }] }))).toContain("ai_denial");
    expect(rules(base({ turns: [ask, { role: "assistant", text: "Sure, what else can I tell you about pricing?" }] }))).toContain("ai_not_disclosed");
    expect(rules(base({ turns: [ask, { role: "assistant", text: "I'm Zivo's virtual assistant. Happy to keep helping." }] }))).toEqual([]);
  });
  it("flags a stop request with no stop tool, and not when the tool was used", () => {
    const turns = [{ role: "user" as const, text: "Please stop calling me, take me off your list." }];
    expect(rules(base({ turns }))).toContain("stop_without_tool");
    expect(rules(base({ turns, toolCalls: [{ name: "stop_contacting", args: {}, result: "ok", failed: false }] }))).not.toContain("stop_without_tool");
  });
  it("requires exactly one outcome report on outbound assistants", () => {
    expect(rules(base({ assistantKey: "new_lead" }))).toContain("missing_outcome_report");
    const two = ["report_call_outcome", "report_call_outcome"].map((name) => ({ name, args: {}, result: null, failed: false }));
    expect(rules(base({ assistantKey: "new_lead", toolCalls: two }))).toContain("duplicate_outcome_report");
    expect(rules(base({ assistantKey: "front_desk" }))).not.toContain("missing_outcome_report");
  });
  it("flags tool failures and error endings", () => {
    const c = base({ endedReason: "pipeline-error-openai-llm-failed", toolCalls: [{ name: "verify_caller", args: {}, result: "error", failed: true }] });
    expect(rules(c)).toEqual(expect.arrayContaining(["tool_failure", "call_error"]));
  });
  it("redacts quotes it stores", () => {
    const f = runChecks(base({ turns: [{ role: "assistant", text: "Guaranteed. Call me at 615-555-1234." }] }));
    expect(JSON.stringify(f)).not.toContain("615-555-1234");
  });
  it("reads the outcome the assistant reported", () => {
    const c = base({ assistantKey: "nudge", toolCalls: [{ name: "report_application_outcome", args: { outcome: "committed_to_finish" }, result: null, failed: false }] });
    expect(reportedOutcome(c)).toBe("committed_to_finish");
  });
  it("scanText works on proposed wording", () => {
    expect(scanText("Tell callers the deposit is $200.").map((r) => r.rule)).toContain("deposit_amount");
    expect(scanText("Offer to text the application link.")).toEqual([]);
  });
});
