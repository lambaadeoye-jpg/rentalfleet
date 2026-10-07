import { getIncidents, getVehicleOptions, getCustomerOptions } from "./actions";
import IncidentList from "./incident-list";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  const [incidents, vehicles, customers] = await Promise.all([getIncidents(), getVehicleOptions(), getCustomerOptions()]);

  return (
    <div className="page">
      <h1 className="page-title">Incidents</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Vehicle or rental is optional — log what you know now, details can be added later.
      </p>
      <IncidentList initialIncidents={incidents} vehicles={vehicles} customers={customers} />
    </div>
  );
}
