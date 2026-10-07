// "Good morning / afternoon / evening" in the business's time zone (Central), not the server's (UTC).
export function greeting(now: Date = new Date(), timeZone = "America/Chicago"): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
