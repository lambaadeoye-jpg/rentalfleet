-- Domain Integrity Enforcement
-- Several rules were LOCKED in the specs (BUILD_MASTER_SPECIFICATION_v2.0.md,
-- Architecture v2.0, Physical DB spec) but never actually enforced at the
-- database level -- the generic RLS policies from 0014 gave every tenant
-- member full INSERT/UPDATE/DELETE on every table, including ones that are
-- supposed to be append-only or immutable. This migration closes those gaps
-- before writing tests that check them (there was nothing correct to test
-- against yet).

-- ---------------------------------------------------------------------------
-- 1. NO OVERLAPPING RENTAL SEGMENTS ON THE SAME VEHICLE
-- Physical DB spec §4: "Use range/exclusion constraints or transactional
-- locking to prevent overlapping active/reserved assignments." Never added.
-- ---------------------------------------------------------------------------
create extension if not exists btree_gist;

alter table rental_segment drop constraint if exists rental_segment_no_overlap;
alter table rental_segment add constraint rental_segment_no_overlap
  exclude using gist (
    vehicle_id with =,
    tstzrange(starts_at, coalesce(ends_at, 'infinity'::timestamptz), '[)') with &&
  );

-- ---------------------------------------------------------------------------
-- 2. APPEND-ONLY / IMMUTABLE TABLES
-- Locked rules: "Ledger is append-only; corrections are reversals/
-- adjustments" (Physical DB §2), "Rental history cannot be destructively
-- overwritten" (domain_integrity_test.sql #2), "Agreement/policy versions
-- immutable after effective use" (Physical DB §5), audit trail integrity.
-- The 0014 generic RLS loop gave tenant members DELETE/UPDATE on all of
-- these -- fixing with triggers rather than relying on app code alone.
-- ---------------------------------------------------------------------------
create or replace function reject_mutation() returns trigger as $$
begin
  raise exception 'This table is append-only / immutable: % on % is not permitted (correct via a new row, not an edit)', tg_op, tg_table_name;
end;
$$ language plpgsql;

-- ledger_entry: no update or delete, ever. Corrections are new entries.
drop trigger if exists ledger_entry_no_mutation on ledger_entry;
create trigger ledger_entry_no_mutation
  before update or delete on ledger_entry
  for each row execute function reject_mutation();

-- audit_event: no update or delete, ever.
drop trigger if exists audit_event_no_mutation on audit_event;
create trigger audit_event_no_mutation
  before update or delete on audit_event
  for each row execute function reject_mutation();

-- rental_segment: no delete (swap/return history must be preserved).
-- UPDATE is still allowed (closing out ends_at / end_mileage on swap).
drop trigger if exists rental_segment_no_delete on rental_segment;
create trigger rental_segment_no_delete
  before delete on rental_segment
  for each row execute function reject_mutation();

-- policy_version: once immutable = true, no update or delete.
create or replace function reject_if_immutable() returns trigger as $$
begin
  if old.immutable then
    raise exception 'policy_version % is marked immutable and cannot be changed or removed', old.id;
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists policy_version_immutable_guard on policy_version;
create trigger policy_version_immutable_guard
  before update or delete on policy_version
  for each row execute function reject_if_immutable();

-- document_version: add the same immutable flag policy_version already had
-- (PRS treats these two the same way -- "exact agreement version preserved"
-- -- but only policy_version got the column originally).
alter table document_version add column if not exists immutable boolean not null default false;

drop trigger if exists document_version_immutable_guard on document_version;
create trigger document_version_immutable_guard
  before update or delete on document_version
  for each row execute function reject_if_immutable();

