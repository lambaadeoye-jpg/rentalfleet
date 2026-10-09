import { createClient } from "@/lib/supabase/server";
import { currentRoleName } from "@/lib/staff-role";
import { getWorkOrders, getVehicleOptions, getMaintenanceOffice } from "./actions";
import { getRunnerMaintenance } from "./runner-actions";
import MaintenanceList from "./maintenance-list";
import RunnerMaintenance from "./runner-maintenance";
import ServiceDue from "./service-due";

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const isRunner = (await currentRoleName(await createClient())) === "field_staff";

  if (isRunner) {
    const { jobs, cars, limit, needsMigration } = await getRunnerMaintenance();
    return (
      <div className="page" style={{ maxWidth: 560 }}>
        <h1 className="page-title">Maintenance</h1>
        {needsMigration ? (
          <div className="card"><p className="muted-text">Maintenance isn’t switched on yet. Ask the office.</p></div>
        ) : (
          <>
            <ServiceDue />
            <RunnerMaintenance jobs={jobs} cars={cars} limit={limit} />
          </>
        )}
      </div>
    );
  }

  const [workOrders, vehicles, office] = await Promise.all([getWorkOrders(), getVehicleOptions(), getMaintenanceOffice()]);

  return (
    <div className="page">
      <h1 className="page-title">Maintenance</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Logging a work order moves the vehicle to maintenance status; completing one frees it
        back to available.
      </p>
      <ServiceDue />
      <MaintenanceList initialWorkOrders={workOrders} vehicles={vehicles} runners={office.runners} limit={office.limit} />
    </div>
  );
}
