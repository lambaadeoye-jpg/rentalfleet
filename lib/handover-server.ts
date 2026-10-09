// Server-side loaders shared by the guided pickup screens, the pickup confirmation and the post-pickup message.
import type { SupabaseClient } from "@supabase/supabase-js";
import { AGREEMENT_DOCUMENT_TYPE } from "./agreement";
import { buildRuleValues, RULE_SETTING_KEYS, type RuleValues } from "./rental-rules";
import { AREA_KEYS, CHECK_KEYS, type HandoverState } from "./handover";

/** Rule numbers from the newest approved agreement, plus the office settings. Falls back to the starter numbers. */
export async function loadRuleValues(supabase: SupabaseClient, tenantId?: string): Promise<RuleValues> {
  // Pass the tenant whenever the client can see more than one tenant (the service-role client can).
  let versionQuery = supabase
    .from("document_version")
    .select("variables")
    .eq("document_type", AGREEMENT_DOCUMENT_TYPE)
    .eq("status", "approved");
  let settingsQuery = supabase.from("tenant_setting").select("key, value").in("key", [...RULE_SETTING_KEYS]);
  if (tenantId) {
    versionQuery = versionQuery.eq("tenant_id", tenantId);
    settingsQuery = settingsQuery.eq("tenant_id", tenantId);
  }
  const [{ data: version }, { data: settings }] = await Promise.all([
    versionQuery.order("approved_at", { ascending: false }).limit(1).maybeSingle(),
    settingsQuery,
  ]);
  return buildRuleValues({
    agreementVars: (version?.variables as Record<string, string> | null) ?? null,
    settings: Object.fromEntries((settings ?? []).map((s: any) => [s.key, s.value])),
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || null,
    supportPhone: (process.env.SUPPORT_PHONE || "").trim() || null,
  });
}

export type HandoverRow = {
  identityVerified: boolean;
  checks: Record<string, boolean>;
  briefingAcked: string[];
  testimonialStatus: "none" | "recorded" | "declined";
  testimonialReleaseName: string | null;
};

/** What the runner has finished so far for one rental. Never throws: a missing row means nothing is done yet. */
export async function loadHandoverState(
  supabase: SupabaseClient,
  rentalId: string,
): Promise<{ row: HandoverRow; areaCounts: Record<string, number>; hasWalkthroughVideo: boolean; hasTestimonialVideo: boolean }> {
  const [{ data: row }, { data: inspection }] = await Promise.all([
    supabase.from("pickup_handover").select("identity_verified_at, checks, briefing_acked, testimonial_status, testimonial_release_name").eq("rental_id", rentalId).maybeSingle(),
    supabase.from("inspection").select("id").eq("rental_id", rentalId).eq("inspection_type", "pickup").order("id", { ascending: true }).limit(1).maybeSingle(),
  ]);

  const areaCounts: Record<string, number> = {};
  let hasWalkthroughVideo = false;
  let hasTestimonialVideo = false;
  if (inspection) {
    const { data: media } = await supabase.from("inspection_media").select("media_type, area").eq("inspection_id", inspection.id);
    for (const m of media ?? []) {
      if (m.media_type === "video") {
        if (m.area === "walkthrough") hasWalkthroughVideo = true;
        if (m.area === "testimonial") hasTestimonialVideo = true;
      } else if (m.area && AREA_KEYS.includes(m.area)) {
        areaCounts[m.area] = (areaCounts[m.area] ?? 0) + 1;
      }
    }
  }

  const rawChecks = (row?.checks as Record<string, unknown> | null) ?? {};
  const checks: Record<string, boolean> = {};
  for (const k of CHECK_KEYS) checks[k] = rawChecks[k] === true;
  const rawAcked = (row?.briefing_acked as Record<string, unknown> | null) ?? {};

  return {
    row: {
      identityVerified: Boolean(row?.identity_verified_at),
      checks,
      briefingAcked: Object.keys(rawAcked),
      testimonialStatus: ((row?.testimonial_status as string) ?? "none") as HandoverRow["testimonialStatus"],
      testimonialReleaseName: (row?.testimonial_release_name as string | null) ?? null,
    },
    areaCounts,
    hasWalkthroughVideo,
    hasTestimonialVideo,
  };
}

export function toHandoverState(
  loaded: Awaited<ReturnType<typeof loadHandoverState>>,
  extra: { agreementSigned: boolean; cardCharged: boolean },
): HandoverState {
  return {
    identityVerified: loaded.row.identityVerified,
    agreementSigned: extra.agreementSigned,
    cardCharged: extra.cardCharged,
    areaCounts: loaded.areaCounts,
    hasWalkthroughVideo: loaded.hasWalkthroughVideo,
    checks: loaded.row.checks,
    briefingAcked: loaded.row.briefingAcked,
  };
}
