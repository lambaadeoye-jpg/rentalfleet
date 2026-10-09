"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/staff-role";
import { logAuditEvent } from "@/lib/audit-log";
import { loadHandoverState, loadRuleValues } from "@/lib/handover-server";
import { briefingRules, type BriefingRule } from "@/lib/rental-rules";
import { AREA_KEYS, CHECK_KEYS, MAX_VIDEO_SECONDS, TESTIMONIAL_RELEASE_TEXT, WALKTHROUGH_AREAS, QUICK_CHECKS } from "@/lib/handover";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "inspection-photos";
const VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v"]);

type Supa = Awaited<ReturnType<typeof createClient>>;
type Ctx = { supabase: Supa; userId: string; tenantId: string; vehicleId: string; customerId: string };
type Fail = { success: false; error: string };

/** The runner assigned to this rental (or the office) while the rental is still waiting for pickup. */
async function context(rentalId: string): Promise<Ctx | Fail> {
  if (!UUID_RE.test(rentalId)) return { success: false, error: "Something went wrong. Please try again." };
  const supabase = await createClient();
  const me = await currentUser(supabase);
  if (!me) return { success: false, error: "Not signed in." };

  const { data: rental } = await supabase
    .from("rental")
    .select("id, tenant_id, status, customer_id, assigned_runner_id, rental_segment(vehicle_id)")
    .eq("id", rentalId)
    .maybeSingle();
  if (!rental) return { success: false, error: "Rental not found." };
  if (rental.status !== "scheduled") return { success: false, error: "This pickup is already done." };
  if (me.role === "field_staff" && rental.assigned_runner_id !== me.id) return { success: false, error: "This pickup isn’t assigned to you." };
  if (me.role !== "field_staff" && me.role !== "admin") return { success: false, error: "You don’t have access to this." };

  const vehicleId = (rental.rental_segment as any)?.[0]?.vehicle_id as string | undefined;
  if (!vehicleId) return { success: false, error: "No car is assigned to this rental yet." };
  return { supabase, userId: me.id, tenantId: rental.tenant_id, vehicleId, customerId: rental.customer_id };
}

function failed(c: Ctx | Fail): c is Fail {
  return (c as Fail).success === false;
}

export type HandoverView = {
  identityVerified: boolean;
  checks: Record<string, boolean>;
  areaCounts: Record<string, number>;
  hasWalkthroughVideo: boolean;
  hasTestimonialVideo: boolean;
  briefingAcked: string[];
  testimonialStatus: "none" | "recorded" | "declined";
  rules: BriefingRule[];
  areas: { key: string; label: string }[];
  quickChecks: { key: string; label: string }[];
  releaseText: string;
};

export async function getHandover(rentalId: string): Promise<{ success: true; view: HandoverView } | Fail> {
  const c = await context(rentalId);
  if (failed(c)) return c;
  const [loaded, values] = await Promise.all([loadHandoverState(c.supabase, rentalId), loadRuleValues(c.supabase)]);
  return {
    success: true,
    view: {
      identityVerified: loaded.row.identityVerified,
      checks: loaded.row.checks,
      areaCounts: loaded.areaCounts,
      hasWalkthroughVideo: loaded.hasWalkthroughVideo,
      hasTestimonialVideo: loaded.hasTestimonialVideo,
      briefingAcked: loaded.row.briefingAcked,
      testimonialStatus: loaded.row.testimonialStatus,
      rules: briefingRules(values),
      areas: WALKTHROUGH_AREAS.map((a) => ({ key: a.key, label: a.label })),
      quickChecks: QUICK_CHECKS.map((q) => ({ key: q.key, label: q.label })),
      releaseText: TESTIMONIAL_RELEASE_TEXT,
    },
  };
}

async function patchHandover(c: Ctx, rentalId: string, patch: Record<string, unknown>): Promise<string | null> {
  const { error } = await c.supabase.from("pickup_handover").upsert({ rental_id: rentalId, tenant_id: c.tenantId, ...patch }, { onConflict: "rental_id" });
  if (!error) return null;
  return error.message?.toLowerCase().includes("permission") ? "You can’t change this pickup." : "Couldn’t save. Please try again.";
}

