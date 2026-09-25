"use server";

import { createClient } from "@/lib/supabase/server";
import { generateFinancialDocumentPdf } from "@/lib/pdf/financial-document";
import { fireN8nWebhook, N8N_WEBHOOK_PATHS } from "@/lib/n8n-webhook";

// Shared by recordPayment() (receipt) and approveCharge() (invoice).
// Best-effort by design, same discipline as every other automation in
// this build: a receipt/invoice failing to generate must never break
// the actual payment/approval action it's attached to. Returns the
// generated_document id on success so a caller can act on it further if
// needed, or null if generation failed (logged, not thrown).
export async function generateAndStoreFinancialDocument(params: {
  documentType: "receipt" | "invoice";
  rentalId: string;
  customerId: string;
  amount: number;
  lineLabel: string;
  relatedChargeId?: string;
  relatedPaymentId?: string;
}): Promise<string | null> {
  try {
    const supabase = await createClient();

    const [{ data: rental }, { data: customer }] = await Promise.all([
      supabase.from("rental").select("id, tenant_id, tenant:tenant_id(name)").eq("id", params.rentalId).single(),
      supabase.from("customer").select("first_name, last_name, email").eq("id", params.customerId).single(),
    ]);

    if (!rental || !customer) return null;
    const tenant = rental.tenant as any;

    const pdfBytes = await generateFinancialDocumentPdf({
      documentLabel: params.documentType === "receipt" ? "RECEIPT" : "INVOICE",
      businessName: tenant?.name ?? "Fleet Rental",
      customerName: `${customer.first_name} ${customer.last_name}`,
      rentalReference: params.rentalId.slice(0, 8),
      date: new Date(),
      lineItems: [{ label: params.lineLabel, amount: params.amount }],
      totalLabel: params.documentType === "receipt" ? "Amount Paid" : "Amount Due",
    });

    const path = `${rental.tenant_id}/${params.documentType}-${Date.now()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("generated-documents")
      .upload(path, pdfBytes, { contentType: "application/pdf" });

    if (uploadError) {
      console.error("[generated-document] upload failed:", uploadError);
      return null;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: doc, error: docError } = await supabase
      .from("generated_document")
      .insert({
        tenant_id: rental.tenant_id,
        rental_id: params.rentalId,
        customer_id: params.customerId,
        document_type: params.documentType,
        storage_key: path,
        amount: params.amount,
        related_charge_id: params.relatedChargeId ?? null,
        related_payment_id: params.relatedPaymentId ?? null,
        generated_by: user?.id ?? null,
        sent_to_email: customer.email ?? null,
      })
      .select("id")
      .single();

    if (docError || !doc) {
      console.error("[generated-document] record insert failed:", docError);
      return null;
    }

    // Auto-send: fire-and-forget through n8n, same architecture as every
    // other notification in this build -- never blocks, never throws
    // back to the caller. Real dependency this inherits: actual delivery
    // needs the same domain/email verification already blocking other
    // notifications elsewhere in this build.
    if (customer.email) {
      void fireN8nWebhook(N8N_WEBHOOK_PATHS.documentReady, {
        documentId: doc.id,
        documentType: params.documentType,
        customerEmail: customer.email,
        customerFirstName: customer.first_name,
        amount: params.amount,
        storageKey: path,
      });
    }

    return doc.id;
  } catch (error) {
    console.error("[generated-document] generation failed:", error);
    return null;
  }
}
