// Rental agreement template, rendering and signing rules (Phase 3C). Pure
// functions only: the signed text, the checks on initials and name, and the
// "every blank must be filled" rule are all unit-tested here, then enforced
// again by the database function that records a signature.
//
// STARTER TEXT IS A DRAFT FOR COUNSEL. Anything in [Counsel: ...] brackets is
// an open legal question. A template cannot be approved without an explicit
// acknowledgement while those notes remain.

export type AgreementClause = {
  number: number;
  title: string;
  body: string; // may contain {{placeholders}} and \n line breaks
  initial: boolean; // renter must separately initial this clause
};

export type AgreementTemplate = {
  intro: string;
  clauses: AgreementClause[];
};

export type RenderedAgreement = {
  intro: string;
  clauses: AgreementClause[]; // placeholders filled
};

/** Values the system fills from the rental itself. */
export const RENTAL_PLACEHOLDERS = [
  "renter_name", "vehicle", "start_at", "term", "rent_line", "deposit", "return_location",
  "late_window_hours", "noshow_grace_hours", "rebook_days", "toll_window_days",
  "free_cancellations", "early_fee", "late_fee",
] as const;

/** Values staff fill once per template version (editable in the draft). */
export const VARIABLE_KEYS = [
  "travel_area", "cleaning_cap", "admin_fee", "late_rent_fee", "grace_days", "county",
  "mileage_allowance", "extra_mile_rate", "toll_fee", "deductible", "late_charge_pct", "min_driver_age",
] as const;
export type VariableKey = (typeof VARIABLE_KEYS)[number];

export const VARIABLE_LABELS: Record<VariableKey, string> = {
  travel_area: "Where the vehicle may be driven (e.g. Tennessee and bordering states)",
  cleaning_cap: "Cleaning fee cap, in dollars",
  admin_fee: "Administrative fee for paying a fine, in dollars",
  late_rent_fee: "Late rent fee, in dollars",
  grace_days: "Days of grace before the late fee",
  county: "County whose courts hear disputes",
  mileage_allowance: "Mileage allowance (e.g. Unlimited, or 1,000 miles per week)",
  extra_mile_rate: "Charge per mile over a numeric allowance, in dollars",
  toll_fee: "Administrative charge per toll invoiced, in dollars",
  deductible: "At-fault deductible for renters without their own full coverage, in dollars",
  late_charge_pct: "Monthly late charge on past-due balances, in percent",
  min_driver_age: "Minimum age for any driver",
};

export const AGREEMENT_DOCUMENT_TYPE = "rental_agreement";

export const STARTER_INTRO =
  "Parties. Zivo Mobility LLC, doing business as Zivo (\"Zivo\", \"we\", \"us\"), and {{renter_name}} (\"Renter\", \"you\"). Vehicle: {{vehicle}}. Start: {{start_at}}. Rental: {{term}}. {{rent_line}}. Deposit: {{deposit}}. Zivo rents you the vehicle as its owner or as the authorized operator for its owner, which may be Zivo, an affiliate of Zivo or a third-party owner. You are not our agent for any purpose, and you cannot assign, delegate or transfer your obligations under this agreement.";

