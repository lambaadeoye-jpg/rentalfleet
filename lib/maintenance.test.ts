import { describe, expect, it } from "vitest";
import { needsApproval, parseCost, parseLimit, settlementNote, validateFinish, validateStart } from "./maintenance";

describe("limit and approval", () => {
  it("defaults to $150 and reads a saved number", () => {
    expect(parseLimit(null)).toBe(150);
    expect(parseLimit("")).toBe(150);
    expect(parseLimit("abc")).toBe(150);
    expect(parseLimit("-5")).toBe(150);
    expect(parseLimit("200")).toBe(200);
    expect(parseLimit(" 75.50 ")).toBe(75.5);
  });
  it("only a cost above the limit needs approval", () => {
    expect(needsApproval(150, 150)).toBe(false);
    expect(needsApproval(150.01, 150)).toBe(true);
    expect(needsApproval(0, 150)).toBe(false);
  });
});

describe("parseCost", () => {
  it("accepts plain amounts including zero", () => {
    expect(parseCost("45")).toBe(45);
    expect(parseCost("$45.50")).toBe(45.5);
    expect(parseCost("0")).toBe(0);
    expect(parseCost("0.00")).toBe(0);
  });
  it("rejects junk", () => {
    for (const t of ["", "abc", "4.555", "-3", "1,000", "12.5.1"]) expect(parseCost(t)).toBeNull();
  });
});

describe("validateStart", () => {
  const ok = { vehicleId: "v1", workType: "Oil change", performedBy: "runner", shopName: "", paymentArrangement: "runner_reimburse", notes: "" };
  it("accepts a runner job and a shop job", () => {
    expect(validateStart(ok)).toMatchObject({ ok: true, value: { performedBy: "runner", shopName: null } });
    expect(validateStart({ ...ok, performedBy: "shop", shopName: " Joe’s Tire ", paymentArrangement: "company_pays_shop" })).toMatchObject({ ok: true, value: { shopName: "Joe’s Tire" } });
  });
  it("requires the basics", () => {
    expect(validateStart({ ...ok, vehicleId: "" })).toMatchObject({ ok: false });
    expect(validateStart({ ...ok, workType: "  " })).toMatchObject({ ok: false });
    expect(validateStart({ ...ok, performedBy: "robot" })).toMatchObject({ ok: false });
    expect(validateStart({ ...ok, paymentArrangement: "cash" })).toMatchObject({ ok: false });
  });
  it("needs a shop name for a shop job, and no 'pay the shop' without one", () => {
    expect(validateStart({ ...ok, performedBy: "shop", shopName: " " })).toMatchObject({ ok: false });
    expect(validateStart({ ...ok, paymentArrangement: "company_pays_shop" })).toMatchObject({ ok: false });
  });
});

describe("validateFinish", () => {
  it("completes at or under the limit and sends the rest to the office", () => {
    expect(validateFinish({ costText: "60", paymentArrangement: "company_card", receiptCount: 0, limit: 150 })).toEqual({ ok: true, cost: 60, outcome: "completed" });
    expect(validateFinish({ costText: "150", paymentArrangement: "company_card", receiptCount: 0, limit: 150 })).toMatchObject({ outcome: "completed" });
    expect(validateFinish({ costText: "320.00", paymentArrangement: "company_pays_shop", receiptCount: 0, limit: 150 })).toMatchObject({ outcome: "pending_approval" });
  });
  it("needs a cost, and a receipt when the runner paid", () => {
    expect(validateFinish({ costText: "", paymentArrangement: "company_card", receiptCount: 1, limit: 150 })).toMatchObject({ ok: false });
    expect(validateFinish({ costText: "40", paymentArrangement: "runner_reimburse", receiptCount: 0, limit: 150 })).toMatchObject({ ok: false });
    expect(validateFinish({ costText: "40", paymentArrangement: "runner_reimburse", receiptCount: 1, limit: 150 })).toMatchObject({ ok: true });
    expect(validateFinish({ costText: "0", paymentArrangement: "runner_reimburse", receiptCount: 0, limit: 150 })).toMatchObject({ ok: true, cost: 0 });
  });
});

describe("settlementNote", () => {
  it("says what is still owed", () => {
    expect(settlementNote("runner_reimburse", 42.5, false)).toBe("Reimburse the runner $42.50");
    expect(settlementNote("company_pays_shop", 300, false)).toBe("Pay the shop $300.00");
  });
  it("says nothing when settled, free, unknown, or paid by card", () => {
    expect(settlementNote("runner_reimburse", 42.5, true)).toBeNull();
    expect(settlementNote("runner_reimburse", 0, false)).toBeNull();
    expect(settlementNote("runner_reimburse", null, false)).toBeNull();
    expect(settlementNote("company_card", 80, false)).toBeNull();
  });
});
