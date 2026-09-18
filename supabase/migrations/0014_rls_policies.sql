-- Row-Level Security: Tenant Isolation
-- Locked business rule (PRS v2.0 §2, Architecture v2.0 §14): "Multi-tenancy, RLS,
-- RBAC, auditability... are required from the start." This migration was entirely
-- absent from the original schema.sql — every table existed with a tenant_id column
-- but zero enforcement. Applying this before any application traffic is non-negotiable;
-- it is Acceptance Standard #1 (BUILD_MASTER_SPECIFICATION_v2.0.md §23).
--
-- Model: a signed-in staff/operator user's tenant memberships come from membership.user_id
-- = auth.uid(). A row is visible/writable only if its tenant_id is one of that user's
-- tenants. The Supabase service_role key bypasses RLS by design — that key must NEVER
-- reach browser/mobile code (rls_tenant_isolation_test.sql, test #6).
--
-- NOTE: this covers staff-side tenant isolation. Customer-portal-side isolation (a renter
-- seeing only their own rentals/payments/documents) needs a second policy layer once
-- customer authentication is wired up (customer.id <-> auth.uid()), which is not yet
-- modeled in schema.sql. Flagging as a Phase 1 gap to close before the customer portal ships.

create or replace function app_current_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from membership where user_id = auth.uid();
$$;

-- Apply RLS + a single tenant-isolation policy to every table with a tenant_id column.
-- Using a loop instead of 40+ hand-written near-duplicate policies so every table gets
-- the same rule, consistently, and any future table with a tenant_id column added to this
-- migration inherits it automatically on re-run.
do $$
declare
  t record;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'tenant_id'
      and tb.table_type = 'BASE TABLE'
  loop
    execute format('alter table %I enable row level security', t.table_name);
    execute format('alter table %I force row level security', t.table_name);

    execute format(
      'drop policy if exists tenant_isolation_select on %I', t.table_name);
    execute format(
      'create policy tenant_isolation_select on %I for select
         using (tenant_id in (select app_current_tenant_ids()))', t.table_name);

    execute format(
      'drop policy if exists tenant_isolation_write on %I', t.table_name);
    execute format(
      'create policy tenant_isolation_write on %I for insert
         with check (tenant_id in (select app_current_tenant_ids()))', t.table_name);

    execute format(
      'drop policy if exists tenant_isolation_update on %I', t.table_name);
    execute format(
      'create policy tenant_isolation_update on %I for update
         using (tenant_id in (select app_current_tenant_ids()))
         with check (tenant_id in (select app_current_tenant_ids()))', t.table_name);

    execute format(
      'drop policy if exists tenant_isolation_delete on %I', t.table_name);
    execute format(
      'create policy tenant_isolation_delete on %I for delete
         using (tenant_id in (select app_current_tenant_ids()))', t.table_name);
  end loop;
end $$;

-- tenant itself: a user can only see tenant rows they hold a membership in
-- (tenant has no tenant_id column, so the generic loop above skips it).
alter table tenant enable row level security;
alter table tenant force row level security;

drop policy if exists tenant_self_select on tenant;
create policy tenant_self_select on tenant for select
  using (id in (select app_current_tenant_ids()));

-- ---------------------------------------------------------------------------
-- PERMISSION-AWARE MUTATION POLICIES: NOT YET IMPLEMENTED.
-- Architecture v2.0 §4 requires "Postgres RLS + app RBAC" — the policies above give
-- tenant isolation only. Restricted actions (e.g. only 'admin' or 'finance' role can
-- issue a refund, only 'ops' can authorize recovery) still need a `permission` table
-- and role-aware policies layered on top. The current `role` table only stores a name
-- with no permission codes — this is a real gap against the locked business rules,
-- not a style choice. Recommend resolving before Phase 6 (Finance/Payments) ships.
-- ---------------------------------------------------------------------------
