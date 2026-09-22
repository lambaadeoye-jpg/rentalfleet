"use server";

import { createClient } from "@/lib/supabase/server";

// Creates (or reuses) an inspection record for this rental+type, uploads
// the photo to the inspection-photos bucket, and records it. Real gap
// closed here: pickup/return inspection was explicitly named in the
// locked flow but had zero UI -- no documented vehicle condition at
// handover or return, meaning no real protection in a damage dispute.
export async function uploadInspectionPhoto(
  rentalId: string,
  vehicleId: string,
  inspectionType: "pickup" | "return",
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { success: false, error: "Choose a photo first." };
  if (file.size > 10 * 1024 * 1024) return { success: false, error: "Photo is too large (max 10MB)." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not signed in." };

  const { data: rental } = await supabase.from("rental").select("id, tenant_id").eq("id", rentalId).single();
  if (!rental) return { success: false, error: "Rental not found." };

  // Reuse an existing inspection for this rental+type if one was already
  // started (e.g., a second photo for the same pickup), rather than
  // creating a new inspection record per photo.
  let { data: inspection } = await supabase
    .from("inspection")
    .select("id")
    .eq("rental_id", rentalId)
    .eq("inspection_type", inspectionType)
    .maybeSingle();

  if (!inspection) {
    const { data: newInspection, error: inspectionError } = await supabase
      .from("inspection")
      .insert({
        tenant_id: rental.tenant_id,
        rental_id: rentalId,
        vehicle_id: vehicleId,
        inspection_type: inspectionType,
        completed_by_user_id: user.id,
        completed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (inspectionError || !newInspection) {
      if (inspectionError?.message?.toLowerCase().includes("permission")) {
        return { success: false, error: "You don't have permission to log an inspection." };
      }
      return { success: false, error: "Couldn't start the inspection record. Please try again." };
    }
    inspection = newInspection;
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${rental.tenant_id}/${inspection.id}/${Date.now()}_${safeName}`;

  const { error: uploadError } = await supabase.storage.from("inspection-photos").upload(path, file, { upsert: false });
  if (uploadError) return { success: false, error: "Upload failed. Please try again." };

  const { error: mediaError } = await supabase.from("inspection_media").insert({
    tenant_id: rental.tenant_id,
    inspection_id: inspection.id,
    storage_key: path,
    media_type: "photo",
    captured_at: new Date().toISOString(),
  });

  if (mediaError) return { success: false, error: "Photo uploaded but couldn't be recorded. Please try again." };

  return { success: true };
}

export async function getInspectionPhotoCount(rentalId: string, inspectionType: "pickup" | "return"): Promise<number> {
  const supabase = await createClient();
  const { data: inspection } = await supabase
    .from("inspection")
    .select("id")
    .eq("rental_id", rentalId)
    .eq("inspection_type", inspectionType)
    .maybeSingle();

  if (!inspection) return 0;

  const { count } = await supabase
    .from("inspection_media")
    .select("*", { count: "exact", head: true })
    .eq("inspection_id", inspection.id);

  return count ?? 0;
}
