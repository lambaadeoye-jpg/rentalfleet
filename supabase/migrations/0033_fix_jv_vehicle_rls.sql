-- Fix: RLS Disabled on jv_vehicle (Supabase Advisor CRITICAL finding)
-- jv_agreement and jv_distribution both correctly got RLS in earlier
-- migrations; this junction table (jv_agreement_id, vehicle_id -- no
-- tenant_id column of its own) was simply missed. Scoped via a join
-- through jv_agreement, which already has real tenant-isolation RLS.

alter table jv_vehicle enable row level security;
alter table jv_vehicle force row level security;

drop policy if exists tenant_isolation_select on jv_vehicle;
create policy tenant_isolation_select on jv_vehicle for select
  using (
    jv_agreement_id in (
      select id from jv_agreement where tenant_id in (select app_current_tenant_ids())
    )
  );

drop policy if exists tenant_isolation_write on jv_vehicle;
create policy tenant_isolation_write on jv_vehicle for insert
  with check (
    jv_agreement_id in (
      select id from jv_agreement where tenant_id in (select app_current_tenant_ids())
    )
  );

drop policy if exists tenant_isolation_delete on jv_vehicle;
create policy tenant_isolation_delete on jv_vehicle for delete
  using (
    jv_agreement_id in (
      select id from jv_agreement where tenant_id in (select app_current_tenant_ids())
    )
  );
