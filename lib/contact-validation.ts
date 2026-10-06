export function isValidEmail(e: string): boolean {
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}
/** US mobile: 10 digits, or 11 starting with 1. */
export function isValidUsPhone(p: string): boolean {
  const d = p.replace(/\D/g, "");
  return d.length === 10 || (d.length === 11 && d[0] === "1");
}
