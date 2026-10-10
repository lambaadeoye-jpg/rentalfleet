import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { portalForHost } from "@/lib/hosts";

const SITE_URL = "https://rentzivo.com";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // The portal hosts (my., admin., team., field.) are never for search engines.
  const host = (await headers()).get("host");
  if (portalForHost(host) !== "site") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Nothing behind these paths should be indexed -- all
      // authenticated, none of it public-facing content.
      disallow: ["/staff/", "/portal/", "/apply", "/auth/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
