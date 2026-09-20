-- Field Staff Permissions: Pickup/Dropoff Confirmation + Payment Recording
--
-- Real design problem this closes: the person physically handing over keys
-- may be a different, more junior person than whoever manages applications
-- and fleet status. The existing startRental() required start_rental,
-- assign_vehicle, AND manage_fleet all at once -- three office-level
-- permissions -- because it does office decision-making (which car, is it
-- ready) and physical handover (keys in hand right now) as one indivisible
-- action. Splitting these means a compromised field-staff login can only
-- ever "mark a pre-approved handover complete," never create rentals,
-- pick vehicles, or manage fleet inventory broadly.
--
-- guard_rental_start() (0028) already correctly gates the ONLY valid path
-- to 'active' (scheduled -> active) requiring start_rental -- no new
-- trigger needed there, just granting that existing permission to the new
-- narrow role.
--
-- guard_manage_fleet() (0021) gates ALL vehicle mutations uniformly. Field
-- staff flipping a vehicle reserved->rented or rented->available as part
-- of a pickup/dropoff they're narrowly authorized to confirm should NOT
-- require the broad manage_fleet permission (arbitrary fleet edits,
-- adding vehicles) -- that would make "narrow role" a fiction. Carving out
-- exactly those two transitions as satisfiable by confirm_pickup/
-- confirm_dropoff as an alternative to manage_fleet; every other vehicle
-- mutation still strictly requires manage_fleet, unchanged.
--
-- collect_payment closes a gap explicitly flagged as deferred in migration
-- 0021's own header comment ("Left for later... collect_payment, issue_
-- refund... not silently skipped") -- same discipline as closing
-- start_rental earlier: build the feature, close the gate at the same
-- time, don't defer it again.

-- ---------------------------------------------------------------------------
-- 1. NEW ROLE
-- ---------------------------------------------------------------------------
insert into role (tenant_id, name)
select id, 'field_staff' from tenant where slug = 'fleet-rental-pilot'
on conflict (tenant_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- 2. NEW PERMISSIONS
-- ---------------------------------------------------------------------------
insert into permission (code, description) values
  ('confirm_pickup', 'Confirm a scheduled rental''s vehicle handover (physical pickup)'),
  ('confirm_dropoff', 'Confirm a rental''s vehicle return (physical dropoff)'),
  ('collect_payment', 'Record a manually-collected payment (cash, Venmo, etc.)')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. GRANTS -- admin gets everything (office staff can always do field
-- work themselves, per explicit requirement); field_staff gets only the
-- narrow set needed for physical handover, nothing fleet/application/
-- approval-related.
-- ---------------------------------------------------------------------------
insert into role_permission (tenant_id, role_id, permission_id)
select r.tenant_id, r.id, p.id
from role r cross join permission p
where r.name = 'admin'
  and p.code in ('confirm_pickup', 'confirm_dropoff', 'collect_payment')
on conflict do nothing;

insert into role_permission (tenant_id, role_id, permission_id)
select r.tenant_id, r.id, p.id
from role r cross join permission p
where r.name = 'field_staff'
  and p.code in ('start_rental', 'confirm_pickup', 'confirm_dropoff', 'collect_payment')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. NARROW EXCEPTION on guard_manage_fleet()
-- Only the two specific pickup/dropoff transitions accept
-- confirm_pickup/confirm_dropoff as an alternative to manage_fleet.
-- Everything else -- adding vehicles, any other status change, editing
-- vehicle_category -- is completely unaffected and still requires
-- manage_fleet exactly as before.
-- ---------------------------------------------------------------------------
create or replace function guard_manage_fleet() returns trigger as $$
begin
  if tg_table_name = 'vehicle'
     and tg_op = 'UPDATE'
     and old.status is distinct from new.status
     and old.status = 'reserved' and new.status = 'rented'
  then
    if app_has_permission('confirm_pickup') or app_has_permission('manage_fleet') then
      return coalesce(new, old);
    end if;
    perform reject_without_permission('manage_fleet');
  end if;

  if tg_table_name = 'vehicle'
     and tg_op = 'UPDATE'
     and old.status is distinct from new.status
     and old.status = 'rented' and new.status = 'available'
  then
    if app_has_permission('confirm_dropoff') or app_has_permission('manage_fleet') then
      return coalesce(new, old);
    end if;
    perform reject_without_permission('manage_fleet');
  end if;

  perform reject_without_permission('manage_fleet');
  return coalesce(new, old);
end;
$$ language plpgsql set search_path = public;

-- ---------------------------------------------------------------------------
-- 5. PAYMENT RECORDING PERMISSION GATE (new -- payment had no guard at all)
-- ---------------------------------------------------------------------------
create or replace function guard_collect_payment() returns trigger as $$
begin
  perform reject_without_permission('collect_payment');
  return coalesce(new, old);
end;
$$ language plpgsql set search_path = public;

drop trigger if exists payment_collect_permission_guard on payment;
create trigger payment_collect_permission_guard
  before insert on payment
  for each row execute function guard_collect_payment();
