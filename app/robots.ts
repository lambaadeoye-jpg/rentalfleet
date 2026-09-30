import type { MetadataRoute } from "next";

const SITE_URL = "https://rentzivo.com";

export default function robots(): MetadataRoute.Robots {
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
