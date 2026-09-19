// Locked values from migration 0016's application_status_check -- not
// re-invented here, just the subset staff actually choose between on a
// decision (draft/submitted/screening/review are workflow states, not
// staff decisions).
//
// Lives in its own plain file, not in actions.ts: Next.js "use server"
// files may only export async functions -- exporting this const array
// alongside decideApplication() breaks the build ("A 'use server' file can
// only export async functions, found object").
export const DECISION_OUTCOMES = ["approved", "conditionally_approved", "declined"] as const;
