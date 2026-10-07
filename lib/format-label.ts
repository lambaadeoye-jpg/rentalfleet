// One house style for UI text: sentence case ("Pending approval", not "Pending Approval").
// Database values such as `pending_approval` or `drivers_license` are shown through this helper
// instead of CSS `text-transform: capitalize`, which Title Cases every word.
export function sentenceCase(value: string | null | undefined): string {
  if (!value) return "";
  const text = value.replace(/[_\s]+/g, " ").trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
