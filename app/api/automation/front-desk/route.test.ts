import { describe, it, expect, vi, beforeEach } from "vitest";

// A small fake Supabase client: tables return the rows set in `state`, rpc and auth calls are recorded.
const state = {
  matches: [] as unknown[],
  emailOnFile: "renter@example.com",
  failures: 0,
  recentLinks: 0,
  rpcCalls: [] as { name: string; args: unknown }[],
  otpCalls: [] as unknown[],
  otpError: null as null | { message: string },
  events: [] as Record<string, unknown>[],
};

function builder(table: string) {
  let isHead = false;
  let filterType: string | null = null;
  const b: Record<string, unknown> = {};
  const chain = () => b;
  b.select = (_c?: string, o?: { head?: boolean }) => { isHead = Boolean(o?.head); return b; };
  b.eq = (col: string, val: unknown) => { if (col === "event_type") filterType = String(val); return b; };
  b.gte = chain; b.order = chain; b.limit = chain; b.not = chain;
  b.insert = (row: Record<string, unknown>) => { if (table === "communication_event") state.events.push(row); return Promise.resolve({ error: null }); };
  b.maybeSingle = () => Promise.resolve({ data: table === "tenant" ? { id: "t1" } : { email: state.emailOnFile }, error: null });
  b.then = (resolve: (v: unknown) => unknown) => {
    const count = filterType === "auth_failed" ? state.failures : filterType === "portal_link_sent" ? state.recentLinks : 0;
    return Promise.resolve({ data: [], count: isHead ? count : null, error: null }).then(resolve);
  };
  return b;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (t: string) => builder(t),
    rpc: (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      if (name === "match_caller_by_phone") return Promise.resolve({ data: state.matches, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    auth: { signInWithOtp: (a: unknown) => { state.otpCalls.push(a); return Promise.resolve({ error: state.otpError }); } },
  }),
}));

import { POST } from "./route";

function call(body: Record<string, unknown>, secret = "s3cret") {
  return POST(new Request("http://x/api/automation/front-desk", {
    method: "POST",
    headers: { "x-automation-secret": secret, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  process.env.AUTOMATION_API_SECRET = "s3cret";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://sb";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.NEXT_PUBLIC_SITE_URL = "https://rentzivo.com";
  Object.assign(state, { matches: [{ kind: "customer", id: "c1", first_name: "Sam", customer_id: "c1" }], emailOnFile: "renter@example.com", failures: 0, recentLinks: 0, otpError: null });
  state.rpcCalls = []; state.otpCalls = []; state.events = [];
});

describe("front-desk stop_contacting", () => {
  it("records the opt-out for the call's number, ignoring any number in args", async () => {
    const res = await call({ action: "stop_contacting", callerPhone: "+16155551234", callId: "k1", args: { phone: "+19999999999" } });
    expect((await res.json()).success).toBe(true);
    const rec = state.rpcCalls.find((c) => c.name === "record_opt_out");
    expect(rec?.args).toEqual({ p_tenant_id: "t1", p_phone: "+16155551234", p_source: "voice_request" });
    expect(state.events.some((e) => e.event_type === "callback_request")).toBe(true);
  });
  it("does nothing without a number on the call", async () => {
    const res = await call({ action: "stop_contacting", callerPhone: "", args: {} });
    expect((await res.json()).success).toBe(false);
    expect(state.rpcCalls.find((c) => c.name === "record_opt_out")).toBeUndefined();
  });
  it("rejects a wrong secret", async () => {
    const res = await call({ action: "stop_contacting", callerPhone: "+16155551234" }, "nope");
    expect(res.status).toBe(401);
  });
});

describe("front-desk send_portal_link", () => {
  it("emails the address on file after verification, never one the caller states", async () => {
    const res = await call({ action: "send_portal_link", callerPhone: "+16155551234", callId: "k2", args: { email: "Renter@Example.com" } });
    const j = await res.json();
    expect(j.sent).toBe(true);
    expect(state.otpCalls).toHaveLength(1);
    expect((state.otpCalls[0] as { email: string; options: { shouldCreateUser: boolean } }).email).toBe("renter@example.com");
    expect((state.otpCalls[0] as { options: { shouldCreateUser: boolean } }).options.shouldCreateUser).toBe(false);
    expect(JSON.stringify(j)).not.toContain("renter@example.com");
    expect(state.events.some((e) => e.event_type === "portal_link_sent")).toBe(true);
  });
  it("sends nothing when the email does not match", async () => {
    const res = await call({ action: "send_portal_link", callerPhone: "+16155551234", args: { email: "other@example.com" } });
    expect((await res.json()).verified).toBe(false);
    expect(state.otpCalls).toHaveLength(0);
  });
  it("sends nothing to a lead with no renter account", async () => {
    state.matches = [{ kind: "lead", id: "l1", first_name: "Sam", customer_id: null }];
    const res = await call({ action: "send_portal_link", callerPhone: "+16155551234", args: { email: "renter@example.com" } });
    const j = await res.json();
    expect(j.sent).toBe(false);
    expect(j.reason).toBe("no_account_yet");
    expect(state.otpCalls).toHaveLength(0);
  });
  it("stops after 3 links in an hour", async () => {
    state.recentLinks = 3;
    const j = await (await call({ action: "send_portal_link", callerPhone: "+16155551234", args: { email: "renter@example.com" } })).json();
    expect(j.sent).toBe(false);
    expect(state.otpCalls).toHaveLength(0);
  });
  it("does not send when the caller is locked out", async () => {
    state.failures = 99;
    const j = await (await call({ action: "send_portal_link", callerPhone: "+16155551234", args: { email: "renter@example.com" } })).json();
    expect(j.locked).toBe(true);
    expect(state.otpCalls).toHaveLength(0);
  });
  it("reports unavailable when the email cannot be sent", async () => {
    state.otpError = { message: "smtp" };
    const j = await (await call({ action: "send_portal_link", callerPhone: "+16155551234", args: { email: "renter@example.com" } })).json();
    expect(j.sent).toBe(false);
    expect(state.events.some((e) => e.event_type === "portal_link_sent")).toBe(false);
  });
});
