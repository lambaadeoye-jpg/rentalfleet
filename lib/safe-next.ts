// Only same-site paths in these areas are valid sign-in destinations. Anything
// else (including "//host", "@host" or backslash tricks) falls back to /apply.
const ALLOWED_PREFIXES = ["/apply", "/portal", "/staff"];

export function safeNext(raw: string | null | undefined): string {
  const value = raw ?? "/apply";
  if (!value.startsWith("/") || value.startsWith("//") || /[\\@\s]/.test(value)) return "/apply";
  if (!ALLOWED_PREFIXES.some((p) => value === p || value.startsWith(p + "/") || value.startsWith(p + "?"))) return "/apply";
  return value;
}

/** Where to send someone whose sign-in link could not be used. */
export function failureTarget(next: string): string {
  if (next.startsWith("/staff")) return "/staff/login";
  if (next.startsWith("/portal")) return "/portal/login";
  return "/apply/resume";
}
