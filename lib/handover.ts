// What a runner must finish before handing over the keys. Pure, so the same rule drives the screen and the server check.

export const WALKTHROUGH_AREAS = [
  { key: "front", label: "Front of the car" },
  { key: "rear", label: "Back of the car" },
  { key: "driver_side", label: "Driver side" },
  { key: "passenger_side", label: "Passenger side" },
  { key: "tires", label: "Tires" },
  { key: "interior_front", label: "Front seats and dashboard" },
  { key: "interior_rear", label: "Back seats" },
  { key: "trunk", label: "Trunk" },
] as const;

export type AreaKey = (typeof WALKTHROUGH_AREAS)[number]["key"];
export const AREA_KEYS: string[] = WALKTHROUGH_AREAS.map((a) => a.key);

export const QUICK_CHECKS = [
  { key: "doors", label: "All doors open, close and lock" },
  { key: "mirrors", label: "Mirrors are in place and adjustable" },
  { key: "ac", label: "A/C blows cold" },
  { key: "lights", label: "No warning lights on the dashboard" },
] as const;
export const CHECK_KEYS: string[] = QUICK_CHECKS.map((c) => c.key);

export const MAX_VIDEO_SECONDS = 60;
/** Phone videos can be huge. Storage rejects very large files, so say it early. */
export const MAX_VIDEO_BYTES = 45 * 1024 * 1024;

export type VideoCheck = { ok: true } | { ok: false; message: string };

export function checkVideo(input: { seconds: number | null; bytes: number }): VideoCheck {
  if (!(input.bytes > 0)) return { ok: false, message: "Choose a video first." };
  if (input.seconds === null || !Number.isFinite(input.seconds) || input.seconds <= 0) return { ok: false, message: "Couldn’t read that video. Record it again." };
  if (input.seconds > MAX_VIDEO_SECONDS + 0.5) return { ok: false, message: `Videos can be at most ${MAX_VIDEO_SECONDS} seconds. Record a shorter one.` };
  if (input.bytes > MAX_VIDEO_BYTES) return { ok: false, message: "That video is too large. Record it again at standard quality (not 4K)." };
  return { ok: true };
}

export type HandoverState = {
  identityVerified: boolean;
  agreementSigned: boolean;
  cardCharged: boolean;
  areaCounts: Record<string, number>;
  hasWalkthroughVideo: boolean;
  checks: Record<string, boolean>;
  briefingAcked: string[];
};

/** Everything still missing, in the order a runner does it. Empty means ready to confirm. */
export function handoverMissing(s: HandoverState, ruleIds: string[]): string[] {
  const out: string[] = [];
  if (!s.identityVerified) out.push("Check the renter’s ID against the license photo");
  if (!s.agreementSigned) out.push("The agreement isn’t signed yet");
  if (!s.cardCharged) out.push("The card hasn’t been charged yet");
  const missingAreas = WALKTHROUGH_AREAS.filter((a) => (s.areaCounts[a.key] ?? 0) < 1).map((a) => a.label.toLowerCase());
  if (missingAreas.length) out.push(`Photos still needed: ${missingAreas.join(", ")}`);
  if (!s.hasWalkthroughVideo) out.push("Record the walkthrough video");
  const missingChecks = QUICK_CHECKS.filter((c) => s.checks[c.key] !== true).length;
  if (missingChecks) out.push("Finish the quick checks");
  const acked = new Set(s.briefingAcked);
  const missingRules = ruleIds.filter((id) => !acked.has(id)).length;
  if (missingRules) out.push(`Explain ${missingRules} more rule${missingRules === 1 ? "" : "s"} to the renter`);
  return out;
}

export function validMileage(v: unknown): number | null {
  const str = typeof v === "number" ? String(v) : String(v ?? "").trim();
  if (str === "") return null;
  const n = Number(str);
  return Number.isInteger(n) && n >= 0 && n < 2_000_000 ? n : null;
}

export const TESTIMONIAL_RELEASE_TEXT =
  "I agree that Zivo Mobility LLC may use this video of me, my voice and my words about my rental experience in its marketing, on its website and on social media, with no payment to me. I can ask Zivo to stop using it at any time by emailing support.";
