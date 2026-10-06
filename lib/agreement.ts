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
export const VARIABLE_KEYS = ["travel_area", "cleaning_cap", "admin_fee", "late_rent_fee", "grace_days", "county"] as const;
export type VariableKey = (typeof VARIABLE_KEYS)[number];

export const VARIABLE_LABELS: Record<VariableKey, string> = {
  travel_area: "Where the vehicle may be driven (e.g. Tennessee and bordering states)",
  cleaning_cap: "Cleaning fee cap, in dollars",
  admin_fee: "Administrative fee for paying a fine, in dollars",
  late_rent_fee: "Late rent fee, in dollars",
  grace_days: "Days of grace before the late fee",
  county: "County whose courts hear disputes",
};

export const AGREEMENT_DOCUMENT_TYPE = "rental_agreement";

export const STARTER_INTRO =
  "Parties. Zivo Mobility LLC, doing business as Zivo (\"Zivo\", \"we\"), and {{renter_name}} (\"you\"). Vehicle: {{vehicle}}. Start: {{start_at}}. Rental: {{term}}. {{rent_line}}. Deposit: {{deposit}}.";

export const STARTER_CLAUSES: AgreementClause[] = [
  { number: 1, title: "The rental", initial: false, body: "Zivo rents you the vehicle for the term above. The minimum rental is 7 days. Rent is charged weekly in advance unless we agree otherwise in writing. Mileage is unlimited. You get the vehicle only after you have paid the first week's rent and the deposit and shown the documents we require at pickup." },
  { number: 2, title: "Payment and card", initial: true, body: "All payments are by credit or debit card in your own name. We do not accept cash. You authorize Zivo to charge that card for rent as it comes due, the deposit, and any other amount you owe under this agreement, including those in clauses 7, 9 and 10. If a payment fails, we may ask for another card in your name. Refunds go only to the original card." },
  { number: 3, title: "Deposit", initial: true, body: "The deposit is a refundable security amount. It is separate from rent and is not a prepayment of rent. We hold it while you have the vehicle. After you return the vehicle we inspect it. If nothing is owed, we return the full deposit to the original card within 24 hours of the inspection and start the refund within 2 business days. If we deduct anything, we email you an itemized list with supporting photos or records within 3 business days. The deposit does not limit what you owe; if costs exceed it, you owe the difference." },
  { number: 4, title: "Cancelling before pickup", initial: true, body: "More than {{late_window_hours}} hours before the scheduled pickup: you receive a full refund of rent paid. Each renter has {{free_cancellations}} free cancellations in any 90 days. After that we keep a {{early_fee}} fee out of the refund.\nWithin {{late_window_hours}} hours of the scheduled pickup, or if you do not arrive within {{noshow_grace_hours}} hours of it: we keep a {{late_fee}} fee out of rent paid. The fee never exceeds the rent paid. You may rebook within {{rebook_days}} days.\nIf you cannot meet a rental requirement at pickup (for example a valid license, a card in your own name, or required documents), we keep a {{late_fee}} fee once and refund the rest.\nIf Zivo cancels, cannot provide the vehicle, or a payment is shown not to have been made by you, you owe no fee and receive a full refund.\nThe deposit is always refunded in full when a rental is cancelled before pickup." },
  { number: 5, title: "After pickup", initial: true, body: "Rent already paid for a week is not prorated or refunded if you return early. If the vehicle becomes unusable through no fault of yours, we will give you a replacement vehicle or refund the unused days of that week. Zivo may, at its sole discretion, waive a fee in a documented emergency. That is not a right and does not change any other clause." },
  { number: 6, title: "Who may drive and how", initial: false, body: "Only you may drive the vehicle, unless we approve another driver in writing. You must hold a valid driver's license for the whole term. You may use the vehicle for personal driving and for work on gig platforms that you told us about at application. You must obey traffic laws, keep the vehicle locked when parked, and take the keys when you leave it." },
  { number: 7, title: "Prohibited uses", initial: false, body: "You may not use the vehicle: (a) while impaired by alcohol or drugs; (b) for any illegal purpose; (c) for racing, towing, pushing another vehicle, driving instruction or off-road driving; (d) carrying more people than there are seatbelts or children without the legally required seats; (e) carrying hazardous or illegal materials; (f) outside {{travel_area}} without our written permission; (g) to sublet, sell, lend or use as security; (h) after giving us false or misleading information to get or extend the rental; (i) with the odometer, tracking or other equipment tampered with or disabled; or (j) in any way that breaks the law or this agreement. If you do, we may end the rental and recover the vehicle as clause 14 describes." },
  { number: 8, title: "Condition, care and return", initial: false, body: "You received the vehicle in the condition recorded in the pickup photos and checklist. Keep it in the same condition, apart from ordinary wear. Check fluids and tire pressure, and tell us promptly about warning lights, damage or problems. Do not make repairs or modifications without our approval. Return the vehicle on the agreed date and time to {{return_location}}, clean and with its keys and equipment. If you return it when we are closed, you stay responsible for it until our next inspection. We may charge a reasonable cleaning fee, not more than ${{cleaning_cap}}, if it is returned substantially dirtier than at pickup." },
  { number: 9, title: "Damage, loss, theft and accidents", initial: true, body: "Report any accident, theft or damage to us and the police as soon as you can, and give us the details and the police report number. Unless [Counsel: insurance terms to be completed] apply, you are responsible for loss of or damage to the vehicle during the rental: the reasonable cost of repair, or its market value if it cannot be repaired, plus reasonable loss-of-use and administrative costs that we document. If you are not at fault and a responsible party or their insurer pays, we will credit what we recover. [Counsel: insurance, deductible, liability and indemnity wording, and how coverage differs by renter, to be drafted here.]" },
  { number: 10, title: "Tolls, tickets and fines", initial: true, body: "You are responsible for tolls, parking charges, traffic and camera tickets, tows and fines incurred during the rental. We may charge the card on file for them, with a copy of the notice, for up to {{toll_window_days}} days after the vehicle is returned. If we pay a fine for you we may add a reasonable administrative fee of ${{admin_fee}} [Counsel: confirm this fee]." },
  { number: 11, title: "Late rent and other charges", initial: false, body: "If rent is not paid by its due date plus {{grace_days}} days, a late fee of ${{late_rent_fee}} applies, and we may charge your card and, after notice, end the rental. We may also charge your card for any other amount you owe under this agreement, with an itemized notice." },
  { number: 12, title: "Refunds", initial: false, body: "All refunds go to the original card only, never to cash, check or another card. Timing after we issue a refund depends on your bank." },
  { number: 13, title: "No warranties; your belongings", initial: false, body: "The vehicle is rented as is and we make no promise that it suits your particular purpose, beyond what the law requires. We are not responsible for belongings left in the vehicle. [Counsel: confirm how far this release can go under Tennessee law.]" },
  { number: 14, title: "Default and recovery", initial: false, body: "If you break this agreement, abandon the vehicle, or do not return it on time, we may end the rental and take back the vehicle, using lawful means and at your cost, including reasonable recovery costs. We will not enter private property unlawfully. [Counsel: confirm repossession rights and notice for a rental.] We may report an unreturned or stolen vehicle to the police." },
  { number: 15, title: "Indemnity", initial: false, body: "To the extent the law allows, you will cover Zivo for claims, losses and reasonable legal costs that arise from your use of the vehicle or your breach of this agreement, except where Zivo caused the loss." },
  { number: 16, title: "Recording and data", initial: false, body: "We keep records of your application, payments, messages, calls and the vehicle's condition, as described in our Privacy Policy. [Counsel: add any tracking or telematics notice if the vehicle has it.]" },
  { number: 17, title: "Notices and e-signature", initial: false, body: "You agree to receive notices and documents by email and text at the contact details you gave, and to sign electronically. Keep your contact details current." },
  { number: 18, title: "General", initial: false, body: "This agreement and the Terms and Privacy Policy on rentzivo.com are the whole agreement. Changes must be in writing and accepted by both of us. If a part is unenforceable, the rest still applies. Our not enforcing a right once does not waive it. Tennessee law governs. Disputes go to the courts for {{county}}, Tennessee. [Counsel: decide on arbitration and a class-action waiver.]" },
  { number: 19, title: "Acknowledgment", initial: false, body: "You confirm that you read this agreement before paying, that you could download a copy, and that Zivo emailed you one after signing." },
];

export const STARTER_VARIABLES: Record<VariableKey, string> = {
  travel_area: "Tennessee and bordering states",
  cleaning_cap: "75",
  admin_fee: "25",
  late_rent_fee: "25",
  grace_days: "1",
  county: "Davidson County",
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
