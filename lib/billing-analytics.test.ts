import { describe, expect, it } from "vitest";
import { dueSoon, dueVsCollected } from "./billing-analytics";

const FROM = new Date("2026-09-14T00:00:00Z"); // Monday
const TO = new Date("2026-09-28T00:00:00Z");
const at = (schedule_id: string, due_at: string, amount_cents: number, status: string) => ({ schedule_id, due_at, amount_cents, status });

describe("dueVsCollected", () => {
  it("counts one charge per due date even after retries, collected if any try succeeded", () => {
    const r = dueVsCollected([
      at("s1", "2026-09-15T14:00:00Z", 45000, "failed"),
      at("s1", "2026-09-15T14:00:00Z", 45000, "succeeded"), // second try worked
      at("s2", "2026-09-16T14:00:00Z", 45000, "failed"),
      at("s2", "2026-09-16T14:00:00Z", 45000, "failed"), // still open
    ], FROM, TO);
    expect(r.weeks[0]).toEqual({ start: "2026-09-14", due: 900, collected: 450, open: 450 });
    expect(r.due).toBe(900);
    expect(r.collected).toBe(450);
    expect(r.open).toBe(450);
    expect(r.collectedPct).toBe(50);
  });
  it("places charges in the week of their due date and ignores ones outside the range", () => {
    const r = dueVsCollected([
      at("s1", "2026-09-22T14:00:00Z", 45000, "succeeded"),
      at("s1", "2026-09-08T14:00:00Z", 45000, "succeeded"), // before
      at("s1", "2026-09-29T14:00:00Z", 45000, "succeeded"), // after
    ], FROM, TO);
    expect(r.weeks.map((w) => w.due)).toEqual([0, 450]);
  });
  it("a try still processing is open, not collected", () => {
    expect(dueVsCollected([at("s1", "2026-09-15T14:00:00Z", 45000, "processing")], FROM, TO).open).toBe(450);
  });
  it("empty input gives empty weeks and no percentage", () => {
    const r = dueVsCollected([], FROM, TO);
    expect(r.weeks.every((w) => w.due === 0)).toBe(true);
    expect(r.collectedPct).toBeNull();
  });
});

describe("dueSoon", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const s = (o: Record<string, unknown>) => ({ status: "active", cadence: "weekly", billing_paused: false, next_due_at: "2026-10-12T14:00:00Z", amount: 450, ...o });
  it("adds up active weekly schedules due within the window", () => {
    const r = dueSoon([s({}), s({ next_due_at: "2026-10-20T14:00:00Z", amount: 300 }), s({ next_due_at: "2026-11-30T00:00:00Z" })], now);
    expect(r).toEqual({ amount: 750, count: 2, nextAt: "2026-10-12T14:00:00Z" });
  });
  it("skips paused, ended, non-weekly and undated schedules", () => {
    const r = dueSoon([s({ billing_paused: true }), s({ status: "ended" }), s({ cadence: "daily" }), s({ next_due_at: null })], now);
    expect(r).toEqual({ amount: 0, count: 0, nextAt: null });
  });
  it("an overdue schedule still counts as due", () => {
    expect(dueSoon([s({ next_due_at: "2026-10-08T14:00:00Z" })], now).count).toBe(1);
  });
});
