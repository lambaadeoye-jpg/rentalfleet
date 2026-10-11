import { describe, expect, it } from "vitest";
import { channelRows, monthStart, rankChannels, spendBySource } from "./ad-spend";

const f = (label: string, leads: number, applied: number, pickedUp: number) => ({ label, leads, applied, approved: applied, pickedUp });

describe("spendBySource", () => {
  it("pro-rates a month by overlapping days and sums rows for the same source", () => {
    const rows = [{ month: "2026-09-01", source: "meta_ads", amount: 300 }, { month: "2026-10-01", source: "meta_ads", amount: 310 }];
    // Sep 16 to Oct 11 = 15 days of Sep (half of 30) + 10 days of Oct (10/31)
    const m = spendBySource(rows, new Date("2026-09-16T00:00:00Z"), new Date("2026-10-11T00:00:00Z"));
    expect(m.get("meta_ads")).toBeCloseTo(150 + 100, 1);
  });
  it("ignores months outside the window and bad month values", () => {
    const m = spendBySource([{ month: "2026-01-01", source: "x", amount: 99 }, { month: "bad", source: "y", amount: 5 }], new Date("2026-09-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));
    expect(m.size).toBe(0);
  });
  it("a full month inside the window counts in full", () => {
    const m = spendBySource([{ month: "2026-09-01", source: "g", amount: 200 }], new Date("2026-08-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z"));
    expect(m.get("g")).toBe(200);
  });
});

describe("channelRows", () => {
  it("computes cost per lead, application and pickup, and never divides by zero", () => {
    const [a, b] = channelRows([f("meta_ads", 40, 10, 4), f("homepage", 5, 1, 0)], new Map([["meta_ads", 200]]));
    expect(a.costPerLead).toBe(5);
    expect(a.costPerApplication).toBe(20);
    expect(a.costPerPickup).toBe(50);
    expect(a.enoughData).toBe(true);
    expect(b.spend).toBe(0);
    expect(b.costPerLead).toBeNull();
  });
  it("shows a channel that has spend but no leads", () => {
    const rows = channelRows([], new Map([["google_ads", 150]]));
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("google_ads");
    expect(rows[0].costPerLead).toBeNull();
  });
});

describe("rankChannels", () => {
  it("ranks cheapest per pickup first and labels spend more / cut", () => {
    const rows = channelRows(
      [f("meta_ads", 50, 10, 10), f("google_ads", 50, 10, 2), f("facebook_marketplace", 40, 8, 4), f("homepage", 30, 5, 3)],
      new Map([["meta_ads", 200], ["google_ads", 400], ["facebook_marketplace", 160]]),
    );
    const r = rankChannels(rows);
    expect(r[0].row.label).toBe("meta_ads"); // $20 per pickup vs average 760/16 = 47.5
    expect(r[0].verdict).toBe("more");
    expect(r.find((x) => x.row.label === "google_ads")!.verdict).toBe("cut"); // $200 per pickup
    expect(r.find((x) => x.row.label === "facebook_marketplace")!.verdict).toBe("keep"); // $40 is near the $47.50 average
    expect(r[r.length - 1].verdict).toBe("free");
  });
  it("says wait when a paid channel has too few leads, and cut when spend produced nothing", () => {
    const r = rankChannels(channelRows([f("tiktok", 5, 1, 0), f("meta_ads", 30, 6, 0)], new Map([["tiktok", 50], ["meta_ads", 100]])));
    expect(r.find((x) => x.row.label === "tiktok")!.verdict).toBe("wait");
    expect(r.find((x) => x.row.label === "meta_ads")!.verdict).toBe("cut");
  });
  it("a single paid channel is judged only on whether it produced pickups", () => {
    const r = rankChannels(channelRows([f("meta_ads", 30, 6, 3)], new Map([["meta_ads", 90]])));
    expect(r[0].verdict).toBe("keep");
  });
  it("empty input gives an empty list", () => {
    expect(rankChannels([])).toEqual([]);
  });
});

describe("monthStart", () => {
  it("normalises months and rejects junk", () => {
    expect(monthStart("2026-10")).toBe("2026-10-01");
    expect(monthStart("2026-10-17")).toBe("2026-10-01");
    expect(monthStart("2026-13")).toBeNull();
    expect(monthStart("oct")).toBeNull();
  });
});
