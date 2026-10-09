import { describe, it, expect } from "vitest";
import {
  STARTER_CLAUSES, STARTER_INTRO, STARTER_VARIABLES, renderAgreement, buildRentalValues, validateTemplate, hasCounselNotes,
  unknownPlaceholders, templatePlaceholders, nameMatches, missingInitials, initialsMatchName, money, type RentalFacts, type AgreementTemplate,
} from "./agreement";

const template: AgreementTemplate = { intro: STARTER_INTRO, clauses: STARTER_CLAUSES };
const facts: RentalFacts = {
  firstName: "Ann", lastName: "Baker",
  vehicle: { year: 2019, make: "Toyota", model: "Camry", plate: "ABC123", vin: "1HGBH41JXMN109186" },
  pickupAt: "2026-10-08T15:00:00Z", returnAt: "2026-10-15T15:00:00Z",
  weeklyRateUsd: 185, quotedTotalUsd: null, depositUsd: 250, returnLocation: "Zivo Main, 1 Main St, Nashville, TN",
  cancellation: { approved: true, late_fee_usd: 65, early_fee_usd: 25, free_cancellations_per_90d: 2, late_window_hours: 24, noshow_grace_hours: 2, rebook_days: 7, toll_ticket_window_days: 60 },
};

describe("starter template", () => {
  it("is structurally valid with 19 clauses and known placeholders only", () => {
    expect(validateTemplate(template)).toBeNull();
    expect(STARTER_CLAUSES).toHaveLength(23);
    expect(unknownPlaceholders(template)).toEqual([]);
  });
  it("requires initials on exactly clauses 2,3,4,5,9,10", () => {
    expect(STARTER_CLAUSES.filter((c) => c.initial).map((c) => c.number)).toEqual([3, 10, 11, 13, 14, 15]);
  });
  it("flags open counsel notes", () => expect(hasCounselNotes(template)).toBe(true));
});

