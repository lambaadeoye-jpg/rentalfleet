-- Public Marketing Site Access
-- Everything built so far assumed a logged-in staff or customer user. The
-- public homepage and lead form are the first genuinely anonymous surface --
-- there was no RLS path at all for an unauthenticated visitor to read
-- vehicle categories, read gig platform options, or submit a lead. Also
-- enforces V2.1's required lead fields at the database level, not just in
-- the frontend form ("business rules must not exist only in frontend
-- controls" -- V2.1 §24).

-- ---------------------------------------------------------------------------
-- 1. ENFORCE REQUIRED LEAD FIELDS (V2.1 §23 acceptance criteria: first name,
-- last name, and mobile phone are all required)
-- ---------------------------------------------------------------------------
alter table lead alter column first_name set not null;
alter table lead alter column last_name set not null;
alter table lead alter column phone set not null;

alter table lead drop constraint if exists lead_fields_not_blank;
alter table lead add constraint lead_fields_not_blank check (
  length(trim(first_name)) > 0
  and length(trim(last_name)) > 0
  and length(trim(phone)) > 0
);

-- ---------------------------------------------------------------------------
-- 2. PUBLIC READ ACCESS TO NON-SENSITIVE CATALOG DATA
-- vehicle_category and gig_platform contain nothing sensitive -- the
-- previous gig_platform policy (authenticated-only) was an unnecessary
-- restriction for a name list the public homepage needs to render.
-- ---------------------------------------------------------------------------
drop policy if exists public_read_active on vehicle_category;
create policy public_read_active on vehicle_category for select
  using (active);

drop policy if exists gig_platform_read_all on gig_platform;
drop policy if exists public_read_all on gig_platform;
create policy public_read_all on gig_platform for select
  using (true);

-- tenant.name/slug/timezone/currency/locale are not sensitive (no financial
-- or internal data lives on this table) -- a public marketing page needs to
-- render its own tenant's name. Scoped to active tenants only.
drop policy if exists public_read_active_tenant on tenant;
create policy public_read_active_tenant on tenant for select
  using (status = 'active');

-- ---------------------------------------------------------------------------
-- 3. PUBLIC LEAD SUBMISSION
-- Anonymous visitors need to be able to INSERT a lead (and their gig
-- platform selections) -- this is the entire point of the homepage. They
-- get INSERT only: no SELECT/UPDATE/DELETE, so a submitted lead can never be
-- read back or tampered with by the person who submitted it or anyone else
-- browsing anonymously. Staff retain full access via the existing
-- tenant_isolation_* policies from 0014.
-- ---------------------------------------------------------------------------
drop policy if exists public_lead_insert on lead;
create policy public_lead_insert on lead for insert
  to anon
  with check (true);

drop policy if exists public_lead_gig_platform_insert on lead_gig_platform;
create policy public_lead_gig_platform_insert on lead_gig_platform for insert
  to anon
  with check (true);

-- IMPORTANT IMPLEMENTATION NOTE (found the hard way while testing this):
-- Because anon has INSERT only (no SELECT) on `lead`, any INSERT that also
-- tries to read the row back -- an SQL "RETURNING" clause, or Supabase-JS's
-- `.insert(...).select()` -- will fail with the confusing error "new row
-- violates row-level security policy for table lead", even though the
-- INSERT's own WITH CHECK passed fine. RETURNING requires reading back the
-- just-written row, which is a SELECT-shaped operation, and anon has no
-- SELECT policy here by design. This is correct, intended behavior, not a
-- bug -- but it means the application must generate the lead's UUID itself
-- (e.g. crypto.randomUUID()) and pass it explicitly on insert, rather than
-- relying on the database default + reading it back, if it needs the id
-- for a follow-up insert (e.g. lead_gig_platform rows).