export const STARTER_CLAUSES: AgreementClause[] = [
  { number: 1, title: "The rental and term", body: "Zivo rents you the vehicle identified above (the \"car\") for the term above. The term runs from the date and hour of pickup until you return the car to us and complete every term of this agreement. The start date above and the return date we confirm with you are estimates. We may shorten or extend them by mutual consent in writing, and email or a message in your renter portal counts as writing. The minimum rental is 7 days. You get the car only after you have paid the first week's rent and the deposit and shown the documents we require at pickup.", initial: false },
  { number: 2, title: "Mileage", body: "Mileage allowance: {{mileage_allowance}}. If a numeric allowance applies to your rental, each mile over it is charged at ${{extra_mile_rate}} per mile.", initial: false },
  { number: 3, title: "Fees, payment and card", body: "Rent is charged weekly in advance, at the rent shown above, unless we agree otherwise in writing. All payments are by credit or debit card in your own name. We do not accept cash. You authorize Zivo to charge that card for rent as it comes due, the deposit, and any other amount you owe under this agreement, including those in clauses 4, 5, 10, 13 and 15. If a payment fails, we may ask for another card in your name.\nAdministrative charges per incident during the rental: ${{toll_fee}} for each toll invoiced to us, and ${{admin_fee}} for each ticket or citation issued, in addition to the toll or fine itself. If the car has automatic toll payment, the same ${{toll_fee}} charge applies to each use, plus any accounting fee that applies.", initial: true },
  { number: 4, title: "Other charges", body: "(a) Cleaning. You will pay a reasonable cleaning fee, not more than ${{cleaning_cap}}, if stains, dirt, odor or soiling attributable to your use cannot be cleaned with our standard post-rental procedures, as we reasonably determine.\n(b) Keys. If a key or key fob is not returned with the car, you may be charged for it.\n(c) No smoking. We keep a non-smoking fleet, including e-cigarettes and vapes. You will pay an additional charge if the car smells or is soiled from smoke or vapor.\n(d) Third-party billing. You and any third party to whom charges are billed, such as an insurer or employer, are jointly and severally responsible for them. If you direct us to bill a third party, you confirm that you are authorized to do so for that party.\n(e) Pricing errors. Zivo makes every effort to quote prices and descriptions correctly. If there is a manifest error or omission, Zivo may rescind the rental, even after we accepted your reservation or received payment. Our liability is then limited to returning the money you paid for that reservation. If we let you keep the reservation after a manifest error, you will pay the difference between the quoted price and the correct price, as we confirm in writing. A manifest error means a price quoted in error that is more than 15% below the price that would have been quoted without the mistake.", initial: false },
  { number: 5, title: "Taxes, surcharges, fines and expenses", body: "You will pay all applicable taxes and any surcharges or recovery fees shown in the rental records, over and above the base rent.\nYou will pay or reimburse us for all fines, penalties, interest and court costs for parking, traffic, toll and other violations, including storage liens and charges, incurred because of your rental. You will also pay a reasonable administrative fee for any violation of this agreement, such as for recovering the car for any reason. We may, in our sole discretion, pay a ticket, citation, fine, penalty or interest directly to the authority for you. You then reimburse what we paid plus the administrative fee in clause 3 and our reasonable attorneys' fees and expenses. We cooperate with federal, state and local officials who enforce these violations and may give them any information they request or the law requires.", initial: false },
  { number: 6, title: "Changes", body: "A change to this agreement or to our rights must be in writing and signed by an authorized officer of Zivo. We may change our standard terms and conditions from time to time on written notice to you, on paper or electronically. A change applies only to rentals you reserve after the date of that notice.", initial: false },
  { number: 7, title: "Who may drive", body: "You confirm that you are a capable, validly licensed driver and will remain one for the whole term. We may verify that your license is valid and in good standing, check your driving record and identity, and re-check them during the rental, and we may refuse or end a rental if we cannot verify them. Only you, your spouse or domestic partner, each at least {{min_driver_age}} years old, validly licensed and driving with your permission, may drive the car. Anyone else who drives it must first sign an additional driver form, and we may charge for each additional driver. You stay financially responsible under this agreement even when someone else drives. [Counsel: confirm the minimum age and whether additional drivers must be named on the renter's insurance.]", initial: false },
  { number: 8, title: "Return of the car", body: "Return the car in the same condition as you received it, apart from ordinary wear and tear, on the date and at the time we confirmed, at {{return_location}}, with its keys and equipment. You must return it sooner if we demand it. If you return it earlier or later than agreed, a different or higher rate may apply, and if later you may also be charged a late return fee. To extend a rental, contact us or use a method we approve before your return date. We may grant or decline an extension, in whole or in part, in our sole discretion. If you return the car when we are closed, you stay responsible for it until our next inspection.", initial: false },
  { number: 9, title: "Repossession and recovery", body: "We may repossess the car at any time, in our sole discretion, for reasons that include: the rental is not returned when due; the car is parked illegally, used to break the law or this agreement, or appears abandoned. We need not notify you first and may take any lawful action reasonably necessary to obtain the car, including using the tracking equipment in clause 19. We will not enter private property unlawfully. If the car is repossessed, you will pay the actual and reasonable costs we incur, and we may charge them to the card you used. You also forfeit your security deposit if the car is repossessed. [Counsel: confirm self-help repossession rights and notice requirements for a rental in Tennessee.]", initial: false },
  { number: 10, title: "Damage to or loss of the car", body: "If the car is lost or damaged during the rental, you pay us for all loss of or damage to it, regardless of cause or who or what caused it. Clause 15 sets the deductible for at-fault accidents. If the car is damaged, you pay our estimated repair cost. If we decide in our sole discretion to sell it in its damaged condition, you pay the difference between its retail fair market value before the damage and the sale proceeds. If it is stolen and not recovered, you pay its fair market value before the theft. Where the law permits, you authorize us to charge the actual cost of repairing or replacing lost or damaged items such as glass, mirrors, tires and antennas.\nAs part of our loss, you also pay for loss of use of the car, without regard to our fleet utilization, plus an administrative fee and any towing and storage charges (\"Incidental Loss\"). If insurance, a card benefit or another benefit covers your responsibility, you authorize us to contact the provider directly and you assign those benefits to us, to recover repair costs, diminished value or fair market value less salvage, and Incidental Loss. If we collect our loss from a third party after collecting it from you, we refund the difference between what you paid and what we collected.\nReport any accident, theft or damage to us and, where the law requires, to the police as soon as it happens or you learn of it, with a written incident report, and cooperate with our investigation. You may not repair the car, or have it repaired, without our prior written consent. If you do, you pay the estimated cost to restore it to its prior condition. If we authorize a repair that is our responsibility, we reimburse you only against the repair receipt. If the law of the place of the rental sets different limits on your liability, that law prevails. [Counsel: confirm the extent of renter liability for damage regardless of fault.]", initial: true },
  { number: 11, title: "Prohibited uses", body: "You may use the car for personal driving and for work on the gig, ride-hail and delivery platforms you told us about at application. Those platform uses are not a breach of this agreement. Certain other uses and actions are a breach, they automatically end your rental, and they void any protection or optional service you accepted. They also make you liable to us for all penalties, fines, forfeitures, liens, recovery and storage costs, and related attorneys' fees and expenses. A breach is any of the following.\nA. You use or permit the car to be used: (1) by anyone other than a driver allowed in clause 7; (2) to carry property or passengers for hire other than through a platform permitted above, or more passengers than there are seat belts; (3) to tow or push anything; (4) in a test, race or contest, or on unpaved roads; (5) while the driver is under the influence of alcohol, a controlled substance listed under the federal Controlled Substances Act, or medication that affects driving; (6) for conduct that could be charged as a felony or misdemeanor, including transporting a controlled substance, contraband, stolen goods, illegal devices or persons protected by anti-trafficking laws; (7) recklessly or while overloaded; (8) outside {{travel_area}}, or in Mexico, without our written permission; (9) for any commercial purpose other than the platform use permitted above; or (10) while using a hand-held phone or other device to call, text, email or send data.\nB. You or another driver, authorized or not: (1) fail to promptly report damage to or loss of the car, or fail to give us a written incident report or cooperate with our investigation; (2) where the law requires, fail to report an accident to law enforcement; (3) obtained the car by fraud or misrepresentation; (4) leave the car without removing the keys or fobs, or without closing and locking all doors, windows and the trunk, and it is stolen or vandalized; (5) intentionally, or with willful disregard, cause or allow damage to the car; or (6) tamper with or disable the odometer or the tracking equipment.\nC. You or another driver return the car after hours and it is damaged, stolen or vandalized, or you otherwise fail to take reasonable steps to secure the car, its keys, fobs or remote entry and starting devices. [Counsel: confirm the exclusion of insurance and protections for these breaches.]", initial: true },
  { number: 12, title: "Fuel", body: "You may avoid a fuel charge by returning the car with the fuel tank as full as when you received it and, if we ask, showing a receipt for your fuel purchase. Use the correct fuel. If you are unsure, ask us.", initial: false },
  { number: 13, title: "Security deposit", body: "You will provide a security deposit of {{deposit}} (the \"Security Deposit\") for loss of or damage to the car during the rental. In place of collecting it, we may place a hold on a card for the same amount. If the car is damaged, we apply the entire Security Deposit to the cost of repair or replacement. If that cost is more than the Security Deposit, you pay us the balance. A late return, any physical or mechanical damage, or smoking in the car means you forfeit the whole Security Deposit, with no exceptions. If none of those happens and you owe us nothing else, we start a refund of the Security Deposit to the original card within 2 business days after we inspect the car. We may apply the Security Deposit to any other amount you owe under this agreement. [Counsel: confirm a deposit forfeiture of this kind is enforceable in Tennessee and does not operate as a penalty.]", initial: true },
  { number: 14, title: "Cancellations and breakdowns", body: "There are no refunds for cancellations once a car is reserved. If the car breaks down during the rental, we will extend the rental period to make up the lost time. If the breakdown was caused by your negligence, we may cancel the rest of the rental without a refund. If the breakdown was caused by our failure to maintain the car, we will take reasonable care to extend the rental period or give you a substitute car. If we cancel a reservation, or cannot provide the car, you receive a full refund of what you paid for it. [Counsel: confirm a no-refund cancellation term and its disclosure on the website and at checkout.]", initial: true },
  { number: 15, title: "Insurance and at-fault deductible", body: "At the time you sign, you must give us proof of insurance that covers damage to the car, injury to you and your passengers, and other persons and property. If the car is damaged or destroyed while in your possession, you will pay any required insurance deductible and assign to us all rights to collect the insurance proceeds, and you give us the right to file any insurance claim needed to recover our loss. You will not start or file an insurance claim without our written permission. If you do not carry your own full coverage, you must buy the coverage we require from the provider we name before pickup. [Counsel: complete the coverage requirement for renters without their own policy.]\nIf an accident happens and you are found at fault, by police report, insurance determination or our reasonable investigation, you agree to pay a deductible of ${{deductible}} toward the cost of repair or replacement. This deductible applies only to renters who do not have their own full coverage insurance. We may charge it to you at our sole discretion. If the total damage is more than ${{deductible}}, we may pursue further compensation for unreimbursed losses, rental downtime or vehicle replacement. If you do not pay the deductible within 3 business days after we notify you, we may end the rental, you forfeit future rentals, and we may use legal collection efforts.", initial: true },
  { number: 16, title: "Property in the car", body: "We are not responsible for loss of, theft of or damage to any property in or on the car, on our premises, or received or handled by us, whoever is at fault. You are responsible to us for claims by others for loss or damage caused by your property. [Counsel: confirm how far this release can go under Tennessee law.]", initial: false },
  { number: 17, title: "Indemnification", body: "You will indemnify, defend and hold harmless Zivo, and the owner of the car, from any loss, damage or legal action that arises from your operation or use of the car during the rental, including reasonable attorneys' fees. You also pay for any parking tickets, moving violations and other citations received while you have the car. [Counsel: confirm the scope of this indemnity.]", initial: false },
  { number: 18, title: "Late payment and collections", body: "If rent is not paid by its due date plus {{grace_days}} days, a late fee of ${{late_rent_fee}} applies, and we may charge your card and, after notice, end the rental. If you do not pay all amounts due under this agreement on demand, including charges, fees, fines, penalties, damage, tolls, towing, storage and impoundment, then: (a) you pay a late charge of {{late_charge_pct}}% per month on the past-due balance, or the highest rate the law allows if lower; and (b) you also pay the costs we incur to collect, including court costs, attorneys' fees, administrative fees, recovery costs, insufficient-funds fees and collection fees. Where the law permits, you authorize us and our collection agent to contact you or your employer at your place of business about past-due amounts.", initial: false },
  { number: 19, title: "GPS tracking", body: "The car is equipped with GPS tracking and starter-disable equipment. You agree that we may use it to locate the car at any time, to recover it after a breach, theft or abandonment, and to disable it when we reasonably believe it necessary, for example for non-payment, theft or other breach of this agreement. You will not remove, block or tamper with it. [Counsel: draft the tracking and starter-disable notice, including limits on disabling a moving car, for Tennessee.]", initial: false },
  { number: 20, title: "Representations and warranties", body: "We represent that, to our knowledge, the car is in good condition and safe for ordinary operation. You represent that you are legally entitled to operate a motor vehicle in this jurisdiction and will not operate it in violation of any law or in a negligent or illegal manner. You have had the chance to examine the car before taking it and are not aware of any damage other than that noted in the separate existing damage record.", initial: false },
  { number: 21, title: "Records, notices and e-signature", body: "We keep records of your application, payments, messages, calls and the car's condition, as described in our Privacy Policy. You agree to receive notices and documents by email and text at the contact details you gave, and to sign electronically. Keep your contact details current.", initial: false },
  { number: 22, title: "General", body: "This agreement, together with the Terms and Privacy Policy on rentzivo.com, is the whole agreement for this rental. Changes must be in writing, as clause 6 describes. Notices to us go to the contact details on rentzivo.com. If a part is unenforceable, the rest still applies. Our not enforcing a right once does not waive it. Tennessee law governs. Disputes go to the courts for {{county}}, Tennessee. [Counsel: decide on arbitration and a class-action waiver.]", initial: false },
  { number: 23, title: "Acknowledgment", body: "You confirm that you read this agreement before paying, that you could download a copy, and that Zivo emailed you one after signing.", initial: false },
];