export async function verifyIdentity(rentalId: string): Promise<{ success: boolean; error?: string }> {
  const c = await context(rentalId);
  if (failed(c)) return c;
  const err = await patchHandover(c, rentalId, { identity_verified_at: new Date().toISOString(), identity_verified_by: c.userId });
  return err ? { success: false, error: err } : { success: true };
}

/** A short-lived link to the renter’s license photo. Only available while the pickup is still waiting. */
export async function getLicensePhotoUrl(rentalId: string): Promise<{ success: boolean; url?: string; error?: string }> {
  const c = await context(rentalId);
  if (failed(c)) return c;
  const admin = createAdminClient();
  if (!admin) return { success: false, error: "Photo viewing isn’t set up yet." };
  const { data: doc } = await admin
    .from("customer_document")
    .select("storage_key")
    .eq("customer_id", c.customerId)
    .eq("tenant_id", c.tenantId)
    .eq("document_type", "drivers_license")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!doc?.storage_key) return { success: false, error: "No license photo on file. Call the office." };
  const { data: signed } = await admin.storage.from("applicant-documents").createSignedUrl(doc.storage_key, 120);
  if (!signed?.signedUrl) return { success: false, error: "Couldn’t open the photo. Try again." };
  void logAuditEvent({ tenantId: c.tenantId, action: "license_photo_viewed", entityType: "rental", entityId: rentalId, source: "staff_portal" });
  return { success: true, url: signed.signedUrl };
}

export async function setQuickCheck(rentalId: string, key: string, on: boolean): Promise<{ success: boolean; error?: string }> {
  if (!CHECK_KEYS.includes(key)) return { success: false, error: "Unknown check." };
  const c = await context(rentalId);
  if (failed(c)) return c;
  const loaded = await loadHandoverState(c.supabase, rentalId);
  const err = await patchHandover(c, rentalId, { checks: { ...loaded.row.checks, [key]: on } });
  return err ? { success: false, error: err } : { success: true };
}

/** The renter has been told this rule. We save the exact words shown, as a record of what they were told. */
export async function setRuleExplained(rentalId: string, ruleId: string, on: boolean): Promise<{ success: boolean; error?: string }> {
  const c = await context(rentalId);
  if (failed(c)) return c;
  const rules = briefingRules(await loadRuleValues(c.supabase));
  if (!rules.some((r) => r.id === ruleId)) return { success: false, error: "Unknown rule." };
  const { data: row } = await c.supabase.from("pickup_handover").select("briefing_acked").eq("rental_id", rentalId).maybeSingle();
  const acked = { ...((row?.briefing_acked as Record<string, string> | null) ?? {}) };
  if (on) acked[ruleId] = new Date().toISOString();
  else delete acked[ruleId];
  const err = await patchHandover(c, rentalId, { briefing_acked: acked, briefing_snapshot: rules });
  return err ? { success: false, error: err } : { success: true };
}

async function ensureInspection(c: Ctx, rentalId: string): Promise<string | null> {
  const { data: existing } = await c.supabase.from("inspection").select("id").eq("rental_id", rentalId).eq("inspection_type", "pickup").maybeSingle();
  if (existing) return existing.id as string;
  const { data: created, error } = await c.supabase
    .from("inspection")
    .insert({ tenant_id: c.tenantId, rental_id: rentalId, vehicle_id: c.vehicleId, inspection_type: "pickup", completed_by_user_id: c.userId, completed_at: new Date().toISOString() })
    .select("id")
    .single();
  return error || !created ? null : (created.id as string);
}

