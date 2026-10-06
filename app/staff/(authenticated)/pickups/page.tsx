import { getPickupsAndDropoffs } from "./list-actions";
import { getPickupLocations } from "../applications/rental-actions";
import PickupCard from "./pickup-card";
import DropoffCard from "./dropoff-card";

export const dynamic = "force-dynamic";

export default async function PickupsPage() {
  const [{ pickups, dropoffs }, locations] = await Promise.all([getPickupsAndDropoffs(), getPickupLocations()]);

  return (
    <div style={{ padding: "32px 40px", maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Pickups &amp; Dropoffs</h1>
      <p className="muted-text" style={{ marginBottom: 24 }}>
        Confirm a vehicle handover or return. Every action here asks you to confirm before it
        actually happens.
      </p>

      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
        Ready for Pickup ({pickups.length})
        {pickups.some((p) => p.followup.needed) && (
          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fef3c7", color: "#92400e" }}>
            {pickups.filter((p) => p.followup.needed).length} need follow-up
          </span>
        )}
      </h2>
      {pickups.length === 0 ? (
        <p className="muted-text" style={{ marginBottom: 24, fontSize: 14 }}>Nothing scheduled right now.</p>
      ) : (
        <div style={{ marginBottom: 24 }}>
          {pickups.map((p) => (
            <PickupCard key={p.rentalId} item={p} locations={locations} />
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
        Active Rentals ({dropoffs.length})
      </h2>
      {dropoffs.length === 0 ? (
        <p className="muted-text" style={{ fontSize: 14 }}>No active rentals right now.</p>
      ) : (
        <div>
          {dropoffs.map((d) => (
            <DropoffCard key={d.rentalId} item={d} />
          ))}
        </div>
      )}
    </div>
  );
}
