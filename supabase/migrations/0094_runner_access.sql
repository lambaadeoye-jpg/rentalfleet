-- Field runner access.
--   1. A rental can be assigned to a runner, and runners only see their own.
--   2. A new permission, log_field_report, lets a runner log a damage/problem report or a toll/ticket
--      (inserts only) without getting the broad manage_fleet permission.
--   3. Runners no longer record payments: they only see whether the card was charged.
--
-- Safe to run more than once.

alter table rental add column if not exists assigned_runner_id uuid;
create index if not exists idx_rental_assigned_runner on rental (tenant_id, assigned_runner_id) where assigned_runner_id is not null;

insert into permission (code, description) values
  ('log_field_report', 'Log a vehicle problem report or a toll/ticket from the field (insert only)')
on conflict (code) do nothing;

insert into role_permission (tenant_id, role_id, permission_id)
select r.tenant_id, r.id, p.id
from role r cross join permission p
where r.name in ('admin', 'field_staff') and p.code = 'log_field_report'
on conflict do nothing;

-- Runners confirm that the card was charged; they do not record payments themselves.
delete from role_permission rp
using role r, permission p
where rp.role_id = r.id and rp.permission_id = p.id
  and r.name = 'field_staff' and p.code = 'collect_payment';

-- Same function as 0043, plus one narrow exception: INSERT (never update) on incident and toll_transaction.
create or replace function guard_manage_fleet() returns trigger as $$
declare
  v_old_status text;
  v_new_status text;
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
  end if;

  if tg_table_name in ('incident', 'toll_transaction') and tg_op = 'INSERT' then
    if app_has_permission('log_field_report') or app_has_permission('manage_fleet') then
      return coalesce(new, old);
    end if;
  end if;

  perform reject_without_permission('manage_fleet');
  return coalesce(new, old);
end;
$$ language plpgsql set search_path = public;
