import { getWorkOrders, getVehicleOptions } from "./actions";
import MaintenanceList from "./maintenance-list";

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const [workOrders, vehicles] = await Promise.all([getWorkOrders(), getVehicleOptions()]);

  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Maintenance</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Logging a work order moves the vehicle to maintenance status; completing one frees it
        back to available.
      </p>
      <MaintenanceList initialWorkOrders={workOrders} vehicles={vehicles} />
    </div>
  );
}
