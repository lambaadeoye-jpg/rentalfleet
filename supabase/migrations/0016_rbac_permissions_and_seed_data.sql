-- RBAC Permissions + Locked State-Machine Constraints + Seed Reference Data
-- Closes two gaps flagged during Phase 1 build-out:
--   1. `role` had no permission codes (Architecture v2.0 requires "Postgres RLS + app RBAC",
--      not RLS alone). Adds `permission` (global codes) + `role_permission` (tenant-scoped grants).
--   2. Status columns (rental.status, vehicle.status, payment.status, recovery_case.status,
--      application.status) were free text with zero enforcement, despite Architecture v2.0 §13
--      already locking exact state machines for each. Adds CHECK constraints so an invalid
--      state transition is rejected by the database itself, not just application code
--      (BUILD_MASTER_SPECIFICATION_v2.0.md §23, Acceptance Standard #3: "State transitions
--      are explicit").
-- Also seeds non-sensitive reference data per README.md's seeding rule.

-- ---------------------------------------------------------------------------
-- 1. PERMISSION CODES (global reference list — not tenant-owned, not sensitive)
-- ---------------------------------------------------------------------------
create table if not exists permission (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  description text not null
);

alter table permission enable row level security;
drop policy if exists permission_read_all on permission;
create policy permission_read_all on permission for select
  using (auth.role() = 'authenticated');

insert into permission (code, description) values
  ('approve_driver', 'Approve or decline a driver application'),
  ('assign_vehicle', 'Assign or override a vehicle assignment to a rental'),
  ('swap_vehicle', 'Approve a vehicle swap on an active rental'),
  ('start_rental', 'Move a rental from approved/scheduled into active'),
  ('close_rental', 'Close out a returned rental'),
  ('collect_payment', 'Record or process a payment'),
  ('issue_refund', 'Approve a refund or credit'),
  ('approve_charge', 'Approve a pending charge (e.g. damage, late fee) before it posts'),
  ('authorize_recovery', 'Authorize a recovery case to proceed (locked human-approval step)'),
  ('approve_recovery_expense', 'Approve a recovery expense before it can become a renter charge'),
  ('manage_fleet', 'Add, edit, or retire vehicles and categories'),
  ('manage_pricing_policy', 'Create or version pricing and policy rules'),
  ('manage_users_roles', 'Manage staff users, roles, and permission grants for this tenant'),
  ('view_reports', 'View financial and operational reports')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. ROLE -> PERMISSION GRANTS (tenant-scoped; picked up by the standard
--    tenant-isolation RLS pattern from 0014, applied explicitly below since
--    this table didn't exist when that migration's loop ran)
-- ---------------------------------------------------------------------------
create table if not exists role_permission (
  tenant_id uuid not null references tenant(id),
  role_id uuid not null references role(id),
  permission_id uuid not null references permission(id),
  primary key (role_id, permission_id)
);

alter table role_permission enable row level security;
alter table role_permission force row level security;

drop policy if exists tenant_isolation_select on role_permission;
create policy tenant_isolation_select on role_permission for select
  using (tenant_id in (select app_current_tenant_ids()));

drop policy if exists tenant_isolation_write on role_permission;
create policy tenant_isolation_write on role_permission for insert
  with check (tenant_id in (select app_current_tenant_ids()));

drop policy if exists tenant_isolation_update on role_permission;
create policy tenant_isolation_update on role_permission for update
  using (tenant_id in (select app_current_tenant_ids()))
  with check (tenant_id in (select app_current_tenant_ids()));

drop policy if exists tenant_isolation_delete on role_permission;
create policy tenant_isolation_delete on role_permission for delete
  using (tenant_id in (select app_current_tenant_ids()));

-- Grant the pilot tenant's admin role every permission that exists today.
insert into role_permission (tenant_id, role_id, permission_id)
select r.tenant_id, r.id, p.id
from role r
cross join permission p
where r.name = 'admin'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. LOCKED STATE MACHINES (Architecture v2.0 §13) AS CHECK CONSTRAINTS
-- ---------------------------------------------------------------------------
alter table rental drop constraint if exists rental_status_check;
alter table rental add constraint rental_status_check check (
  status in ('pending','approved','scheduled','active','extended','return_pending',
             'returned','closed','cancelled','suspended','delinquent','terminated','recovery')
);

alter table vehicle drop constraint if exists vehicle_status_check;
alter table vehicle add constraint vehicle_status_check check (
  status in ('acquired','inspection','ready','available','reserved','rented',
             'maintenance','damaged','accident','recovery','impounded','decommissioned','sold')
);

alter table payment drop constraint if exists payment_status_check;
alter table payment add constraint payment_status_check check (
  status in ('scheduled','processing','paid','failed','retrying','delinquent','manual_review')
);

alter table recovery_case drop constraint if exists recovery_case_status_check;
alter table recovery_case add constraint recovery_case_status_check check (
  status in ('delinquent','review','authorized','assigned','in_progress','located',
             'recovered','inspection','turnaround','available','closed','unrecovered')
);

alter table application drop constraint if exists application_status_check;
alter table application add constraint application_status_check check (
  status in ('draft','submitted','screening','review','approved',
             'conditionally_approved','declined','expired')
);

-- ---------------------------------------------------------------------------
-- 4. SEED REFERENCE DATA (non-sensitive only, per README.md)
-- ---------------------------------------------------------------------------
-- Default direct booking channel for the pilot tenant.
insert into booking_channel (tenant_id, code, name)
select id, 'direct', 'Direct (company website / walk-in)' from tenant where slug = 'fleet-rental-pilot'
on conflict (tenant_id, code) do nothing;

-- Starter vehicle categories, matching the candidate vehicle classes named in
-- PRS v2.0 §3 (Ford Fusion, Toyota Corolla, Honda Civic/City-class sedans).
insert into vehicle_category (tenant_id, name, description)
select id, 'Economy Sedan', 'Ford Fusion / Toyota Corolla / Honda Civic class - primary pilot category'
from tenant where slug = 'fleet-rental-pilot'
on conflict (tenant_id, name) do nothing;

-- Draft pricing/mileage/deposit policy, version 1, NOT marked immutable yet.
-- Values here mirror the pilot unit-economics model already built (see
-- gig_rental_unit_economics.xlsx): $400/wk blended rate midpoint, deposit =
-- one week's rent, unlimited mileage as an initial policy per PRS v2.0 §8.
-- FLAGGED: this is a placeholder for development/demo purposes only. Phase 0
-- ("Rules & Providers") requires these numbers to be formally locked -
-- agreement terms, cancellation/refund rules, late fee/grace period, and the
-- real insurance-driven pricing floor - before this policy version governs
-- any real rental. Do not mark immutable=true until that sign-off happens.
insert into policy_version (tenant_id, policy_type, version, effective_from, rules, immutable)
select id, 'pricing_and_mileage', 1, now(),
  '{"weekly_rate_usd": 400, "deposit_weeks": 1, "mileage_policy": "unlimited", "status": "DRAFT - not yet approved"}'::jsonb,
  false
from tenant where slug = 'fleet-rental-pilot'
on conflict (tenant_id, policy_type, version) do nothing;
