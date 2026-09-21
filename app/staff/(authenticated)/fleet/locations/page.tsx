import { getLocations } from "./actions";
import LocationList from "./location-list";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const locations = await getLocations();

  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Pickup Locations</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Plain address fields for now -- autocomplete is on hold until the domain is set up.
      </p>
      <LocationList initialLocations={locations} />
    </div>
  );
}
