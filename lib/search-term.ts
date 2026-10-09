// Makes text typed into a search box safe to place inside a PostgREST filter string. Commas, parentheses, quotes
// and the wildcard characters would otherwise change the meaning of the filter (or break it), so they are dropped.
export function safeSearchTerm(input: string, max = 60): string {
  return input
    .replace(/[,()%_*\\"'`;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Digits only, for matching phone numbers typed in any format. Empty when fewer than 4 digits. */
export function phoneDigits(input: string): string {
  const d = input.replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-10) : "";
}
