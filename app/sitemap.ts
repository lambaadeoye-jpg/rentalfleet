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
    { url: `${SITE_URL}/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/guides/driver-signup`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/terms`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.2 },
    // Staff/portal/apply are deliberately excluded -- authenticated
    // areas have nothing for search engines to index and no reason to
    // be crawled.
  ];
}
