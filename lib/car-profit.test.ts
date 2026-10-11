import { describe, expect, it } from "vitest";
import { carProfit, carProfitTotals, carLabel, ownedDays, vehicleAt } from "./car-profit";

const FROM = new Date("2026-09-01T00:00:00.000Z");
const TO = new Date("2026-10-01T00:00:00.000Z"); // 30 days
const car = (id: string, plate = id) => ({ id, year: 2021, make: "Toyota", model: "Camry", plate, status: "rented" });
const cost = (vehicle_id: string, o: Record<string, unknown> = {}) => ({
  vehicle_id, purchase_price: 15000, purchased_on: null, monthly_loan: 0, monthly_insurance: 0, monthly_other: 0, management_fee_monthly: 0, partner_share_pct: 0, ...o,
});
const pay = (rental_id: string, amount: number, paid_at: string, o: Record<string, unknown> = {}) => ({ rental_id, amount, kind: "rent", status: "paid", paid_at, ...o });

describe("vehicleAt", () => {
  const segs = [
    { rental_id: "r", vehicle_id: "A", starts_at: "2026-09-01T00:00:00Z" },
    { rental_id: "r", vehicle_id: "B", starts_at: "2026-09-15T00:00:00Z" },
  ];
  it("picks the car the renter was in at the time", () => {
    expect(vehicleAt(segs, "2026-09-10T00:00:00Z")).toBe("A");
    expect(vehicleAt(segs, "2026-09-20T00:00:00Z")).toBe("B");
  });
  it("uses the first car if paid before any segment started, and handles none", () => {
    expect(vehicleAt(segs, "2026-08-01T00:00:00Z")).toBe("A");
    expect(vehicleAt([], "2026-09-10T00:00:00Z")).toBeNull();
  });
});

describe("ownedDays", () => {
  it("counts the whole range with no purchase date, and only the owned part with one", () => {
    expect(ownedDays(null, FROM, TO)).toBe(30);
    expect(ownedDays("2026-09-21", FROM, TO)).toBe(10);
    expect(ownedDays("2026-11-01", FROM, TO)).toBe(0);
    expect(ownedDays("2020-01-01", FROM, TO)).toBe(30);
  });
});

