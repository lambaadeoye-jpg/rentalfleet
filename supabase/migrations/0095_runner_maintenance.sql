-- Runner maintenance.
-- A runner can start a maintenance job on an available car, attach receipts, and finish it.
-- Finishing at or under the spending limit frees the car; over the limit it waits for an admin to approve.
-- Who did the work (runner or a shop) and who pays (company pays the shop, runner is reimbursed, company card) are recorded.
--
-- Safe to run more than once. Requires 0094 (it replaces the guard function defined there).

alter table maintenance_work_order
  add column if not exists created_by_user_id uuid,
  add column if not exists assigned_runner_id uuid,
  add column if not exists performed_by text,
  add column if not exists shop_name text,
  add column if not exists payment_arrangement text,
  add column if not exists receipt_keys text[] not null default '{}',
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists settled_at timestamptz;

alter table maintenance_work_order drop constraint if exists maintenance_work_order_performed_by_check;
alter table maintenance_work_order add constraint maintenance_work_order_performed_by_check
  check (performed_by is null or performed_by in ('runner', 'shop'));
alter table maintenance_work_order drop constraint if exists maintenance_work_order_payment_check;
alter table maintenance_work_order add constraint maintenance_work_order_payment_check
  check (payment_arrangement is null or payment_arrangement in ('company_pays_shop', 'runner_reimburse', 'company_card'));

create index if not exists idx_mwo_vehicle_status on maintenance_work_order (vehicle_id, status);
create index if not exists idx_mwo_runner on maintenance_work_order (tenant_id, created_by_user_id, assigned_runner_id);

insert into permission (code, description) values
  ('log_maintenance', 'Start and finish maintenance jobs from the field (within the spending limit)')
on conflict (code) do nothing;

insert into role_permission (tenant_id, role_id, permission_id)
select r.tenant_id, r.id, p.id
from role r cross join permission p
where r.name in ('admin', 'field_staff') and p.code = 'log_maintenance'
on conflict do nothing;

-- Receipts bucket: same tenant-folder rule as inspection photos.
insert into storage.buckets (id, name, public) values ('maintenance-receipts', 'maintenance-receipts', false)
on conflict (id) do nothing;

drop policy if exists staff_tenant_maintenance_receipts_select on storage.objects;
create policy staff_tenant_maintenance_receipts_select on storage.objects for select
  to authenticated
  using (bucket_id = 'maintenance-receipts' and (storage.foldername(name))[1] in (select app_current_tenant_ids()::text));

drop policy if exists staff_tenant_maintenance_receipts_insert on storage.objects;
create policy staff_tenant_maintenance_receipts_insert on storage.objects for insert
  to authenticated
  with check (bucket_id = 'maintenance-receipts' and (storage.foldername(name))[1] in (select app_current_tenant_ids()::text));

-- Spending limit a runner can finish a job under on their own (admin can change it in Maintenance).
create or replace function maintenance_approval_limit(p_tenant uuid) returns numeric as $$
  select coalesce(
    (select case when value ~ '^[0-9]+(\.[0-9]+)?$' then value::numeric end
       from tenant_setting where tenant_id = p_tenant and key = 'maintenance_approval_limit_usd'),
    150);
$$ language sql stable security definer set search_path = public;

-- guard_manage_fleet: 0094 version plus runner rules for maintenance_work_order and two vehicle moves.
create or replace function guard_manage_fleet() returns trigger as $$
declare
  v_old_status text;
  v_new_status text;
  v_uid uuid := auth.uid();
begin
  if tg_table_name = 'vehicle' and tg_op = 'UPDATE' then
    v_old_status := to_jsonb(old) ->> 'status';
    v_new_status := to_jsonb(new) ->> 'status';

    if v_old_status is distinct from v_new_status and v_old_status = 'reserved' and v_new_status = 'rented' then
      if app_has_permission('confirm_pickup') or app_has_permission('manage_fleet') then
        return coalesce(new, old);
      end if;
      perform reject_without_permission('manage_fleet');
    end if;

    if v_old_status is distinct from v_new_status and v_old_status = 'rented' and v_new_status = 'available' then
      if app_has_permission('confirm_dropoff') or app_has_permission('manage_fleet') then
        return coalesce(new, old);
      end if;
      perform reject_without_permission('manage_fleet');
    end if;

    -- A runner can take an available car out of service only while a job is open for it...
    if v_old_status = 'available' and v_new_status = 'maintenance' then
      if app_has_permission('manage_fleet') then
        return coalesce(new, old);
      end if;
      if app_has_permission('log_maintenance')
         and exists (select 1 from maintenance_work_order w where w.vehicle_id = old.id and w.status = 'open') then
        return coalesce(new, old);
      end if;
      perform reject_without_permission('manage_fleet');
    end if;

    -- ...and put it back only once no job is still open or waiting for approval.
    if v_old_status = 'maintenance' and v_new_status = 'available' then
      if app_has_permission('manage_fleet') then
        return coalesce(new, old);
      end if;
      if app_has_permission('log_maintenance')
         and not exists (select 1 from maintenance_work_order w where w.vehicle_id = old.id and w.status in ('open', 'pending_approval')) then
        return coalesce(new, old);
      end if;
      perform reject_without_permission('manage_fleet');
    end if;
  end if;

  if tg_table_name in ('incident', 'toll_transaction') and tg_op = 'INSERT' then
    if app_has_permission('log_field_report') or app_has_permission('manage_fleet') then
      return coalesce(new, old);
    end if;
  end if;

  if tg_table_name = 'maintenance_work_order' then
    if app_has_permission('manage_fleet') then
      return coalesce(new, old);
    end if;
    if app_has_permission('log_maintenance') then
      if tg_op = 'INSERT' then
        -- Only on a car that is available right now: never one that is rented or reserved.
        if new.status = 'open' and new.created_by_user_id = v_uid
           and new.approved_at is null and new.approved_by is null and new.settled_at is null
           and exists (select 1 from vehicle v where v.id = new.vehicle_id and v.tenant_id = new.tenant_id and v.status = 'available') then
          return new;
        end if;
      elsif tg_op = 'UPDATE' then
        -- Own or assigned job, still open; identity, approval and payment-settled fields can't be touched;
        -- finishing outright is only allowed at or under the spending limit.
        if old.status = 'open'
           and (old.created_by_user_id = v_uid or old.assigned_runner_id = v_uid)
           and new.status in ('open', 'pending_approval', 'completed')
           and new.vehicle_id = old.vehicle_id
           and new.tenant_id = old.tenant_id
           and new.created_by_user_id is not distinct from old.created_by_user_id
           and new.assigned_runner_id is not distinct from old.assigned_runner_id
           and new.approved_at is not distinct from old.approved_at
           and new.approved_by is not distinct from old.approved_by
           and new.settled_at is not distinct from old.settled_at
           and (new.status <> 'completed' or (new.cost is not null and new.cost <= maintenance_approval_limit(new.tenant_id))) then
          return new;
        end if;
      end if;
    end if;
  end if;

  perform reject_without_permission('manage_fleet');
  return coalesce(new, old);
end;
$$ language plpgsql set search_path = public;
