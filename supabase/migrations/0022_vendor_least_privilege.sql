-- Recovery Vendor Least-Privilege Access
-- Closes the last open RLS test gap (Test 4). Locked rules: "Vendor access
-- is least-privilege" (Physical DB §3), "Recovery vendors only assigned
-- cases/minimum fields" (Physical DB §2), "vendor sees only assigned case
-- fields" (rls_tenant_isolation_test.sql). Also closes a prerequisite gap:
-- there was no `vendor` entity at all -- recovery_assignment.vendor_name
-- was a free-text field with no way for a vendor to even authenticate.
--
-- WHY THIS ISN'T JUST ANOTHER RLS POLICY: RLS is row-level, not column-level.
-- A row-level policy granting vendors access to recovery_case would let them
-- see every column on their assigned row -- including balance_due,
-- authorization_reason, and customer_id -- which is exactly what "minimum
-- fields" rules out. Postgres has no per-role column visibility that varies
-- by RLS policy, and Supabase gives every logged-in user the same
-- 'authenticated' Postgres role regardless of whether they're staff, a
-- customer, or a vendor -- so column-level GRANT/REVOKE can't distinguish
-- them either.
--
-- THE FIX: vendors get NO row-level RLS access to recovery_case, vehicle, or
-- customer at all -- querying those tables directly always returns 0 rows
-- for a vendor, by design. The only access path is a SECURITY DEFINER
-- function that internally verifies the assignment and returns a
-- hand-picked minimum column set. This is the same trusted-boundary pattern
-- already used for app_current_tenant_ids() and app_current_customer_id(),
-- and it's also what the Physical DB spec's §3 line "Views use safe
-- security-invoker patterns where needed" is pointing at -- the safe
-- pattern here is a definer-side function, not a wide-open invoker view.

-- ---------------------------------------------------------------------------
-- 1. VENDOR + VENDOR CONTACT (a vendor's logged-in staff)
-- ---------------------------------------------------------------------------
create table if not exists vendor (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table vendor enable row level security;
alter table vendor force row level security;
drop policy if exists tenant_isolation_select on vendor;
create policy tenant_isolation_select on vendor for select
  using (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_write on vendor;
create policy tenant_isolation_write on vendor for insert
  with check (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_update on vendor;
create policy tenant_isolation_update on vendor for update
  using (tenant_id in (select app_current_tenant_ids()))
  with check (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_delete on vendor;
create policy tenant_isolation_delete on vendor for delete
  using (tenant_id in (select app_current_tenant_ids()));

create table if not exists vendor_contact (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  vendor_id uuid not null references vendor(id),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  email citext,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table vendor_contact enable row level security;
alter table vendor_contact force row level security;
-- Staff (tenant members) can manage vendor contacts
drop policy if exists tenant_isolation_select on vendor_contact;
create policy tenant_isolation_select on vendor_contact for select
  using (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_write on vendor_contact;
create policy tenant_isolation_write on vendor_contact for insert
  with check (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_update on vendor_contact;
create policy tenant_isolation_update on vendor_contact for update
  using (tenant_id in (select app_current_tenant_ids()))
  with check (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_delete on vendor_contact;
create policy tenant_isolation_delete on vendor_contact for delete
  using (tenant_id in (select app_current_tenant_ids()));
-- A vendor contact can see their own record only (e.g. to render "logged in
-- as X at Vendor Y" in a vendor-facing UI) -- nothing else about the tenant.
drop policy if exists vendor_self_select on vendor_contact;
create policy vendor_self_select on vendor_contact for select
  using (auth_user_id = auth.uid());

-- Link recovery_assignment to a real vendor entity. vendor_name (free text)
-- stays for display/backward-compat; vendor_id is the authoritative link.
alter table recovery_assignment add column if not exists vendor_id uuid references vendor(id);

create or replace function app_current_vendor_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select vendor_id from vendor_contact where auth_user_id = auth.uid() and active;
$$;

-- ---------------------------------------------------------------------------
-- 2. THE ACTUAL LEAST-PRIVILEGE ACCESS PATH
-- Deliberately NOT a policy on recovery_case/vehicle/customer -- vendors get
-- zero direct RLS access to those tables. This function is the only door,
-- and it only returns what a tow/recovery vendor actually needs to do the
-- physical job: which vehicle, roughly where, case status, and their
-- assignment details. No customer identity, no balance_due, no internal
-- authorization notes.
-- ---------------------------------------------------------------------------
create or replace function vendor_visible_recovery_cases()
returns table (
  recovery_case_id uuid,
  case_status text,
  days_delinquent integer,
  last_known_location jsonb,
  case_created_at timestamptz,
  vehicle_vin text,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_plate text,
  assignment_id uuid,
  assignment_type text,
  assignment_status text,
  assigned_at timestamptz,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rc.id, rc.status, rc.days_delinquent, rc.last_known_location, rc.created_at,
    v.vin, v.make, v.model, v.year, v.plate,
    ra.id, ra.assignment_type, ra.status, ra.assigned_at, ra.completed_at
  from recovery_assignment ra
  join recovery_case rc on rc.id = ra.recovery_case_id
  join vehicle v on v.id = rc.vehicle_id
  where ra.vendor_id in (select app_current_vendor_ids());
$$;

grant execute on function vendor_visible_recovery_cases() to authenticated;
