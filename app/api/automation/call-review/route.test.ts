import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fake Supabase: call_review rows live in `state.rows`; every write is recorded.
type Row = Record<string, unknown>;
const state = {
  rows: [] as Row[],
  apps: [] as Row[],
  matches: [] as unknown[],
  upserts: [] as { table: string; rows: unknown; opts: unknown }[],
  updates: [] as { id: unknown; patch: Row }[],
  deletes: 0,
  upsertError: null as null | { message: string },
};

function builder(table: string) {
  let isHead = false;
  let nullTags = false;
  let patch: Row | null = null;
  let isDelete = false;
  const b: Record<string, unknown> = {};
  const chain = () => b;
  b.select = (_c?: string, o?: { head?: boolean }) => { isHead = Boolean(o?.head); return b; };
  b.eq = (col: string, val: unknown) => { if (patch && col === "id") state.updates.push({ id: val, patch }); return b; };
  b.is = (col: string) => { if (col === "tags") nullTags = true; return b; };
  b.gte = chain; b.lt = chain; b.in = chain; b.order = chain; b.limit = chain;
  b.update = (p: Row) => { patch = p; return b; };
  b.delete = () => { isDelete = true; state.deletes++; return b; };
  b.upsert = (rows: unknown, opts: unknown) => { state.upserts.push({ table, rows, opts }); return Promise.resolve({ error: state.upsertError }); };
  b.maybeSingle = () => Promise.resolve({ data: table === "tenant" ? { id: "t1" } : null, error: null });
  b.then = (resolve: (v: unknown) => unknown) => {
    let data: unknown[] = [];
    if (table === "call_review" && !isDelete && !patch) {
      data = nullTags ? state.rows.filter((r) => r.tags == null) : state.rows;
    }
    if (table === "application") data = state.apps;
    // after an update, the row now has tags
    if (patch && table === "call_review") {
      const last = state.updates[state.updates.length - 1];
      const row = state.rows.find((r) => r.id === last?.id);
      if (row) row.tags = patch.tags;
    }
    return Promise.resolve({ data, count: isHead ? data.length : null, error: null }).then(resolve);
  };
  return b;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (t: string) => builder(t),
    rpc: (name: string) => Promise.resolve({ data: name === "match_caller_by_phone" ? state.matches : null, error: null }),
  }),
}));

import { POST } from "./route";

const FRONT_DESK = "0b75801d-6873-4358-ae1b-94fb7cce5650";
const NEW_LEAD = "31cb3413-5f3e-4ac3-a74b-0eed9e9a577b";

