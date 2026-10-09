import { createClient } from "@/lib/supabase/server";
import { agreementState, needsAttention, type AgreementState } from "@/lib/contracts";
import { lastFour, maskEmail } from "@/lib/agreement-notice";

export type ContractRow = {
  rentalId: string;
  customerId: string;
  renter: string;
  vehicle: string;
  plate: string | null;
  rentalStatus: string;
  state: AgreementState;
  attention: boolean;
  signedAt: string | null;
  signerName: string | null;
  version: number | null;
  linkExpiresAt: string | null;
  downloadUrl: string | null;
  /** Last four digits of a usable phone number, or null when the renter can't be texted. */
  phoneLast4: string | null;
  /** Masked email when the renter has a usable one, else null. */
  emailMasked: string | null;
};

const BUCKET = "applicant-documents"; // where signed agreements are stored (see agreement-actions.ts)

export async function loadContracts(): Promise<ContractRow[]> {
  const supabase = await createClient();

  const { data: rentals } = await supabase
    .from("rental")
    .select("id, status, start_at, created_at, customer:customer_id(id, first_name, last_name, phone, email), rental_segment(vehicle:vehicle_id(year, make, model, plate))")
    .in("status", ["approved", "scheduled", "active", "returned", "closed"])
    .order("created_at", { ascending: false })
    .limit(150);
  const ids = (rentals ?? []).map((r: any) => r.id);
  if (ids.length === 0) return [];

  const [{ data: requests }, { data: signedDocs }] = await Promise.all([
    supabase
      .from("sign_request")
      .select("rental_id, created_at, expires_at, signed_at, revoked_at, document_version:document_version_id(version)")
      .in("rental_id", ids),
    supabase.from("signed_document").select("rental_id, signer_name, signed_at, storage_key").in("rental_id", ids).not("sign_request_id", "is", null),
  ]);

  const requestsByRental = new Map<string, any[]>();
  for (const q of requests ?? []) requestsByRental.set(q.rental_id, [...(requestsByRental.get(q.rental_id) ?? []), q]);
  const signedByRental = new Map<string, any>();
  for (const s of signedDocs ?? []) signedByRental.set(s.rental_id, s);

  // One batched call for every download link instead of one per row.
  const paths = [...signedByRental.values()].map((s) => s.storage_key).filter(Boolean) as string[];
  const urlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 600);
    for (const u of urls ?? []) if (u.path && u.signedUrl) urlByPath.set(u.path, u.signedUrl);
  }

  const rows: ContractRow[] = (rentals ?? []).map((r: any) => {
    const reqs = (requestsByRental.get(r.id) ?? []).map((q) => ({ createdAt: q.created_at, expiresAt: q.expires_at, signedAt: q.signed_at, revokedAt: q.revoked_at }));
    const signed = signedByRental.get(r.id);
    const state = agreementState({ signed: Boolean(signed), requests: reqs });
    const newest = [...(requestsByRental.get(r.id) ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    const seg = r.rental_segment?.[0];
    const v = seg?.vehicle;
    const signedRequest = (requestsByRental.get(r.id) ?? []).find((q) => q.signed_at) ?? newest;
    return {
      rentalId: r.id,
      customerId: r.customer?.id ?? "",
      renter: r.customer ? `${r.customer.first_name} ${r.customer.last_name}`.trim() : "Unknown",
      vehicle: v ? [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle" : "No car assigned",
      plate: v?.plate ?? null,
      rentalStatus: r.status,
      state,
      attention: needsAttention(r.status, state),
      signedAt: signed?.signed_at ?? null,
      signerName: signed?.signer_name ?? null,
      version: signedRequest?.document_version?.version ?? null,
      linkExpiresAt: state === "waiting" ? newest?.expires_at ?? null : null,
      phoneLast4: lastFour(r.customer?.phone),
      emailMasked: maskEmail(r.customer?.email),
      downloadUrl: signed?.storage_key ? urlByPath.get(signed.storage_key) ?? null : null,
    };
  });

  // Problems first, then the rest in the order they came (newest first).
  return rows.sort((a, b) => Number(b.attention) - Number(a.attention));
}
