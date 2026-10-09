// CSV for staff exports. Cells that begin with = + - @ (or a tab/CR) are prefixed
// with an apostrophe so a spreadsheet shows them as text instead of running them
// as a formula: a renter could otherwise type a formula as their name.
export function csvCell(val: unknown): string {
  let str = val === null || val === undefined ? "" : String(val);
  if (/^[=+\-@\t\r]/.test(str) && !/^-?\d+(\.\d+)?$/.test(str)) str = `'${str}`;
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function toCsv(rows: Record<string, unknown>[], headers?: string[]): string {
  const cols = headers ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
  if (cols.length === 0) return "";
  return [cols.join(","), ...rows.map((r) => cols.map((h) => csvCell(r[h])).join(","))].join("\r\n");
}
