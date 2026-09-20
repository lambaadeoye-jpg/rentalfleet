import { getPickupsAndDropoffs } from "./list-actions";
import PickupCard from "./pickup-card";
import DropoffCard from "./dropoff-card";

export const dynamic = "force-dynamic";

export default async function PickupsPage() {
  const { pickups, dropoffs } = await getPickupsAndDropoffs();

  return (
    <div style={{ padding: "32px 40px", maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Pickups &amp; Dropoffs</h1>
      <p className="muted-text" style={{ marginBottom: 24 }}>
        Confirm a vehicle handover or return. Every action here asks you to confirm before it
        actually happens.
      </p>

      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
        Ready for Pickup ({pickups.length})
      </h2>
      {pickups.length === 0 ? (
        <p className="muted-text" style={{ marginBottom: 24, fontSize: 14 }}>Nothing scheduled right now.</p>
      ) : (
        <div style={{ marginBottom: 24 }}>
          {pickups.map((p) => (
            <PickupCard key={p.rentalId} item={p} />
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
