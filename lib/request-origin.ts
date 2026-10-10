import { headers } from "next/headers";
import { subdomainsEnabled } from "@/lib/hosts";

/**
 * The address the person is on right now, for sign-in links. A sign-in started on one host must come back to the
 * same host (the code that finishes it is stored in that host's cookies). With the subdomains off this is exactly
 * the old behaviour: the configured site address.
 */
export async function requestOrigin(): Promise<string> {
  const fallback = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  if (!subdomainsEnabled()) return fallback;
  const h = await headers();
  const host = h.get("host");
  if (!host) return fallback;
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || (host.startsWith("localhost") || host.includes(".localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