describe("render", () => {
  it("fills everything for a complete rental", () => {
    const values = buildRentalValues(facts, STARTER_VARIABLES);
    const r = renderAgreement(template, values);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const all = r.rendered.intro + r.rendered.clauses.map((c) => c.body).join(" ");
    expect(all).not.toMatch(/\{\{/);
    expect(r.rendered.intro).toContain("Ann Baker");
    expect(r.rendered.intro).toContain("Weekly rent: $185");
    expect(r.rendered.intro).toContain("Deposit: $250");
    expect(r.rendered.intro).toContain("weekly, 1 week");
    const body = (n: number) => r.rendered.clauses.find((c) => c.number === n)!.body;
    expect(body(3)).toContain("$6 flat for each toll");
    expect(body(3)).toContain("$25 for each ticket");
    expect(body(4)).toContain("$75");
    expect(body(13)).toContain("deposit of $250");
    expect(body(15)).toContain("deductible of $1,000");
    expect(body(18)).toContain("1.5% per month");
    expect(body(11)).toContain("gig, ride-hail and delivery platforms");
  });
  it("refuses to render with blanks and names what is missing", () => {
    const withFees: AgreementTemplate = { intro: "Fee {{late_fee}} {{early_fee}} {{late_window_hours}}", clauses: [{ number: 1, title: "T", body: "b", initial: false }] };
    const r = renderAgreement(withFees, buildRentalValues({ ...facts, cancellation: { ...facts.cancellation!, approved: false } }, STARTER_VARIABLES));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(expect.arrayContaining(["late_fee", "early_fee", "late_window_hours"]));
  });
  it("missing deposit or vehicle blocks too", () => {
    const r = renderAgreement(template, buildRentalValues({ ...facts, depositUsd: null, vehicle: null }, STARTER_VARIABLES));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(expect.arrayContaining(["deposit", "vehicle"]));
  });
  it("daily plan uses a term total and falls back when pickup is unscheduled", () => {
    const v = buildRentalValues({ ...facts, weeklyRateUsd: null, quotedTotalUsd: 310, pickupAt: null, returnAt: null }, STARTER_VARIABLES);
    expect(v.rent_line).toBe("Rent for the term: $310");
    expect(v.term).toBe("daily plan, 7 days");
    expect(v.start_at).toMatch(/pickup time we confirm/);
  });
  it("multi-week term", () => {
    const v = buildRentalValues({ ...facts, returnAt: "2026-10-22T15:00:00Z" }, STARTER_VARIABLES);
    expect(v.term).toBe("weekly, 2 weeks");
  });
  it("template with a typo placeholder is rejected", () => {
    const bad = { intro: "Hi {{renter_nam}}", clauses: [{ number: 1, title: "T", body: "b", initial: false }] };
    expect(validateTemplate(bad)).toMatch(/renter_nam/);
    expect(templatePlaceholders(bad)).toEqual(["renter_nam"]);
  });
  it("does not let a renter's name inject placeholders", () => {
    const r = renderAgreement({ intro: "{{renter_name}}", clauses: [{ number: 1, title: "T", body: "{{deposit}}", initial: false }] }, { renter_name: "{{deposit}}", deposit: "$1" });
    expect(r.ok && r.rendered.intro).toBe("{{deposit}}"); // substituted once, not re-expanded
  });
});

describe("template validation", () => {
  it("rejects duplicates, empties, bad numbers", () => {
    expect(validateTemplate({ intro: "", clauses: [] })).toMatch(/opening/);
    expect(validateTemplate({ intro: "x", clauses: [] })).toMatch(/at least one/);
    expect(validateTemplate({ intro: "x", clauses: [{ number: 1, title: "a", body: "b", initial: false }, { number: 1, title: "c", body: "d", initial: false }] })).toMatch(/twice/);
    expect(validateTemplate({ intro: "x", clauses: [{ number: 0, title: "a", body: "b", initial: false }] })).toMatch(/whole numbers/);
    expect(validateTemplate({ intro: "x", clauses: [{ number: 1, title: "", body: "b", initial: false }] })).toMatch(/title and text/);
  });
});

describe("signing checks", () => {
  it("name match", () => {
    expect(nameMatches("Ann Baker", "Ann", "Baker")).toBe(true);
    expect(nameMatches("ann marie baker", "Ann", "Baker")).toBe(true);
    expect(nameMatches("Ann", "Ann", "Baker")).toBe(false);
    expect(nameMatches("Bob Baker", "Ann", "Baker")).toBe(false);
    expect(nameMatches("Ann Smith", "Ann", "Baker")).toBe(false);
    expect(nameMatches("", "Ann", "Baker")).toBe(false);
  });
  it("initials required for each flagged clause", () => {
    expect(missingInitials(STARTER_CLAUSES, {})).toEqual([3, 10, 11, 13, 14, 15]);
    expect(missingInitials(STARTER_CLAUSES, { "3": "AB", "10": "AB", "11": "AB", "13": "AB", "14": "AB", "15": "AB" })).toEqual([]);
    expect(missingInitials(STARTER_CLAUSES, { "3": "A", "10": "AB1", "11": "AB", "13": "AB", "14": "AB", "15": "AB" })).toEqual([3, 10]);
  });
  it("initials resemble the name", () => {
    expect(initialsMatchName("AB", "Ann Baker")).toBe(true);
    expect(initialsMatchName("ab", "Ann Marie Baker")).toBe(true);
    expect(initialsMatchName("ZZ", "Ann Baker")).toBe(false);
  });
  it("money", () => { expect(money(65)).toBe("$65"); expect(money(65.5)).toBe("$65.50"); });

  it("uses the decided fees and wording", () => {
    const values = buildRentalValues(facts, STARTER_VARIABLES);
    const r = renderAgreement(template, values);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const body = (n: number) => r.rendered.clauses.find((c) => c.number === n)!.body;
    expect(body(18)).toContain("by 5 PM on its due date");
    expect(body(18)).toContain("late fee of $50");
    expect(body(8)).toContain("$250");
    expect(body(9)).toContain("$250");
    expect(body(3)).not.toMatch(/automatic toll/i);
    expect(body(11)).toContain("Greater Nashville");
    expect(body(15)).toContain("only to an at-fault accident or a breach");
    expect(body(12)).toContain("We do not cover tires");
  });
});