-- ---------------------------------------------------------------------------
-- 3. STATE TRANSITION VALIDATION
-- Architecture v2.0 §13 locks exact state machines for rental and vehicle.
-- 0016 added CHECK constraints for valid VALUES; this adds valid
-- TRANSITIONS (Acceptance Standard #3: "State transitions are explicit").
-- Data-driven via a reference table rather than hardcoded CASE logic, so
-- adding a transition later is a data change, not a migration.
-- ---------------------------------------------------------------------------
create table if not exists allowed_status_transition (
  table_name text not null,
  from_status text not null,
  to_status text not null,
  primary key (table_name, from_status, to_status)
);

alter table allowed_status_transition enable row level security;
drop policy if exists allowed_status_transition_read_all on allowed_status_transition;
create policy allowed_status_transition_read_all on allowed_status_transition for select
  using (auth.role() = 'authenticated');

insert into allowed_status_transition (table_name, from_status, to_status) values
  -- rental (Architecture v2.0 §13)
  ('rental','pending','approved'), ('rental','pending','cancelled'),
  ('rental','approved','scheduled'), ('rental','approved','cancelled'),
  ('rental','scheduled','active'), ('rental','scheduled','cancelled'),
  ('rental','active','extended'), ('rental','active','return_pending'),
  ('rental','active','suspended'), ('rental','active','delinquent'),
  ('rental','active','recovery'), ('rental','active','terminated'),
  ('rental','extended','return_pending'), ('rental','extended','suspended'),
  ('rental','extended','delinquent'), ('rental','extended','recovery'),
  ('rental','extended','terminated'),
  ('rental','return_pending','returned'),
  ('rental','returned','closed'),
  ('rental','suspended','active'), ('rental','suspended','terminated'),
  ('rental','suspended','recovery'),
  ('rental','delinquent','active'), ('rental','delinquent','recovery'),
  ('rental','delinquent','terminated'),
  ('rental','recovery','closed'), ('rental','recovery','terminated'),
  ('rental','terminated','closed'),
  -- vehicle (Architecture v2.0 §13)
  ('vehicle','acquired','inspection'),
  ('vehicle','inspection','ready'), ('vehicle','inspection','damaged'),
  ('vehicle','ready','available'),
  ('vehicle','available','reserved'), ('vehicle','available','maintenance'),
  ('vehicle','available','damaged'), ('vehicle','available','decommissioned'),
  ('vehicle','reserved','rented'), ('vehicle','reserved','available'),
  ('vehicle','rented','available'), ('vehicle','rented','maintenance'),
  ('vehicle','rented','damaged'), ('vehicle','rented','accident'),
  ('vehicle','rented','recovery'),
  ('vehicle','maintenance','available'), ('vehicle','maintenance','decommissioned'),
  ('vehicle','damaged','maintenance'), ('vehicle','damaged','decommissioned'),
  ('vehicle','damaged','impounded'),
  ('vehicle','accident','maintenance'), ('vehicle','accident','recovery'),
  ('vehicle','accident','impounded'), ('vehicle','accident','decommissioned'),
  ('vehicle','recovery','available'), ('vehicle','recovery','impounded'),
  ('vehicle','recovery','decommissioned'),
  ('vehicle','impounded','available'), ('vehicle','impounded','decommissioned'),
  ('vehicle','decommissioned','sold')
on conflict do nothing;

create or replace function enforce_status_transition() returns trigger as $$
begin
  if new.status is distinct from old.status then
    if not exists (
      select 1 from allowed_status_transition
      where table_name = tg_table_name
        and from_status = old.status
        and to_status = new.status
    ) then
      raise exception 'Invalid % transition: % -> % is not an allowed state transition', tg_table_name, old.status, new.status;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists rental_status_transition on rental;
create trigger rental_status_transition
  before update on rental
  for each row execute function enforce_status_transition();

drop trigger if exists vehicle_status_transition on vehicle;
create trigger vehicle_status_transition
  before update on vehicle
  for each row execute function enforce_status_transition();

-- ---------------------------------------------------------------------------
-- 4. RECOVERY EXPENSES CANNOT BECOME RENTER CHARGES WITHOUT APPROVAL
-- Locked rule (PRS §12, Physical DB §2): "Recovery expense has approval/
-- responsibility state; no automatic renter charge." Nothing in the schema
-- actually LINKED recovery_expense to charge, so there was nothing to
-- enforce. Adding the link plus the enforcement together.
-- ---------------------------------------------------------------------------
alter table charge add column if not exists source_recovery_expense_id uuid references recovery_expense(id);

create or replace function enforce_recovery_expense_approval() returns trigger as $$
declare
  expense_status text;
begin
  if new.source_recovery_expense_id is not null then
    select approval_status into expense_status
    from recovery_expense where id = new.source_recovery_expense_id;

    if expense_status is distinct from 'approved' then
      raise exception 'Cannot create a charge from recovery_expense % until its approval_status is approved (currently: %)',
        new.source_recovery_expense_id, expense_status;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists charge_recovery_expense_approval_guard on charge;
create trigger charge_recovery_expense_approval_guard
  before insert or update on charge
  for each row execute function enforce_recovery_expense_approval();
