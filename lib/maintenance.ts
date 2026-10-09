// Rules for maintenance jobs. Pure functions so the money and approval rules are tested.

export const DEFAULT_APPROVAL_LIMIT_USD = 150;
export const APPROVAL_LIMIT_KEY = "maintenance_approval_limit_usd";

export const PERFORMED_BY = ["runner", "shop"] as const;
export type PerformedBy = (typeof PERFORMED_BY)[number];

export const PAYMENT_ARRANGEMENTS = ["company_pays_shop", "runner_reimburse", "company_card"] as const;
export type PaymentArrangement = (typeof PAYMENT_ARRANGEMENTS)[number];

export const PAYMENT_LABELS: Record<PaymentArrangement, string> = {
  company_pays_shop: "Company pays the shop",
  runner_reimburse: "Runner paid, reimburse them",
  company_card: "Paid with company card",
};

/** Dollars and cents, zero allowed (a job can be free). Null if it isn't a plain amount. */
export function parseCost(text: string): number | null {
  const t = text.trim().replace(/^\$/, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
}

export function parseLimit(value: string | null | undefined): number {
  const n = Number((value ?? "").trim());
  return value && /^\d+(\.\d+)?$/.test(value.trim()) && Number.isFinite(n) ? n : DEFAULT_APPROVAL_LIMIT_USD;
}

/** A job over the limit waits for an admin before the car goes back on the road. */
export function needsApproval(cost: number, limit: number): boolean {
  return cost > limit + 1e-9;
}

export type StartInput = { vehicleId: string; workType: string; performedBy: string; shopName: string; paymentArrangement: string; notes: string };
export type StartCheck =
  | { ok: true; value: { vehicleId: string; workType: string; performedBy: PerformedBy; shopName: string | null; paymentArrangement: PaymentArrangement; notes: string | null } }
  | { ok: false; error: string };

export function validateStart(i: StartInput): StartCheck {
  if (!i.vehicleId) return { ok: false, error: "Pick the car." };
  const workType = i.workType.trim().slice(0, 120);
  if (!workType) return { ok: false, error: "Say what the job is, like an oil change." };
  if (!PERFORMED_BY.includes(i.performedBy as PerformedBy)) return { ok: false, error: "Say who is doing the work." };
  if (!PAYMENT_ARRANGEMENTS.includes(i.paymentArrangement as PaymentArrangement)) return { ok: false, error: "Say how it will be paid for." };
  const performedBy = i.performedBy as PerformedBy;
  const shopName = i.shopName.trim().slice(0, 120);
  if (performedBy === "shop" && !shopName) return { ok: false, error: "Enter the shop’s name." };
  // A runner doing their own work can't be "company pays the shop".
  if (performedBy === "runner" && i.paymentArrangement === "company_pays_shop") return { ok: false, error: "There’s no shop on this job. Choose reimburse or company card." };
  return {
    ok: true,
    value: { vehicleId: i.vehicleId, workType, performedBy, shopName: performedBy === "shop" ? shopName : null, paymentArrangement: i.paymentArrangement as PaymentArrangement, notes: i.notes.trim().slice(0, 500) || null },
  };
}

export type FinishCheck = { ok: true; cost: number; outcome: "completed" | "pending_approval" } | { ok: false; error: string };

/** Cost is always required. A runner who paid needs a receipt. Over the limit goes to the office. */
export function validateFinish(input: { costText: string; paymentArrangement: string | null; receiptCount: number; limit: number }): FinishCheck {
  const cost = parseCost(input.costText);
  if (cost === null) return { ok: false, error: "Enter the total cost as dollars and cents. Use 0.00 if there was no charge." };
  if (cost > 0 && input.paymentArrangement === "runner_reimburse" && input.receiptCount < 1) return { ok: false, error: "Add a photo of the receipt first. The office needs it to reimburse you." };
  return { ok: true, cost, outcome: needsApproval(cost, input.limit) ? "pending_approval" : "completed" };
}

/** One line for the office: what, if anything, is still owed. */
export function settlementNote(arrangement: string | null, cost: number | null, settled: boolean): string | null {
  if (cost === null || cost <= 0 || settled) return null;
  const amt = `$${cost.toFixed(2)}`;
  if (arrangement === "runner_reimburse") return `Reimburse the runner ${amt}`;
  if (arrangement === "company_pays_shop") return `Pay the shop ${amt}`;
  return null;
}
