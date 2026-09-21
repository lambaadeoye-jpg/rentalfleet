-- Proactive Permission Gates + Debug Table Cleanup
--
-- Closes the remaining tables found during audit with no dedicated
-- permission gate (only generic tenant-membership access). Same
-- discipline already applied to location/policy_version/tenant_setting/
-- payment: reusing an existing permission where it conceptually fits,
-- rather than inventing a new one per table.
--
-- Three tables' guard functions are already fully generic (no table-
-- specific logic at all -- just `perform reject_without_permission(...)`)
-- so they attach directly to new tables with no new function needed:
--   guard_collect_payment()  -> deposit          (financial collection)
--   guard_manage_pricing()   -> payment_schedule  (payment terms/schedule)
--   guard_manage_fleet()     -> telematics_device, telematics_alert,
--                                toll_transaction, incident,
--                                maintenance_work_order
--     (guard_manage_fleet's vehicle-specific narrow exception only
--     triggers when tg_table_name = 'vehicle' -- confirmed this falls
--     through to a plain manage_fleet check for any other table, so
--     reusing it here doesn't risk resurrecting the earlier bug class)
--
-- Three new simple, generic guards for permission codes that only had
-- conditional/table-specific existing implementations:
--   guard_approve_driver_action()     -> screening
--   guard_start_rental_action()       -> signed_document
--   guard_authorize_recovery_action() -> recovery_assignment, vendor,
--                                         vendor_contact

create or replace function guard_approve_driver_action() returns trigger as $$
begin
  perform reject_without_permission('approve_driver');
  return coalesce(new, old);
end;
$$ language plpgsql set search_path = public;

create or replace function guard_start_rental_action() returns trigger as $$
begin
  perform reject_without_permission('start_rental');
  return coalesce(new, old);
end;
$$ language plpgsql set search_path = public;

create or replace function guard_authorize_recovery_action() returns trigger as $$
begin
  perform reject_without_permission('authorize_recovery');
  return coalesce(new, old);
end;
$$ language plpgsql set search_path = public;

drop trigger if exists deposit_collect_payment_guard on deposit;
create trigger deposit_collect_payment_guard
  before insert or update on deposit
  for each row execute function guard_collect_payment();

drop trigger if exists payment_schedule_pricing_guard on payment_schedule;
create trigger payment_schedule_pricing_guard
  before insert or update on payment_schedule
  for each row execute function guard_manage_pricing();

drop trigger if exists telematics_device_fleet_guard on telematics_device;
create trigger telematics_device_fleet_guard
  before insert or update on telematics_device
  for each row execute function guard_manage_fleet();

drop trigger if exists telematics_alert_fleet_guard on telematics_alert;
create trigger telematics_alert_fleet_guard
  before insert or update on telematics_alert
  for each row execute function guard_manage_fleet();

drop trigger if exists toll_transaction_fleet_guard on toll_transaction;
create trigger toll_transaction_fleet_guard
  before insert or update on toll_transaction
  for each row execute function guard_manage_fleet();

drop trigger if exists incident_fleet_guard on incident;
create trigger incident_fleet_guard
  before insert or update on incident
  for each row execute function guard_manage_fleet();

drop trigger if exists maintenance_work_order_fleet_guard on maintenance_work_order;
create trigger maintenance_work_order_fleet_guard
  before insert or update on maintenance_work_order
  for each row execute function guard_manage_fleet();

drop trigger if exists screening_approve_driver_guard on screening;
create trigger screening_approve_driver_guard
  before insert or update on screening
  for each row execute function guard_approve_driver_action();

drop trigger if exists signed_document_start_rental_guard on signed_document;
create trigger signed_document_start_rental_guard
  before insert or update on signed_document
  for each row execute function guard_start_rental_action();

drop trigger if exists recovery_assignment_authorize_guard on recovery_assignment;
create trigger recovery_assignment_authorize_guard
  before insert or update on recovery_assignment
  for each row execute function guard_authorize_recovery_action();

drop trigger if exists vendor_authorize_recovery_guard on vendor;
create trigger vendor_authorize_recovery_guard
  before insert or update on vendor
  for each row execute function guard_authorize_recovery_action();

drop trigger if exists vendor_contact_authorize_recovery_guard on vendor_contact;
create trigger vendor_contact_authorize_recovery_guard
  before insert or update on vendor_contact
  for each row execute function guard_authorize_recovery_action();

-- Leftover scratch table from early RLS setup/testing -- 2 rows, no
-- longer referenced anywhere in the app or migrations. Confirmed before
-- dropping, not assumed.
drop table if exists rls_debug_test;
