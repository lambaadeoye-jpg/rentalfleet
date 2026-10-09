// Every applicant must show an approved driver profile on at least one platform they picked.
// Pure, so the same rule is tested once and used by the form, the save and the submit.

export function platformProofProblem(input: { platformCount: number; hasApproval: boolean }): string | null {
  if (input.platformCount < 1) return "Pick at least one platform you drive or deliver for.";
  if (!input.hasApproval) return "Upload a screenshot of your approved driver profile on one of those platforms. Not approved yet? Our sign-up guide shows how.";
  return null;
}
