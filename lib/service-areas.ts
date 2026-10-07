// Service-area city landing pages, one entry per confirmed city.
//
// Only confirmed pickup cities belong here (Nashville, Murfreesboro): claiming
// a city that isn't actually served would be a false service-availability
// claim, the same category of thing as inventing a price. Add more entries
// once a city is confirmed -- the [city]/page.tsx route picks up any new entry
// automatically, no route code changes needed.
export type CityData = {
  slug: string;
  displayName: string;
  region: string;
  heroLine: string;
  metaDescription: string;
  /** Short, factual local paragraph shown on the city page. Only confirmed facts. */
  localBlurb: string;
  /** Other already-confirmed service-area names to mention as nearby (optional). */
  nearby?: string[];
};

export const SERVICE_AREA_CITIES: CityData[] = [
  {
    slug: "nashville",
    displayName: "Nashville",
    region: "Middle Tennessee",
    heroLine: "Rideshare & delivery car rentals in Nashville, TN.",
    metaDescription:
      "Weekly and daily car rentals for Uber, Lyft, and delivery drivers in Nashville, TN. No credit check, insurance if you need it, approved fast.",
    localBlurb:
      "Pickup is in the Nashville area. We confirm the exact pickup location and time with you once you're approved.",
  },
  {
    slug: "murfreesboro",
    displayName: "Murfreesboro",
    region: "Middle Tennessee",
    heroLine: "Rideshare & delivery car rentals in Murfreesboro, TN.",
    metaDescription:
      "Weekly and daily car rentals for Uber, Lyft, and delivery drivers in Murfreesboro, TN. No credit check, insurance if you need it, approved fast.",
    localBlurb:
      "Pickup is in the Murfreesboro area. We confirm the exact pickup location and time with you once you're approved.",
    nearby: ["Smyrna", "La Vergne"],
  },
];

export function getCityBySlug(slug: string): CityData | undefined {
  return SERVICE_AREA_CITIES.find((c) => c.slug === slug);
}
