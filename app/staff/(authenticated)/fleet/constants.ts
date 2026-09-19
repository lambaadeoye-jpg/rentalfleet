// Locked vehicle lifecycle from Architecture v2.0 §13, enforced at the
// database level by migration 0018's vehicle_status_check CHECK constraint
// and enforce_status_transition trigger. This list is every value the DB
// will accept; it does NOT mean every transition from every status is
// valid -- the trigger enforces that, and will reject an invalid jump with
// a clear error. This UI intentionally doesn't try to compute "valid next
// states per row" -- simpler to let staff pick and let the database be the
// one source of truth for what's actually allowed, same pattern as every
// other status field in this build.
export const VEHICLE_STATUSES = [
  "acquired",
  "inspection",
  "ready",
  "available",
  "reserved",
  "rented",
  "maintenance",
  "damaged",
  "accident",
  "recovery",
  "impounded",
  "decommissioned",
  "sold",
] as const;

export const STATUS_LABELS: Record<string, string> = {
  acquired: "Acquired",
  inspection: "Inspection",
  ready: "Ready",
  available: "Available",
  reserved: "Reserved",
  rented: "Rented",
  maintenance: "Maintenance",
  damaged: "Damaged",
  accident: "Accident",
  recovery: "Recovery",
  impounded: "Impounded",
  decommissioned: "Decommissioned",
  sold: "Sold",
};

export const STATUS_COLOR: Record<string, string> = {
  acquired: "var(--text-secondary)",
  inspection: "var(--warning, #f59e0b)",
  ready: "var(--warning, #f59e0b)",
  available: "var(--signal-green, #16a34a)",
  reserved: "var(--warning, #f59e0b)",
  rented: "var(--teal)",
  maintenance: "var(--warning, #f59e0b)",
  damaged: "var(--red, #dc2626)",
  accident: "var(--red, #dc2626)",
  recovery: "var(--red, #dc2626)",
  impounded: "var(--red, #dc2626)",
  decommissioned: "var(--text-secondary)",
  sold: "var(--text-secondary)",
};
