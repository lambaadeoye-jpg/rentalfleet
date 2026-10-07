// Service-area city landing pages, one entry per confirmed city.
//
// Deliberately starts with ONLY Nashville -- that's the one city name
// already used throughout the existing site copy ("Greater Nashville",
// "Middle Tennessee"), so it's a safe, already-established claim. No
// other specific city was invented here: claiming to serve a suburb
// that isn't actually confirmed would be a false service-availability
// claim, the same category of thing as inventing a price. Add more
// entries here once the real list of served cities/suburbs is
// confirmed -- the [city]/page.tsx route picks up any new entry
// automatically, no route code changes needed.
export type CityData = {
  slug: string;
  displayName: string;
  region: string;
  heroLine: string;
  metaDescription: string;
};

export const SERVICE_AREA_CITIES: CityData[] = [
  {
    slug: "nashville",
    displayName: "Nashville",
    region: "Middle Tennessee",
    heroLine: "Rideshare & delivery car rentals in Nashville, TN.",
    metaDescription:
      "Weekly and daily car rentals for Uber, Lyft, and delivery drivers in Nashville, TN. No credit check, insurance if you need it, approved fast.",
  },
];

export function getCityBySlug(slug: string): CityData | undefined {
  return SERVICE_AREA_CITIES.find((c) => c.slug === slug);
}
