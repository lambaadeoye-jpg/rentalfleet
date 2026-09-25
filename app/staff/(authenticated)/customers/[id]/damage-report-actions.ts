"use server";

import { createClient } from "@/lib/supabase/server";
import { generateDamageReportPdf, type DamagePhoto } from "@/lib/pdf/financial-document";
import { fireN8nWebhook, N8N_WEBHOOK_PATHS } from "@/lib/n8n-webhook";
import { logAuditEvent } from "@/lib/audit-log";

// Builds on the return-inspection photo work already shipped: pulls
// whatever photos were captured at dropoff, embeds them directly in the
// PDF, links to a damage charge if one was logged for this rental.
export async function generateDamageReport(
  rentalId: string,
  description: string,
  relatedChargeId?: string
): Promise<{ success: boolean; error?: string }> {
  if (!description.trim()) return { success: false, error: "Describe the damage." };

  const supabase = await createClient();

  const { data: rental } = await supabase
    .from("rental")
    .select("id, tenant_id, customer_id, tenant:tenant_id(name), customer:customer_id(first_name, last_name, email)")
    .eq("id", rentalId)
    .single();

  if (!rental) return { success: false, error: "Rental not found." };
  const tenant = rental.tenant as any;
  const customer = rental.customer as any;

  // Pull the return inspection's photos, if any were captured.
  const { data: inspection } = await supabase
    .from("inspection")
    .select("id")
    .eq("rental_id", rentalId)
    .eq("inspection_type", "return")
    .maybeSingle();

  const photos: DamagePhoto[] = [];
  if (inspection) {
    const { data: media } = await supabase.from("inspection_media").select("storage_key").eq("inspection_id", inspection.id);

    for (const m of media ?? []) {
      const { data: fileData } = await supabase.storage.from("inspection-photos").download(m.storage_key);
      if (fileData) {
        const bytes = new Uint8Array(await fileData.arrayBuffer());
        const contentType = m.storage_key.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
        photos.push({ bytes, contentType });
      }
    }
  }

  let linkedChargeAmount: number | undefined;
  if (relatedChargeId) {
    const { data: charge } = await supabase.from("charge").select("amount").eq("id", relatedChargeId).maybeSingle();
    if (charge) linkedChargeAmount = Number(charge.amount);
  }

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateDamageReportPdf({
      businessName: tenant?.name ?? "Fleet Rental",
      customerName: customer ? `${customer.first_name} ${customer.last_name}` : "Renter",
      rentalReference: rentalId.slice(0, 8),
      date: new Date(),
      description: description.trim(),
      linkedChargeAmount,
      photos,
    });
  } catch (error) {
    console.error("[damage-report] PDF generation failed:", error);
    return { success: false, error: "Couldn't generate the report. Please try again." };
  }

  const path = `${rental.tenant_id}/damage-report-${Date.now()}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("generated-documents")
    .upload(path, pdfBytes, { contentType: "application/pdf" });

  if (uploadError) return { success: false, error: "Couldn't save the report. Please try again." };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: doc, error: docError } = await supabase
    .from("generated_document")
    .insert({
      tenant_id: rental.tenant_id,
      rental_id: rentalId,
      customer_id: rental.customer_id,
      document_type: "damage_report",
      storage_key: path,
      amount: linkedChargeAmount ?? null,
      related_charge_id: relatedChargeId ?? null,
      related_inspection_id: inspection?.id ?? null,
      generated_by: user?.id ?? null,
      sent_to_email: customer?.email ?? null,
    })
    .select("id")
    .single();

  if (docError || !doc) {
    if (docError?.message?.toLowerCase().includes("permission")) {
      return { success: false, error: "You don't have permission to generate a damage report." };
    }
    return { success: false, error: "Report was saved but couldn't be recorded. Please try again." };
  }

  void logAuditEvent({
    tenantId: rental.tenant_id,
    action: "damage_report_generated",
    entityType: "generated_document",
    entityId: doc.id,
    afterData: { rentalId, photoCount: photos.length, relatedChargeId: relatedChargeId ?? null },
    source: "staff_portal",
  });

  if (customer?.email) {
    void fireN8nWebhook(N8N_WEBHOOK_PATHS.documentReady, {
      documentId: doc.id,
      documentType: "damage_report",
      customerEmail: customer.email,
      customerFirstName: customer.first_name,
      storageKey: path,
    });
  }

  return { success: true };
}
