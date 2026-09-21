-- Fix guard_manage_fleet() + add location permission gate
--
-- Real bug found while adding a permission gate to `location` (which had
-- none at all, same gap pattern as policy_version and payment before it):
-- guard_manage_fleet() referenced old.status/new.status via direct dot
-- notation. That requires the column to structurally exist on WHATEVER
-- table the trigger is attached to -- location has no status column at
-- all, so any insert/update crashed outright with "record old has no
-- field status", regardless of the tg_table_name = 'vehicle' check,
-- because PL/pgSQL resolves field access against the row's actual type
-- before short-circuit evaluation can rescue an invalid reference.
--
-- This would have been a landmine for any future reuse of this function
-- on a non-vehicle table. Fixed with to_jsonb(...)->>'status', which
-- safely returns null for a missing field instead of failing to parse.
--
-- Verified live, 6 assertions: the location fix itself, PLUS a full
-- regression check that field_staff's narrow vehicle-transition
-- exception (0037) and admin's broad manage_fleet capability both still
-- work exactly as before.

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

  perform reject_without_permission('manage_fleet');
  return coalesce(new, old);
end;
$$ language plpgsql set search_path = public;

drop trigger if exists location_manage_fleet_guard on location;
create trigger location_manage_fleet_guard
  before insert or update on location
  for each row execute function guard_manage_fleet();