export const STARTER_VARIABLES: Record<VariableKey, string> = {
  travel_area: "Tennessee and bordering states",
  cleaning_cap: "75",
  admin_fee: "25",
  late_rent_fee: "25",
  grace_days: "1",
  county: "Davidson County",
  mileage_allowance: "Unlimited",
  extra_mile_rate: "0.25",
  toll_fee: "6",
  deductible: "1,000",
  late_charge_pct: "1.5",
  min_driver_age: "25",
};

// ---- placeholders ---------------------------------------------------------

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

export function extractPlaceholders(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) out.add(m[1]);
  return [...out];
}

export function templatePlaceholders(t: AgreementTemplate): string[] {
  const all = new Set<string>(extractPlaceholders(t.intro));
  for (const c of t.clauses) {
    extractPlaceholders(c.title).forEach((p) => all.add(p));
    extractPlaceholders(c.body).forEach((p) => all.add(p));
  }
  return [...all];
}

const KNOWN = new Set<string>([...RENTAL_PLACEHOLDERS, ...VARIABLE_KEYS]);

/** Unknown placeholder names (typos) in a template. */
export function unknownPlaceholders(t: AgreementTemplate): string[] {
  return templatePlaceholders(t).filter((p) => !KNOWN.has(p));
}

export function hasCounselNotes(t: AgreementTemplate): boolean {
  const re = /\[Counsel/i;
  return re.test(t.intro) || t.clauses.some((c) => re.test(c.body) || re.test(c.title));
}

/** Basic structural checks before a template is saved. */
export function validateTemplate(t: AgreementTemplate): string | null {
  if (!t || typeof t.intro !== "string" || !t.intro.trim()) return "The opening paragraph can't be empty.";
  if (!Array.isArray(t.clauses) || t.clauses.length === 0) return "Add at least one clause.";
  if (t.clauses.length > 40) return "That's more clauses than the page can show. Combine some.";
  const seen = new Set<number>();
  for (const c of t.clauses) {
    if (!Number.isInteger(c.number) || c.number < 1) return "Clause numbers must be whole numbers from 1.";
    if (seen.has(c.number)) return `Clause ${c.number} appears twice.`;
    seen.add(c.number);
    if (!c.title?.trim() || !c.body?.trim()) return `Clause ${c.number} needs a title and text.`;
    if (c.body.length > 6000 || c.title.length > 120) return `Clause ${c.number} is too long.`;
  }
  const unknown = unknownPlaceholders(t);
  if (unknown.length) return `Unknown placeholder: {{${unknown[0]}}}. Check the spelling.`;
  return null;
}

export type RenderResult =
  | { ok: true; rendered: RenderedAgreement }
  | { ok: false; missing: string[] };

/** Fill every placeholder. If ANY value is missing the agreement is not produced: no blanks reach a renter. */
export function renderAgreement(t: AgreementTemplate, values: Record<string, string | undefined | null>): RenderResult {
  const missing = new Set<string>();
  const fill = (text: string) =>
    text.replace(PLACEHOLDER_RE, (_, key: string) => {
      const v = values[key];
      if (v === undefined || v === null || String(v).trim() === "") {
        missing.add(key);
        return "";
      }
      return String(v);
    });
  const rendered: RenderedAgreement = {
    intro: fill(t.intro),
    clauses: t.clauses
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((c) => ({ number: c.number, title: fill(c.title), body: fill(c.body), initial: c.initial })),
  };
  if (missing.size) return { ok: false, missing: [...missing] };
  return { ok: true, rendered };
}

// ---- values from a rental -------------------------------------------------

export type RentalFacts = {
  firstName: string;
  lastName: string;
  vehicle: { year?: number | null; make?: string | null; model?: string | null; plate?: string | null; vin?: string | null } | null;
  pickupAt: string | null; // only when a pickup location is set
  returnAt: string | null;
  weeklyRateUsd: number | null;
  quotedTotalUsd: number | null; // daily plan total for the term
  depositUsd: number | null;
  returnLocation: string | null;
  cancellation: {
    approved?: boolean; late_fee_usd?: number | null; early_fee_usd?: number | null; free_cancellations_per_90d?: number;
    late_window_hours?: number; noshow_grace_hours?: number; rebook_days?: number; toll_ticket_window_days?: number;
  } | null;
};

export const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

function formatStart(iso: string | null): string {
  if (!iso) return "the pickup time we confirm with you";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "the pickup time we confirm with you";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(d);
  return `${day} at ${time} (Central Time)`;
}

/** Builds the per-rental values. Anything unknown is omitted so renderAgreement reports it as missing. */
export function buildRentalValues(f: RentalFacts, variables: Record<string, string | undefined>): Record<string, string> {
  const v: Record<string, string> = {};
  const name = `${f.firstName ?? ""} ${f.lastName ?? ""}`.trim();
  if (name) v.renter_name = name;

  if (f.vehicle) {
    const parts = [f.vehicle.year, f.vehicle.make, f.vehicle.model].filter(Boolean).join(" ");
    const ids = [f.vehicle.plate ? `plate ${f.vehicle.plate}` : null, f.vehicle.vin ? `VIN ${f.vehicle.vin}` : null].filter(Boolean).join(", ");
    if (parts) v.vehicle = ids ? `${parts} (${ids})` : parts;
  }
  v.start_at = formatStart(f.pickupAt);

  if (f.weeklyRateUsd != null) {
    let weeks = 1;
    if (f.pickupAt && f.returnAt) {
      const days = (new Date(f.returnAt).getTime() - new Date(f.pickupAt).getTime()) / 86_400_000;
      if (Number.isFinite(days) && days > 0) weeks = Math.max(1, Math.ceil(days / 7));
    }
    v.term = `weekly, ${weeks} week${weeks === 1 ? "" : "s"}`;
    v.rent_line = `Weekly rent: ${money(f.weeklyRateUsd)}`;
  } else if (f.quotedTotalUsd != null) {
    v.term = "daily plan, 7 days";
    v.rent_line = `Rent for the term: ${money(f.quotedTotalUsd)}`;
  }
  if (f.depositUsd != null) v.deposit = money(f.depositUsd);
  if (f.returnLocation) v.return_location = f.returnLocation;

  // Cancellation figures only count once the owner has approved the policy.
  const c = f.cancellation;
  if (c && c.approved === true) {
    if (c.late_window_hours != null) v.late_window_hours = String(c.late_window_hours);
    if (c.noshow_grace_hours != null) v.noshow_grace_hours = String(c.noshow_grace_hours);
    if (c.rebook_days != null) v.rebook_days = String(c.rebook_days);
    if (c.toll_ticket_window_days != null) v.toll_window_days = String(c.toll_ticket_window_days);
    if (c.free_cancellations_per_90d != null) v.free_cancellations = String(c.free_cancellations_per_90d);
    if (c.early_fee_usd != null) v.early_fee = money(c.early_fee_usd);
    if (c.late_fee_usd != null) v.late_fee = money(c.late_fee_usd);
  }
  for (const k of VARIABLE_KEYS) {
    const val = variables?.[k];
    if (val !== undefined && String(val).trim() !== "") v[k] = String(val).trim();
  }
  return v;
}

// ---- signing checks --------------------------------------------------------

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z\s'-]/g, " ").replace(/\s+/g, " ").trim();

/** Typed legal name must be at least two words, starting with the first name and ending with the last name on file. */
export function nameMatches(typed: string, firstName: string, lastName: string): boolean {
  const t = norm(typed).split(" ").filter(Boolean);
  const f = norm(firstName).split(" ").filter(Boolean);
  const l = norm(lastName).split(" ").filter(Boolean);
  if (t.length < 2 || f.length === 0 || l.length === 0) return false;
  return t[0] === f[0] && t[t.length - 1] === l[l.length - 1];
}

export const INITIALS_RE = /^[A-Za-z]{2,4}$/;

/** Returns the clause numbers that still need valid initials. */
export function missingInitials(clauses: AgreementClause[], initials: Record<string, string> | Record<number, string>): number[] {
  const map = initials as Record<string, string>;
  return clauses.filter((c) => c.initial && !INITIALS_RE.test((map[String(c.number)] ?? "").trim())).map((c) => c.number);
}

export function initialsMatchName(initials: string, typedName: string): boolean {
  const letters = norm(typedName).split(" ").filter(Boolean).map((w) => w[0]).join("");
  const given = initials.trim().toLowerCase();
  // Accept first+last initials (or all given initials) as typed.
  return given.length >= 2 && (letters.startsWith(given) || (letters[0] + letters[letters.length - 1]) === given);
}

export const SIGNATURE_STATEMENT =
  "I have read this agreement, I agree to it, and I agree that typing my name below is my legal signature.";
