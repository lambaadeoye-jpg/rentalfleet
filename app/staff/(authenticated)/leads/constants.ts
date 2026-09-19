// Locked pipeline from BUILD_MASTER_SPECIFICATION_v2.0.md §5 -- not
// invented here, just enforced client-side to match what staff actually
// agreed the pipeline should be.
//
// Lives in its own plain file, not in actions.ts: Next.js "use server"
// files may only export async functions -- see the identical note in
// applications/constants.ts for why this caused a real build failure when
// it lived alongside updateLeadStage().
export const LEAD_STAGES = [
  "new",
  "attempting_contact",
  "contacted",
  "qualified",
  "application_invited",
  "application_started",
  "application_submitted",
  "screening",
  "approved",
  "booking",
  "converted",
] as const;
