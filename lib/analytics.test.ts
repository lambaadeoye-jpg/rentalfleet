import { describe, expect, it } from "vitest";
import {
  applicationAging, callSummary, cashSummary, changePct, collections, depositsHeld, funnelRows, inboxResponse, medianDecisionHours,
  niceMax, parseRange, pickupsByDay, weekStart, weekStarts, weeklyUtilization, formatHours, median,
} from "./analytics";

const NOW = new Date("2026-10-14T15:00:00.000Z"); // a Wednesday

describe("parseRange", () => {
  it("defaults to 30 days ending today, with the previous 30 days for comparison", () => {
    const r = parseRange({}, NOW);
    expect(r.days).toBe(30);
    expect(r.to.toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(r.from.toISOString()).toBe("2026-09-15T00:00:00.000Z");
    expect(r.prevTo.getTime()).toBe(r.from.getTime());
    expect(r.prevFrom.toISOString()).toBe("2026-08-16T00:00:00.000Z");
  });
  it("accepts the presets only", () => {
    expect(parseRange({ days: "7" }, NOW).days).toBe(7);
    expect(parseRange({ days: "90" }, NOW).days).toBe(90);
    expect(parseRange({ days: "12" }, NOW).days).toBe(30);
  });
  it("accepts a custom inclusive range", () => {
    const r = parseRange({ from: "2026-10-01", to: "2026-10-07" }, NOW);
    expect(r.key).toBe("custom");
    expect(r.days).toBe(7);
    expect(r.to.toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });
  it("ignores bad, reversed or too long custom ranges", () => {
    expect(parseRange({ from: "2026-13-40", to: "2026-10-07" }, NOW).key).toBe("30");
    expect(parseRange({ from: "2026-10-09", to: "2026-10-01" }, NOW).key).toBe("30");
    expect(parseRange({ from: "2024-01-01", to: "2026-10-01" }, NOW).key).toBe("30");
  });
});

describe("weeks", () => {
  it("starts on Monday", () => {
    expect(weekStart(NOW).toISOString().slice(0, 10)).toBe("2026-10-12");
    expect(weekStart(new Date("2026-10-18T23:00:00Z")).toISOString().slice(0, 10)).toBe("2026-10-12");
  });
  it("lists every week that touches the range", () => {
    expect(weekStarts(new Date("2026-10-07T00:00:00Z"), new Date("2026-10-15T00:00:00Z"))).toEqual(["2026-10-05", "2026-10-12"]);
  });
});

describe("cashSummary", () => {
  const from = new Date("2026-10-05T00:00:00Z");
  const to = new Date("2026-10-15T00:00:00Z");
  it("is all zeros with an empty database", () => {
    const s = cashSummary([], [], from, to);
    expect(s.rent).toBe(0);
    expect(s.net).toBe(0);
    expect(s.weeks.length).toBe(2);
  });
  it("counts paid rent by week, keeps deposits out of income, and subtracts succeeded refunds only", () => {
    const s = cashSummary(
      [
        { amount: "450.00", kind: "rent", status: "paid", paid_at: "2026-10-06T12:00:00Z" },
        { amount: 450, kind: "rent", status: "paid", paid_at: "2026-10-13T12:00:00Z" },
        { amount: 100, kind: "deposit", status: "paid", paid_at: "2026-10-06T12:00:00Z" },
        { amount: 450, kind: "rent", status: "failed", paid_at: null },
        { amount: 450, kind: "rent", status: "paid", paid_at: "2026-09-01T12:00:00Z" },
      ],
      [
        { status: "succeeded", rent_refund_cents: 5000, deposit_refund_cents: 10000, completed_at: "2026-10-13T10:00:00Z" },
        { status: "pending_approval", rent_refund_cents: 9999, deposit_refund_cents: 0, completed_at: null },
      ],
      from,
      to,
    );
    expect(s.rent).toBe(900);
    expect(s.depositsReceived).toBe(100);
    expect(s.refunds).toBe(50);
    expect(s.net).toBe(850);
    expect(s.weeks[0]).toMatchObject({ start: "2026-10-05", rent: 450, refunds: 0 });
    expect(s.weeks[1]).toMatchObject({ start: "2026-10-12", rent: 450, refunds: 50, net: 400 });
  });
});

describe("collections and deposits", () => {
  it("splits what is paid, coming up and at risk", () => {
    const c = collections(
      [
        { amount: 450, kind: "rent", status: "paid", paid_at: "2026-10-10T00:00:00Z" },
        { amount: 450, kind: "rent", status: "scheduled", paid_at: null },
        { amount: 450, kind: "rent", status: "delinquent", paid_at: null },
        { amount: 450, kind: "rent", status: "retrying", paid_at: null },
        { amount: 100, kind: "deposit", status: "failed", paid_at: null },
      ],
      new Date("2026-10-01T00:00:00Z"),
      new Date("2026-10-15T00:00:00Z"),
    );
    expect(c).toEqual({ paidThisPeriod: 450, upcoming: 450, atRisk: 900, atRiskCount: 2 });
  });
  it("holds deposits received minus deposits refunded, never below zero", () => {
    expect(depositsHeld([{ amount: 100, kind: "deposit", status: "paid", paid_at: null }], [{ status: "succeeded", rent_refund_cents: 0, deposit_refund_cents: 3000, completed_at: null }])).toBe(70);
    expect(depositsHeld([], [{ status: "succeeded", rent_refund_cents: 0, deposit_refund_cents: 3000, completed_at: null }])).toBe(0);
  });
});

describe("weeklyUtilization", () => {
  it("is zero with no rentals or no fleet", () => {
    expect(weeklyUtilization([], 3, new Date("2026-10-05T00:00:00Z"), new Date("2026-10-15T00:00:00Z"), NOW).map((w) => w.pct)).toEqual([0, 0]);
    expect(weeklyUtilization([{ status: "active", pickup_confirmed_at: "2026-10-05T00:00:00Z", actual_return_at: null, expected_return_at: null }], 0, new Date("2026-10-05T00:00:00Z"), new Date("2026-10-15T00:00:00Z"), NOW)[0].pct).toBe(0);
  });
  it("counts car-days out on rent, clips to now, and ignores cancelled or not-yet-picked-up rentals", () => {
    const rentals = [
      { status: "active", pickup_confirmed_at: "2026-10-05T00:00:00Z", actual_return_at: null, expected_return_at: "2026-10-19T00:00:00Z" },
      { status: "cancelled", pickup_confirmed_at: "2026-10-05T00:00:00Z", actual_return_at: null, expected_return_at: null },
      { status: "scheduled", pickup_confirmed_at: null, actual_return_at: null, expected_return_at: null },
    ];
    const u = weeklyUtilization(rentals, 2, new Date("2026-10-05T00:00:00Z"), new Date("2026-10-15T00:00:00Z"), NOW);
    expect(u[0].pct).toBe(50); // 7 car-days of 14
    expect(u[1].pct).toBe(Math.round((2.625 / 14) * 100)); // Monday to Wednesday 15:00
  });
});

describe("funnel and calls", () => {
  it("maps and ranks sources by renters who picked up", () => {
    const rows = funnelRows([
      { label: "a", leads_count: "10", applied_count: 4, approved_count: 2, picked_up_count: 1 },
      { label: "b", leads_count: 5, applied_count: 3, approved_count: 3, picked_up_count: 3 },
    ]);
    expect(rows[0].label).toBe("b");
    expect(rows[1].leads).toBe(10);
  });
  it("summarises calls by assistant", () => {
    const s = callSummary([
      { assistant_key: "new_lead", metrics: { outcome: "committed_to_complete" } },
      { assistant_key: "new_lead", metrics: { outcome: "not_interested" } },
      { assistant_key: "front_desk", metrics: null },
    ]);
    expect(s.total).toBe(3);
    expect(s.byAssistant[0]).toEqual({ assistant: "new_lead", calls: 2, positive: 1, needsHuman: 0 });
    expect(callSummary([]).total).toBe(0);
  });
});

describe("work queue", () => {
  it("buckets waiting applications by age", () => {
    const h = (n: number) => new Date(NOW.getTime() - n * 3600000).toISOString();
    const a = applicationAging(
      [
        { status: "submitted", submitted_at: h(1), decision_at: null },
        { status: "review", submitted_at: h(10), decision_at: null },
        { status: "screening", submitted_at: h(30), decision_at: null },
        { status: "submitted", submitted_at: h(100), decision_at: null },
        { status: "approved", submitted_at: h(100), decision_at: h(1) },
        { status: "draft", submitted_at: null, decision_at: null },
      ],
      NOW,
    );
    expect(a.buckets.map((b) => b.count)).toEqual([1, 1, 1, 1]);
    expect(a.waiting).toBe(4);
    expect(a.oldestHours).toBe(100);
    expect(applicationAging([], NOW)).toMatchObject({ waiting: 0, oldestHours: null });
  });
  it("takes the median time to decide, for decisions inside the range", () => {
    const r = medianDecisionHours(
      [
        { status: "approved", submitted_at: "2026-10-10T00:00:00Z", decision_at: "2026-10-10T02:00:00Z" },
        { status: "declined", submitted_at: "2026-10-10T00:00:00Z", decision_at: "2026-10-10T10:00:00Z" },
        { status: "approved", submitted_at: "2026-09-01T00:00:00Z", decision_at: "2026-09-05T00:00:00Z" },
      ],
      new Date("2026-10-01T00:00:00Z"),
      new Date("2026-10-15T00:00:00Z"),
    );
    expect(r).toEqual({ median: 6, decided: 2 });
    expect(medianDecisionHours([], new Date(), new Date())).toEqual({ median: null, decided: 0 });
  });
  it("measures time to answer and counts unanswered messages", () => {
    const ev = (customer: string, direction: string, at: string, handled: string | null = null) => ({ customer_id: customer, lead_id: null, direction, event_type: "message", created_at: at, handled_at: handled });
    const r = inboxResponse(
      [
        ev("c1", "inbound", "2026-10-10T10:00:00Z"),
        ev("c1", "outbound", "2026-10-10T10:30:00Z"),
        ev("c2", "inbound", "2026-10-10T10:00:00Z"),
        ev("c2", "outbound", "2026-10-10T16:00:00Z"),
        ev("c3", "inbound", "2026-10-11T10:00:00Z"),
        ev("c4", "inbound", "2026-10-11T10:00:00Z", "2026-10-11T11:00:00Z"),
      ],
      new Date("2026-10-01T00:00:00Z"),
      new Date("2026-10-15T00:00:00Z"),
      NOW,
    );
    expect(r).toEqual({ medianMinutes: 195, answered: 2, unanswered: 1, slowOver4h: 1 });
    expect(inboxResponse([], new Date(), new Date(), NOW)).toEqual({ medianMinutes: null, answered: 0, unanswered: 0, slowOver4h: 0 });
  });
  it("counts pickups for each of the next 7 days", () => {
    const d = pickupsByDay(["2026-10-14T20:00:00Z", "2026-10-14T21:00:00Z", "2026-10-20T01:00:00Z", "2026-10-30T00:00:00Z", null], NOW);
    expect(d.length).toBe(7);
    expect(d[0]).toEqual({ day: "2026-10-14", count: 2 });
    expect(d[6]).toEqual({ day: "2026-10-20", count: 1 });
  });
});

describe("helpers", () => {
  it("changePct is null with nothing to compare", () => {
    expect(changePct(110, 100)).toBe(10);
    expect(changePct(50, 100)).toBe(-50);
    expect(changePct(10, 0)).toBeNull();
  });
  it("niceMax gives clean axis tops", () => {
    expect([0, 3, 12, 48, 130, 730].map(niceMax)).toEqual([10, 5, 20, 50, 200, 1000]);
  });
  it("median and hour formatting", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(formatHours(null)).toBe("–");
    expect(formatHours(0.5)).toBe("30 min");
    expect(formatHours(6)).toBe("6 h");
    expect(formatHours(72)).toBe("3.0 days");
  });
});
