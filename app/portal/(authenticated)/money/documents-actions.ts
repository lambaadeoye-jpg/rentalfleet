"use server";

import { createClient } from "@/lib/supabase/server";

export type GeneratedDocumentSummary = {
  id: string;
  documentType: string;
  amount: number | null;
  generatedAt: string;
  storageKey: string;
};

export async function getMyGeneratedDocuments(): Promise<GeneratedDocumentSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("generated_document")
    .select("id, document_type, amount, generated_at, storage_key")
    .in("document_type", ["receipt", "invoice"])
    .order("generated_at", { ascending: false });

  return (data ?? []).map((d) => ({
    id: d.id,
    documentType: d.document_type,
    amount: d.amount,
    generatedAt: d.generated_at,
    storageKey: d.storage_key,
  }));
}

export async function getDocumentDownloadUrl(storageKey: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("generated-documents").createSignedUrl(storageKey, 300);
  if (error || !data) return null;
  return data.signedUrl;
}
