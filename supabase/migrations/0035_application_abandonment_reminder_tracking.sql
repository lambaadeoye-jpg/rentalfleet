-- Add abandonment_reminder_sent_at + updated_at to application
-- abandonment_reminder_sent_at: needed for the [Fleet Rental] Application
-- Abandonment Recovery n8n workflow -- without this, a scheduled check
-- for "draft applications untouched 24h+" would re-notify the same
-- applicant every single day until they either finish or the application
-- changes state.
--
-- updated_at: a real gap found while designing that same workflow.
-- application had no updated_at at all, and the actual step-saving
-- (Personal/License/Work/Insurance) writes to OTHER tables entirely
-- (customer, authorized_driver, platform_eligibility, insurance_policy) --
-- none of which touch application itself. Without this, "abandoned 24h+"
-- could only be checked against created_at, which would incorrectly flag
-- someone actively filling out their application today just because they
-- started it yesterday. The four step-saving server actions
-- (savePersonalStep etc.) are updated alongside this migration to bump
-- this column on every real step save, so it actually reflects last
-- activity, not just creation time.

alter table application add column if not exists abandonment_reminder_sent_at timestamptz;
alter table application add column if not exists updated_at timestamptz not null default now();
