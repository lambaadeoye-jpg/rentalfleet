import { originFor, subdomainsEnabled } from "@/lib/hosts";

/** Base address for links to the renter portal: my.<domain> once the subdomains are switched on, else the site address. */
export function portalBase(siteBase: string): string {
  return subdomainsEnabled() ? originFor("my") : siteBase.replace(/\/$/, "");
}
