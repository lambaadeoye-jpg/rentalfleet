"use server";

import { createClient } from "@/lib/supabase/server";

export type PickupItem = {
  rentalId: string;
  customerFirstName: string;
  customerLastName: string;
  vehicleLabel: string;
  hasLicenseDocument: boolean;
  insuranceVerified: boolean;
};

export type DropoffItem = {
  rentalId: string;
  customerFirstName: string;
  customerLastName: string;
  vehicleLabel: string;
  startMileage: number | null;
};

export async function getPickupsAndDropoffs(): Promise<{ pickups: PickupItem[]; dropoffs: DropoffItem[] }> {
  const supabase = await createClient();

  const [{ data: scheduled }, { data: active }] = await Promise.all([
    supabase
      .from("rental")
      .select("id, customer:customer_id(id, first_name, last_name), rental_segment(vehicle:vehicle_id(make, model, year))")
      .eq("status", "scheduled"),
    supabase
      .from("rental")
      .select("id, customer:customer_id(first_name, last_name), rental_segment(vehicle:vehicle_id(make, model, year), start_mileage)")
      .eq("status", "active"),
  ]);

  const pickups: PickupItem[] = await Promise.all(
    (scheduled ?? []).map(async (r) => {
      const customer = r.customer as any;
      const segment = (r.rental_segment as any)?.[0];
      const vehicle = segment?.vehicle;

      const [{ count: docCount }, { data: insurance }] = await Promise.all([
        supabase
          .from("customer_document")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customer?.id)
          .eq("document_type", "drivers_license"),
        supabase
          .from("insurance_policy")
          .select("verification_status")
          .eq("customer_id", customer?.id)
          .eq("policy_type", "renter")
          .maybeSingle(),
      ]);

      return {
        rentalId: r.id,
        customerFirstName: customer?.first_name ?? "",
        customerLastName: customer?.last_name ?? "",
        vehicleLabel: vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "No vehicle assigned",
        hasLicenseDocument: (docCount ?? 0) > 0,
        insuranceVerified:
          insurance?.verification_status === "verified_active" || insurance?.verification_status === "expiring_soon",
      };
    })
  );

  const dropoffs: DropoffItem[] = (active ?? []).map((r) => {
    const customer = r.customer as any;
    const segment = (r.rental_segment as any)?.[0];
    const vehicle = segment?.vehicle;
    return {
      rentalId: r.id,
      customerFirstName: customer?.first_name ?? "",
      customerLastName: customer?.last_name ?? "",
      vehicleLabel: vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "No vehicle assigned",
      startMileage: segment?.start_mileage ?? null,
    };
  });

  return { pickups, dropoffs };
}
