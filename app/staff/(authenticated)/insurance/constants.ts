// Manual-first status vocabulary from migration 0030 -- see that
// migration's comments for why this is a scoped-down subset of the full
// V2.3 spec's 12-state machine, not the whole thing.
export const INSURANCE_STATUSES = [
  "pending",
  "document_received",
  "verified_active",
  "expiring_soon",
  "expired",
  "review_required",
  "cancelled",
] as const;

export const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  document_received: "Document Received",
  verified_active: "Verified Active",
  expiring_soon: "Expiring Soon",
  expired: "Expired",
  review_required: "Review Required",
  cancelled: "Cancelled",
};

export const STATUS_COLOR: Record<string, string> = {
  pending: "var(--text-secondary)",
  document_received: "var(--warning, #f59e0b)",
  verified_active: "var(--signal-green, #16a34a)",
  expiring_soon: "var(--warning, #f59e0b)",
  expired: "var(--red, #dc2626)",
  review_required: "var(--red, #dc2626)",
  cancelled: "var(--text-secondary)",
};
