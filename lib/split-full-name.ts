// Splits a single "Full Name" field (used by the /get-started flow,
// matching the benchmark's single-field contact form) into first/last
// for submitLead(), which still stores them separately. A name with no
// space (just "Cher") keeps the whole thing as the first name with an
// empty last name, rather than losing part of a genuinely valid
// single-word name.
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}
