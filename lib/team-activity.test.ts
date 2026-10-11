import { describe, expect, it } from "vitest";
import { actionLabel, categorize, personRows, personWeekly, recentActions } from "./team-activity";

const FROM = new Date("2026-09-14T00:00:00Z");
const TO = new Date("2026-09-28T00:00:00Z");
const a = (actor: string | null, action: string, at: string, entity: string | null = null) => ({ actor_user_id: actor, action, entity_id: entity, created_at: at });

describe("categorize", () => {
  it("groups known actions and sends the rest to Other", () => {
    expect(categorize("application_decision")).toBe("Applications");
    expect(categorize("payment_recorded")).toBe("Payments & charges");
    expect(categorize("toll_charged")).toBe("Payments & charges");
    expect(categorize("rental_pickup_confirmed")).toBe("Pickups & runners");
    expect(categorize("maintenance_job_started")).toBe("Fleet & maintenance");
    expect(categorize("do_not_rent_added")).toBe("Flags & bans");
    expect(categorize("pricing_updated")).toBe("Other");
  });
});

describe("personRows", () => {
  const submitted = new Map([["app1", "2026-09-15T08:00:00Z"], ["app2", "2026-09-16T08:00:00Z"]]);
  const audit = [
    a("va", "application_decision", "2026-09-15T10:00:00Z", "app1"), // 2h
    a("va", "application_decision", "2026-09-16T14:00:00Z", "app2"), // 6h
    a("va", "payment_recorded", "2026-09-17T09:00:00Z"),
    a("boss", "pricing_updated", "2026-09-18T09:00:00Z"),
    a(null, "payment_recorded", "2026-09-18T09:00:00Z"), // system
    a("va", "payment_recorded", "2026-10-30T09:00:00Z"), // outside
  ];
  const handled = [
    { handled_by: "va", created_at: "2026-09-19T09:00:00Z", handled_at: "2026-09-19T09:30:00Z" },
    { handled_by: "va", created_at: "2026-09-19T10:00:00Z", handled_at: "2026-09-19T11:30:00Z" },
    { handled_by: null, created_at: "2026-09-19T10:00:00Z", handled_at: "2026-09-19T11:30:00Z" },
  ];
  const rows = personRows(audit, handled, submitted, FROM, TO);

  it("counts per person, busiest first, ignoring system rows and out-of-range rows", () => {
    expect(rows.map((r) => r.userId)).toEqual(["va", "boss"]);
    expect(rows[0].total).toBe(5);
    expect(rows[0].byCategory.Applications).toBe(2);
    expect(rows[0].byCategory["Payments & charges"]).toBe(1);
    expect(rows[0].byCategory["Messages handled"]).toBe(2);
    expect(rows[1].byCategory.Other).toBe(1);
  });
  it("median hours to decide and minutes to handle", () => {
    expect(rows[0].decided).toBe(2);
    expect(rows[0].medianHoursToDecide).toBe(4);
    expect(rows[0].medianMinutesToHandle).toBe(60);
    expect(rows[1].medianHoursToDecide).toBeNull();
  });
  it("last active is the latest action", () => {
    expect(rows[0].lastActive).toBe("2026-09-19T11:30:00Z");
  });
  it("empty input gives no rows", () => {
    expect(personRows([], [], new Map(), FROM, TO)).toEqual([]);
  });
});

describe("personWeekly and recentActions", () => {
  const audit = [a("va", "payment_recorded", "2026-09-15T10:00:00Z"), a("va", "payment_recorded", "2026-09-23T10:00:00Z"), a("va", "rental_runner_assigned", "2026-09-24T10:00:00Z"), a("x", "payment_recorded", "2026-09-24T10:00:00Z")];
  it("counts by Monday week, including empty weeks", () => {
    expect(personWeekly("va", audit, [], FROM, TO)).toEqual([{ start: "2026-09-14", count: 1 }, { start: "2026-09-21", count: 2 }]);
    expect(personWeekly("nobody", audit, [], FROM, TO).every((w) => w.count === 0)).toBe(true);
  });
  it("lists newest first with readable labels", () => {
    const r = recentActions("va", audit);
    expect(r[0]).toEqual({ label: "Assigned a runner", at: "2026-09-24T10:00:00Z" });
    expect(actionLabel("some_new_thing")).toBe("Some new thing");
  });
});
