-- Add verified_at + created_at to insurance_policy
-- Found while building the Staff Insurance Monitor: the original schema
-- never gave insurance_policy a verified_at column, despite the V2.3 spec
-- explicitly listing it as a core verification record field (§14) and
-- "Last verified date" as a required Staff Insurance Monitor column (§12).
-- created_at added too, matching the pattern every other table in this
-- schema already has, for consistent sorting/display.

alter table insurance_policy add column if not exists verified_at timestamptz;
alter table insurance_policy add column if not exists created_at timestamptz not null default now();
