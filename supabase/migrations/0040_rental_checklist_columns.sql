-- Checklist tracking columns for pickup/dropoff confirmation
-- agreement_acknowledged_at: lightweight, honest placeholder for "agreement
-- walked through" -- no real e-signature feature exists yet (signed_document
-- / document_version tables exist but nothing populates them), so this is
-- a timestamp confirming staff acknowledged it, not a legal signature.
-- pickup_checklist_completed_at / dropoff_checklist_completed_at: real
-- audit trail that the checklist was actually completed, not just a UI
-- state that vanishes on refresh.

alter table rental add column if not exists agreement_acknowledged_at timestamptz;
alter table rental add column if not exists pickup_checklist_completed_at timestamptz;
alter table rental add column if not exists dropoff_checklist_completed_at timestamptz;
