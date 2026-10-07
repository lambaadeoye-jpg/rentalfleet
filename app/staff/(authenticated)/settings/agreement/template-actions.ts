"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  AGREEMENT_DOCUMENT_TYPE, STARTER_CLAUSES, STARTER_INTRO, STARTER_VARIABLES, VARIABLE_KEYS, validateTemplate, hasCounselNotes,
  type AgreementTemplate,
} from "@/lib/agreement";

export type TemplateVersion = {
  id: string;
  version: number;
  title: string;
  status: "draft" | "approved";
  approvedAt: string | null;
  notesAcknowledged: boolean;
  template: AgreementTemplate;
  variables: Record<string, string>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listAgreementVersions(): Promise<TemplateVersion[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("document_version")
    .select("id, version, title, status, approved_at, notes_acknowledged, clauses, variables")
    .eq("document_type", AGREEMENT_DOCUMENT_TYPE)
    .order("version", { ascending: false });
  return (data ?? []).map((d: any) => ({
    id: d.id,
    version: d.version,
    title: d.title ?? "Rental agreement",
    status: d.status,
    approvedAt: d.approved_at,
    notesAcknowledged: d.notes_acknowledged,
    template: (d.clauses as AgreementTemplate) ?? { intro: "", clauses: [] },
    variables: (d.variables as Record<string, string>) ?? {},
  }));
}

function cleanVariables(v: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of VARIABLE_KEYS) out[k] = String(v?.[k] ?? "").trim().slice(0, 120);
  return out;
}

function mapError(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("permission")) return "You don’t have permission to change the agreement.";
  if (m.includes("not_a_draft")) return "That version is approved and locked. Make a new draft to change it.";
  if (m.includes("counsel_notes_open")) return "This text still has [Counsel: ...] notes. Confirm to approve it anyway.";
  if (m.includes("invalid_template")) return "The agreement text isn’t valid.";
  return "Couldn’t save. Please try again.";
}

/** Create a draft from Zivo’s starter text, or (copyFromId) from an existing version. */
export async function createAgreementDraft(copyFromId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
  let template: AgreementTemplate = { intro: STARTER_INTRO, clauses: STARTER_CLAUSES };
  let variables: Record<string, string> = { ...STARTER_VARIABLES };
  let title = "Rental agreement (draft for counsel)";
  const supabase = await createClient();

  if (copyFromId) {
    if (!UUID_RE.test(copyFromId)) return { success: false, error: "Something went wrong. Please try again." };
    const { data } = await supabase.from("document_version").select("title, clauses, variables").eq("id", copyFromId).maybeSingle();
    if (!data?.clauses) return { success: false, error: "Version not found." };
    template = data.clauses as AgreementTemplate;
    variables = cleanVariables((data.variables as Record<string, string>) ?? {});
    title = `${data.title ?? "Rental agreement"} (copy)`;
  }

  const { data, error } = await supabase.rpc("save_agreement_draft", { p_version_id: null, p_title: title, p_template: template, p_variables: variables });
  if (error) return { success: false, error: mapError(error.message) };
  revalidatePath("/staff/settings/agreement");
  return { success: true, id: data as string };
}

export async function saveAgreementDraft(
  versionId: string, title: string, template: AgreementTemplate, variables: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  if (!UUID_RE.test(versionId)) return { success: false, error: "Something went wrong. Please try again." };
  const problem = validateTemplate(template);
  if (problem) return { success: false, error: problem };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_agreement_draft", {
    p_version_id: versionId, p_title: title, p_template: template, p_variables: cleanVariables(variables),
  });
  if (error) return { success: false, error: mapError(error.message) };
  revalidatePath("/staff/settings/agreement");
  return { success: true };
}

export async function approveAgreementVersion(versionId: string, acknowledgeNotes: boolean): Promise<{ success: boolean; needsAck?: boolean; error?: string }> {
  if (!UUID_RE.test(versionId)) return { success: false, error: "Something went wrong. Please try again." };
  const supabase = await createClient();
  const { data: v } = await supabase.from("document_version").select("clauses, variables").eq("id", versionId).maybeSingle();
  if (!v?.clauses) return { success: false, error: "Version not found." };
  const template = v.clauses as AgreementTemplate;
  const problem = validateTemplate(template);
  if (problem) return { success: false, error: problem };
  if (hasCounselNotes(template) && !acknowledgeNotes) return { success: false, needsAck: true, error: mapError("counsel_notes_open") };

  const { error } = await supabase.rpc("approve_agreement_version", { p_version_id: versionId, p_ack_notes: acknowledgeNotes });
  if (error) return { success: false, error: mapError(error.message) };
  revalidatePath("/staff/settings/agreement");
  return { success: true };
}