export async function uploadWalkthroughPhoto(rentalId: string, area: string, formData: FormData): Promise<{ success: boolean; error?: string }> {
  if (!AREA_KEYS.includes(area)) return { success: false, error: "Unknown part of the car." };
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { success: false, error: "Take a photo first." };
  if (file.size > 10 * 1024 * 1024) return { success: false, error: "Photo is too large (max 10MB)." };
  if (!file.type.startsWith("image/")) return { success: false, error: "That isn’t a photo." };

  const c = await context(rentalId);
  if (failed(c)) return c;
  const inspectionId = await ensureInspection(c, rentalId);
  if (!inspectionId) return { success: false, error: "Couldn’t start the inspection record. Please try again." };

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${c.tenantId}/${inspectionId}/${area}_${Date.now()}_${safeName}`;
  const { error: upErr } = await c.supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (upErr) return { success: false, error: "Upload failed. Please try again." };
  const { error } = await c.supabase.from("inspection_media").insert({
    tenant_id: c.tenantId, inspection_id: inspectionId, storage_key: path, media_type: "photo", area, captured_at: new Date().toISOString(),
  });
  if (error) return { success: false, error: "Photo uploaded but couldn’t be recorded. Please try again." };
  return { success: true };
}

/** Videos go straight from the phone to storage (they are too big to pass through the app). */
export async function prepareVideoUpload(rentalId: string, kind: "walkthrough" | "testimonial", ext: string): Promise<{ success: boolean; path?: string; token?: string; error?: string }> {
  const cleanExt = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!VIDEO_EXT.has(cleanExt)) return { success: false, error: "Use a normal phone video (mp4 or mov)." };
  const c = await context(rentalId);
  if (failed(c)) return c;
  if (kind === "testimonial") {
    const loaded = await loadHandoverState(c.supabase, rentalId);
    if (loaded.row.testimonialStatus === "declined") return { success: false, error: "The renter said no to the video." };
  }
  const admin = createAdminClient();
  if (!admin) return { success: false, error: "Video upload isn’t set up yet." };
  const inspectionId = await ensureInspection(c, rentalId);
  if (!inspectionId) return { success: false, error: "Couldn’t start the inspection record. Please try again." };
  const path = `${c.tenantId}/${inspectionId}/${kind}_${Date.now()}.${cleanExt}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) return { success: false, error: "Couldn’t start the upload. Try again." };
  return { success: true, path, token: data.token };
}

export async function recordVideo(rentalId: string, kind: "walkthrough" | "testimonial", path: string, seconds: number): Promise<{ success: boolean; error?: string }> {
  const secs = Math.round(seconds);
  if (!Number.isFinite(secs) || secs < 1 || secs > MAX_VIDEO_SECONDS) return { success: false, error: `Videos can be at most ${MAX_VIDEO_SECONDS} seconds.` };
  const c = await context(rentalId);
  if (failed(c)) return c;
  const inspectionId = await ensureInspection(c, rentalId);
  if (!inspectionId) return { success: false, error: "Couldn’t find the inspection record." };
  // Only a file this flow created for this rental can be attached.
  const prefix = `${c.tenantId}/${inspectionId}/${kind}_`;
  if (typeof path !== "string" || !path.startsWith(prefix) || path.includes("..")) return { success: false, error: "Something went wrong. Please try again." };
  const admin = createAdminClient();
  if (admin) {
    const folder = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    const { data: found } = await admin.storage.from(BUCKET).list(folder, { search: name, limit: 1 });
    if (!found?.some((f) => f.name === name)) return { success: false, error: "The video didn’t finish uploading. Try again." };
  }
  const { error } = await c.supabase.from("inspection_media").insert({
    tenant_id: c.tenantId, inspection_id: inspectionId, storage_key: path, media_type: "video", area: kind, duration_seconds: secs, captured_at: new Date().toISOString(),
  });
  if (error) return { success: false, error: error.message?.includes("video_length") ? `Videos can be at most ${MAX_VIDEO_SECONDS} seconds.` : "Couldn’t save the video. Please try again." };
  return { success: true };
}

/** The renter agreed on screen: they typed their name under the release text. */
export async function saveTestimonialRelease(rentalId: string, typedName: string): Promise<{ success: boolean; error?: string }> {
  const name = typedName.trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 80) return { success: false, error: "Ask the renter to type their full name." };
  const c = await context(rentalId);
  if (failed(c)) return c;
  const loaded = await loadHandoverState(c.supabase, rentalId);
  if (!loaded.hasTestimonialVideo) return { success: false, error: "Record the video first." };
  const err = await patchHandover(c, rentalId, {
    testimonial_status: "recorded", testimonial_release_name: name, testimonial_release_text: TESTIMONIAL_RELEASE_TEXT, testimonial_release_at: new Date().toISOString(),
  });
  return err ? { success: false, error: err } : { success: true };
}

export async function declineTestimonial(rentalId: string): Promise<{ success: boolean; error?: string }> {
  const c = await context(rentalId);
  if (failed(c)) return c;
  const err = await patchHandover(c, rentalId, { testimonial_status: "declined" });
  revalidatePath("/staff/pickups");
  return err ? { success: false, error: err } : { success: true };
}