function call(body: Record<string, unknown>, secret = "s3cret") {
  return POST(new Request("http://x/api/automation/call-review", {
    method: "POST",
    headers: { "x-automation-secret": secret, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function rawCall(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    assistantId: FRONT_DESK,
    startedAt: "2026-10-05T14:00:00Z",
    endedAt: "2026-10-05T14:03:00Z",
    endedReason: "customer-ended-call",
    customer: { number: "+16155551234" },
    artifact: {
      messages: [
        { role: "assistant", message: "Hi, this is Zivo's virtual assistant. How can I help?" },
        { role: "user", message: "My number is 615-555-1234 and I want to know the deposit." },
        { role: "assistant", message: "Your deposit is $300." },
      ],
    },
    ...over,
  };
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.AUTOMATION_API_SECRET = "s3cret";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://sb";
  delete process.env.ANTHROPIC_API_KEY;
  Object.assign(state, { rows: [], apps: [], matches: [], upserts: [], updates: [], deletes: 0, upsertError: null });
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("call-review auth and input", () => {
  it("rejects a wrong secret", async () => {
    expect((await call({ action: "ingest", calls: [] }, "nope")).status).toBe(401);
  });
  it("rejects an unknown action", async () => {
    expect((await call({ action: "wat" })).status).toBe(400);
  });
  it("rejects more than 25 calls", async () => {
    const res = await call({ action: "ingest", calls: Array.from({ length: 26 }, (_, i) => rawCall(`c${i}`)) });
    expect(res.status).toBe(400);
  });
});

describe("call-review ingest", () => {
  it("stores redacted transcripts with checks, skips unknown assistants, ignores duplicates", async () => {
    state.matches = [{ kind: "lead", id: "L1", customer_id: "C1" }];
    const res = await call({ action: "ingest", calls: [rawCall("k1"), rawCall("k2", { assistantId: "someone-else" }), "junk"] });
    expect(await res.json()).toEqual({ stored: 1, skipped: 2 });
    const up = state.upserts.find((u) => u.table === "call_review")!;
    expect(up.opts).toEqual({ onConflict: "tenant_id,vapi_call_id", ignoreDuplicates: true });
    const row = (up.rows as Row[])[0];
    expect(row.assistant_key).toBe("front_desk");
    expect(row.lead_id).toBe("L1");
    expect(row.customer_id).toBe("C1");
    expect(String(row.transcript)).not.toContain("555-1234");
    expect(JSON.stringify(row.checks)).toContain("deposit_amount");
    expect(state.deletes).toBe(1); // retention sweep
  });

  it("returns 500 when the store fails", async () => {
    state.upsertError = { message: "boom" };
    expect((await call({ action: "ingest", calls: [rawCall("k1")] })).status).toBe(500);
  });
});

describe("call-review tag", () => {
  const long = { userTurns: 3 };
  it("reports llm:false without an API key and changes nothing", async () => {
    state.rows = [{ id: "r1", tags: null, transcript: "x", assistant_key: "front_desk", metrics: long }];
    expect(await (await call({ action: "tag" })).json()).toEqual({ llm: false, tagged: 0, remaining: 1 });
    expect(state.updates).toHaveLength(0);
  });

  it("tags short calls without the AI and long calls through it; a bad AI reply becomes 'unavailable'", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    state.rows = [
      { id: "short", tags: null, transcript: "x", assistant_key: "front_desk", metrics: { userTurns: 1 } },
      { id: "long", tags: null, transcript: "AI: hi\nUser: a\nUser: b", assistant_key: "front_desk", metrics: long },
    ];
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "not json at all" }] }), { status: 200 })) as unknown as typeof fetch;
    const res = await (await call({ action: "tag" })).json();
    expect(res).toEqual({ llm: true, tagged: 2, remaining: 0 });
    const byId = Object.fromEntries(state.updates.map((u) => [String(u.id), (u.patch.tags as { intent: string }).intent]));
    expect(byId.short).toBe("no conversation");
    expect(byId.long).toBe("unavailable");
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });
});

describe("call-review report", () => {
  const period = { periodStart: "2026-09-28T13:00:00Z", periodEnd: "2026-10-05T13:00:00Z" };
  it("requires a valid period", async () => {
    expect((await call({ action: "report_input" })).status).toBe(400);
    expect((await call({ action: "report_input", periodStart: period.periodEnd, periodEnd: period.periodStart })).status).toBe(400);
  });
  it("report_input returns null request when there are no calls", async () => {
    expect(await (await call({ action: "report_input", ...period })).json()).toEqual({ callCount: 0, anthropicRequest: null });
  });
  it("report_input returns an Anthropic request when calls exist", async () => {
    state.rows = [{ vapi_call_id: "k1", assistant_key: "front_desk", started_at: "2026-10-01T10:00:00Z", duration_s: 60, ended_reason: "x", customer_id: null, metrics: { userTurns: 2 }, checks: [], tags: null }];
    const j = await (await call({ action: "report_input", ...period })).json();
    expect(j.callCount).toBe(1);
    expect(j.anthropicRequest.model).toBeTruthy();
    expect(Array.isArray(j.anthropicRequest.messages)).toBe(true);
  });
  it("report_finish falls back to a numbers-only report on bad AI text, stores it, and returns the email", async () => {
    state.rows = [{ vapi_call_id: "k1", assistant_key: "front_desk", started_at: "2026-10-01T10:00:00Z", duration_s: 60, ended_reason: "x", customer_id: null, metrics: { userTurns: 2 }, checks: [], tags: null }];
    const j = await (await call({ action: "report_finish", modelText: "garbage", ...period })).json();
    expect(j.llm).toBe(false);
    expect(j.stored).toBe(true);
    expect(typeof j.subject).toBe("string");
    expect(j.html).toContain("<");
    expect(state.upserts.some((u) => u.table === "call_review_report")).toBe(true);
  });
  it("report_finish still works with no modelText", async () => {
    const j = await (await call({ action: "report_finish", ...period })).json();
    expect(j.llm).toBe(false);
    expect(j.subject).toBeTruthy();
  });
});
