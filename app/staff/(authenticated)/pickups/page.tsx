import { getPickupsAndDropoffs } from "./list-actions";
import { getPickupLocations } from "../applications/rental-actions";
import PickupCard from "./pickup-card";
import DropoffCard from "./dropoff-card";

export const dynamic = "force-dynamic";

export default async function PickupsPage() {
  const [{ pickups, dropoffs, isRunner, runners }, locations] = await Promise.all([getPickupsAndDropoffs(), getPickupLocations()]);

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 className="page-title">{isRunner ? "My day" : "Pickups & dropoffs"}</h1>
      <p className="muted-text" style={{ marginBottom: 24 }}>
        {isRunner
          ? "The handovers and returns assigned to you. Every action here asks you to confirm before it actually happens."
          : "Confirm a vehicle handover or return. Every action here asks you to confirm before it actually happens."}
      </p>

      <h2 className="card-title">
        Ready for pickup ({pickups.length})
        {pickups.some((p) => p.followup.needed) && (
          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fef3c7", color: "#92400e" }}>
            {pickups.filter((p) => p.followup.needed).length} need follow-up
          </span>
        )}
      </h2>
      {pickups.length === 0 ? (
        <p className="muted-text" style={{ marginBottom: 24, fontSize: 14 }}>{isRunner ? "Nothing assigned to you for pickup." : "Nothing scheduled right now."}</p>
      ) : (
        <div style={{ marginBottom: 24 }}>
          {pickups.map((p) => (
            <PickupCard key={p.rentalId} item={p} locations={locations} isRunner={isRunner} runners={runners} />
          ))}
        </div>
      )}

      <h2 className="card-title">
        Active rentals ({dropoffs.length})
      </h2>
      {dropoffs.length === 0 ? (
        <p className="muted-text" style={{ fontSize: 14 }}>{isRunner ? "No returns assigned to you." : "No active rentals right now."}</p>
      ) : (
        <div>
          {dropoffs.map((d) => (
            <DropoffCard key={d.rentalId} item={d} isRunner={isRunner} runners={runners} />
          ))}
        </div>
      )}
    </div>
  );
}
