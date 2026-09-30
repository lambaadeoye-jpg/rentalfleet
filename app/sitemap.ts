import type { MetadataRoute } from "next";
import { SERVICE_AREA_CITIES } from "@/lib/service-areas";

const SITE_URL = "https://rentzivo.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const cityPages: MetadataRoute.Sitemap = SERVICE_AREA_CITIES.map((c) => ({
    url: `${SITE_URL}/${c.slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    ...cityPages,
    // Staff/portal/apply are deliberately excluded -- authenticated
    // areas have nothing for search engines to index and no reason to
    // be crawled.
  ];
}
