import { getLocations } from "./actions";
import LocationList from "./location-list";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const locations = await getLocations();

  return (
    <div className="page">
      <h1 className="page-title">Pickup locations</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Plain address fields for now — autocomplete is on hold until the domain is set up.
      </p>
      <LocationList initialLocations={locations} />
    </div>
  );
}
