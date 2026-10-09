// What a field runner may open. Everything else under /staff is office-only.
// The proxy enforces this on every request, so typing an address or following an old link doesn't get around it.

export const RUNNER_HOME = "/staff/pickups";

// Exact page or anything beneath it. Keep this list short: a page is only added when a runner needs it to do the job.
const RUNNER_PATHS = ["/staff/pickups", "/staff/fleet/map", "/staff/fleet/maintenance", "/staff/report", "/staff/profile"] as const;

export function runnerCanOpen(pathname: string): boolean {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return RUNNER_PATHS.some((p) => clean === p || clean.startsWith(p + "/"));
}

export type RunnerNavItem = { href: string; label: string };

export const RUNNER_NAV: RunnerNavItem[] = [
  { href: "/staff/pickups", label: "My day" },
  { href: "/staff/fleet/map", label: "Fleet map" },
  { href: "/staff/fleet/maintenance", label: "Maintenance" },
  { href: "/staff/report", label: "Report" },
  { href: "/staff/profile", label: "Profile" },
];

/** True when the signed agreement is on file. Runners may not hand over keys without it. */
export function agreementAllowsHandover(input: { signed: boolean }): { ok: true } | { ok: false; message: string } {
  return input.signed ? { ok: true } : { ok: false, message: "The renter hasn’t signed the agreement yet. Ask the office to send the signing link, then confirm pickup." };
}

/** What a runner needs to know about money: has the card been charged? Mirrors the rule confirmPickup enforces. */
export function cardChargedStatus(m: {
  plan: "weekly" | "daily" | null;
  weeklyRateUsd: number | null;
  quotedAmountUsd: number | null;
  depositRequiredUsd: number | null;
  rentPaidUsd: number;
  depositPaidUsd: number;
}): { rentPaid: boolean; depositPaid: boolean; allPaid: boolean } {
  const rentDue = m.plan === "weekly" ? m.weeklyRateUsd ?? 0 : m.quotedAmountUsd ?? 0;
  if (m.depositRequiredUsd === null) {
    // Older rentals without a recorded deposit: any payment counts, same as the pickup rule.
    const any = m.rentPaidUsd + m.depositPaidUsd > 0;
    return { rentPaid: any, depositPaid: any, allPaid: any };
  }
  const rentPaid = m.rentPaidUsd + 0.005 >= rentDue;
  const depositPaid = m.depositPaidUsd + 0.005 >= m.depositRequiredUsd;
  return { rentPaid, depositPaid, allPaid: rentPaid && depositPaid };
}
