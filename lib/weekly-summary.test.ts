import { describe, expect, it } from "vitest";
import { attentionItems, buildWeeklySummary, lastFullWeek, type SummaryInput } from "./weekly-summary";

const base: SummaryInput = {
  weekLabel: "Oct 5 to Oct 11", links: { business: "https://admin.rentzivo.com/staff/business", workQueue: "https://admin.rentzivo.com/staff/work-queue" },
  rent: 1350, prevRent: 900, refunds: 0, net: 1350, prevNet: 900, atRisk: 0, atRiskCount: 0, upcoming: 450, utilizationPct: 67,
  leads: 12, applied: 5, pickedUp: 2, waitingApps: 0, oldestWaitingHours: null, unansweredMessages: 0, carsLosing: [],
  carProfitBefore: 800, carProfitAfter: 620, carsWithoutCosts: 0, adSpend: 0, costPerPickup: null, adMore: [], adCut: [], miles: 0, trips: 0,
  trackers: { reporting: 3, withTracker: 3, fleetSize: 3 },
};

describe("lastFullWeek", () => {
  it("is the Monday to Sunday week before the Monday the email goes out", () => {
    const w = lastFullWeek(new Date("2026-10-12T12:00:00Z")); // Monday
    expect(w.from.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(w.prevFrom.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(w.label).toBe("Oct 5 to Oct 11");
  });
  it("on any other day it is still the last completed week", () => {
    expect(lastFullWeek(new Date("2026-10-15T09:00:00Z")).from.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });
});

describe("attentionItems", () => {
  it("is empty on a quiet week", () => {
    expect(attentionItems(base)).toEqual([]);
  });
  it("lists problems with correct singular/plural wording", () => {
    const items = attentionItems({
      ...base, atRisk: 450, atRiskCount: 1, waitingApps: 2, oldestWaitingHours: 30, unansweredMessages: 1, carsLosing: ["Camry (ABC)", "Civic (XYZ)", "Corolla (QQQ)"],
      adCut: ["google_ads"], adMore: ["meta_ads"], trackers: { reporting: 1, withTracker: 2, fleetSize: 3 }, carsWithoutCosts: 2,
    });
    expect(items[0]).toBe("$450 of rent is failed or overdue (1 payment).");
    expect(items).toContain("2 applications are waiting; the oldest has waited 30 hours.");
    expect(items).toContain("1 customer message has no reply yet.");
    expect(items).toContain("Camry (ABC), Civic (XYZ) and Corolla (QQQ) lost money this week.");
    expect(items).toContain("1 car has no GPS tracker.");
    expect(items).toContain("2 cars have no costs entered, so profit is overstated.");
  });
  it("does not flag applications waiting under a day", () => {
    expect(attentionItems({ ...base, waitingApps: 1, oldestWaitingHours: 5 })).toEqual([]);
  });
});

describe("buildWeeklySummary", () => {
  it("subject reflects the net and the number of items", () => {
    expect(buildWeeklySummary(base).subject).toBe("Zivo week of Oct 5 to Oct 11: $1,350 net cash, all quiet");
    expect(buildWeeklySummary({ ...base, atRiskCount: 1, atRisk: 100 }).subject).toContain("1 thing need you");
  });
  it("includes the key numbers and links in text and html", () => {
    const s = buildWeeklySummary(base);
    expect(s.text).toContain("Rent collected: $1,350 (+50% vs the week before)");
    expect(s.text).toContain("Leads → applied → picked up: 12 → 5 → 2");
    expect(s.html).toContain("https://admin.rentzivo.com/staff/business");
  });
  it("escapes anything that could break the html", () => {
    const s = buildWeeklySummary({ ...base, carsLosing: ["<script>x</script> & Co"] });
    expect(s.html).not.toContain("<script>");
    expect(s.html).toContain("&lt;script&gt;");
  });
  it("handles a brand new business with no data", () => {
    const s = buildWeeklySummary({ ...base, rent: 0, prevRent: 0, net: 0, prevNet: 0, upcoming: 0, utilizationPct: null, leads: 0, applied: 0, pickedUp: 0, carProfitBefore: 0, carProfitAfter: 0 });
    expect(s.text).toContain("Fleet in use: –");
    expect(s.text).not.toContain("NaN");
  });
});