describe("carProfit", () => {
  const segs = [{ rental_id: "r1", vehicle_id: "A", starts_at: "2026-08-20T00:00:00Z" }];

  it("returns nothing for an empty fleet", () => {
    expect(carProfit([], [], [], [], [], [], [], FROM, TO)).toEqual([]);
  });

  it("revenue is rent collected minus rent refunded; deposits, unpaid and out-of-range payments do not count", () => {
    const [a] = carProfit(
      [car("A")], [], segs,
      [pay("r1", 450, "2026-09-05T00:00:00Z"), pay("r1", 450, "2026-09-12T00:00:00Z"), pay("r1", 300, "2026-09-12T00:00:00Z", { kind: "deposit" }),
       pay("r1", 450, "2026-09-19T00:00:00Z", { status: "failed" }), pay("r1", 450, "2026-10-02T00:00:00Z")],
      [{ rental_id: "r1", status: "succeeded", rent_refund_cents: 10000, completed_at: "2026-09-20T00:00:00Z" },
       { rental_id: "r1", status: "pending", rent_refund_cents: 99999, completed_at: "2026-09-20T00:00:00Z" }],
      [], [], FROM, TO,
    );
    expect(a.revenue).toBe(800);
  });

  it("subtracts completed maintenance and waived tolls, ignores open work and charged tolls", () => {
    const [a] = carProfit(
      [car("A")], [], segs, [pay("r1", 1000, "2026-09-05T00:00:00Z")], [],
      [{ vehicle_id: "A", status: "completed", cost: 120, downtime_end: "2026-09-10T00:00:00Z", approved_at: null },
       { vehicle_id: "A", status: "open", cost: 500, downtime_end: null, approved_at: null },
       { vehicle_id: "A", status: "completed", cost: 80, downtime_end: "2026-08-10T00:00:00Z", approved_at: null }],
      [{ vehicle_id: "A", status: "waived", amount: 15, created_at: "2026-09-11T00:00:00Z" },
       { vehicle_id: "A", status: "charged", amount: 40, created_at: "2026-09-11T00:00:00Z" },
       { vehicle_id: null, status: "waived", amount: 9, created_at: "2026-09-11T00:00:00Z" }],
      FROM, TO,
    );
    expect(a.maintenance).toBe(120);
    expect(a.tolls).toBe(15);
    expect(a.before).toBe(865);
  });

  it("pro-rates monthly loan, insurance and other costs by days owned", () => {
    const [full, half] = carProfit(
      [car("A"), car("B")],
      [cost("A", { monthly_loan: 365.25, monthly_insurance: 304.375 }), cost("B", { monthly_loan: 365.25, purchased_on: "2026-09-16" })],
      [], [], [], [], [], FROM, TO,
    ).sort((x, y) => x.id.localeCompare(y.id));
    // 30 days / 30.4375 = 0.98563 months
    expect(full.loan).toBeCloseTo(360.0, 0);
    expect(full.insurance).toBeCloseTo(300.0, 0);
    expect(half.loan).toBeCloseTo(180.0, 0);
  });

  it("fee comes off first, then the owner gets their % of what is left; Zivo keeps the fee plus its split", () => {
    // Revenue 1500 in a 30-day range; fee 152.19/month * (30/30.4375) = ~150; owner 40%.
    const [a] = carProfit(
      [car("A")], [cost("A", { management_fee_monthly: 152.1875, partner_share_pct: 40 })],
      [{ rental_id: "r1", vehicle_id: "A", starts_at: "2026-08-20T00:00:00Z" }],
      [pay("r1", 1500, "2026-09-05T00:00:00Z")], [], [], [], FROM, TO,
    );
    expect(a.before).toBe(1500);
    expect(a.fee).toBe(150);
    expect(a.distributable).toBe(1350);
    expect(a.partnerShare).toBe(540);
    expect(a.after).toBe(960); // 150 fee + 810 Zivo's 60%
  });

  it("owner share applies to profit only; a loss stays with Zivo and no fee is taken", () => {
    const [b] = carProfit(
      [car("B")], [cost("B", { management_fee_monthly: 100, partner_share_pct: 40, monthly_loan: 3043.75 })],
      [{ rental_id: "r2", vehicle_id: "B", starts_at: "2026-08-20T00:00:00Z" }],
      [pay("r2", 500, "2026-09-05T00:00:00Z")], [], [], [], FROM, TO,
    );
    expect(b.before).toBeLessThan(0);
    expect(b.fee).toBe(0);
    expect(b.partnerShare).toBe(0);
    expect(b.after).toBe(b.before);
  });

  it("fee is capped at the profit, and a Zivo-owned car has no split", () => {
    const [a, z] = carProfit(
      [car("A"), car("Z")], [cost("A", { management_fee_monthly: 1000, partner_share_pct: 50 }), cost("Z")],
      [{ rental_id: "r1", vehicle_id: "A", starts_at: "2026-08-20T00:00:00Z" }, { rental_id: "r2", vehicle_id: "Z", starts_at: "2026-08-20T00:00:00Z" }],
      [pay("r1", 200, "2026-09-05T00:00:00Z"), pay("r2", 200, "2026-09-05T00:00:00Z")], [], [], [], FROM, TO,
    ).sort((x, y) => x.id.localeCompare(y.id));
    expect(a.fee).toBe(200);
    expect(a.distributable).toBe(0);
    expect(a.partnerShare).toBe(0);
    expect(a.after).toBe(200);
    expect(z.partnerShare).toBe(0);
    expect(z.after).toBe(200);
  });

  it("sorts worst first, flags cars with no costs entered, and totals", () => {
    const rows = carProfit(
      [car("A"), car("B")], [cost("B", { monthly_loan: 3043.75 })],
      [{ rental_id: "r1", vehicle_id: "A", starts_at: "2026-08-20T00:00:00Z" }],
      [pay("r1", 700, "2026-09-05T00:00:00Z")], [], [], [], FROM, TO,
    );
    expect(rows[0].id).toBe("B");
    expect(rows.find((r) => r.id === "A")!.hasCosts).toBe(false);
    expect(rows.find((r) => r.id === "B")!.hasCosts).toBe(true);
    const t = carProfitTotals(rows);
    expect(t.losing).toBe(1);
    expect(t.revenue).toBe(700);
  });

  it("ignores payments for cars not in the list and payments without a rental", () => {
    const rows = carProfit([car("A")], [], segs, [pay("zzz", 100, "2026-09-05T00:00:00Z"), { rental_id: null, amount: 50, kind: "rent", status: "paid", paid_at: "2026-09-05T00:00:00Z" }], [], [], [], FROM, TO);
    expect(rows[0].revenue).toBe(0);
  });
});

describe("carLabel", () => {
  it("builds a readable name", () => {
    expect(carLabel({ id: "x", year: 2020, make: "Honda", model: "Civic", plate: "ABC123", status: "x" })).toBe("2020 Honda Civic (ABC123)");
    expect(carLabel({ id: "x", year: null, make: null, model: null, plate: null, status: "x" })).toBe("Vehicle");
  });
});
