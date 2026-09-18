-- Permission-Gated Action Enforcement
-- Closes the gap flagged repeatedly since 0014/0016: role_permission can
-- represent "this role lacks this permission," but nothing checked it.
-- This adds the actual checks, as triggers on the specific gated actions
-- named in the locked specs (Architecture v2.0 §7's button list, and the
-- human-approval requirements in PRS/Physical DB for recovery/charges).
--
-- DESIGN: enforcement only applies when the acting Postgres role is literally
-- 'authenticated' -- i.e. real application traffic through PostgREST/Supabase
-- client, or a test impersonating a user via SET LOCAL ROLE authenticated
-- (see tests/rls_tenant_isolation_test.sql). Direct superuser/service-role
-- access (migrations, seed scripts, CI test fixtures written as plain SQL)
-- is treated as trusted infrastructure and is NOT gated -- this mirrors how
-- Supabase's service_role already bypasses RLS by convention, and is why
-- none of the existing test fixtures needed to change to keep passing.
--
-- SCOPE: 7 gates covering the core "restricted staff action" surface --
-- approve_driver, assign_vehicle, approve_charge, authorize_recovery,
-- approve_recovery_expense, manage_fleet, manage_users_roles. Left for later
-- (flagged, not silently skipped): collect_payment, issue_refund (no
-- dedicated refund table exists yet), manage_pricing_policy, view_reports
-- (no reports feature exists yet to gate), start_rental/close_rental/
-- swap_vehicle as their own distinct gates rather than folded into
-- assign_vehicle.

create or replace function app_has_permission(perm_code text) returns boolean as $$
declare
  has_perm boolean;
  uid uuid;
begin
  -- NOTE: this checks auth.uid() directly rather than current_user, because
  -- this function is SECURITY DEFINER -- inside a SECURITY DEFINER function,
  -- current_user reflects the FUNCTION OWNER, not the original caller, so a
  -- naive "current_user <> 'authenticated'" check here would always see the
  -- owner and always return true, silently defeating the entire gate. Caught
  -- this the hard way: it shipped once, immediately failed its own test, and
  -- was fixed within the same session (see the real, verified fix below).
  uid := auth.uid();
  if uid is null then
    return true; -- no identified user in this session context (migrations,
                 -- seed scripts, CI fixtures, service_role calls with no
                 -- impersonated user) -- trusted, not gated
  end if;

  select exists (
    select 1
    from membership m
    join role_permission rp on rp.role_id = m.role_id and rp.tenant_id = m.tenant_id
    join permission p on p.id = rp.permission_id
    where m.user_id = uid
      and p.code = perm_code
  ) into has_perm;

  return coalesce(has_perm, false);
end;
$$ language plpgsql stable security definer set search_path = public;

create or replace function reject_without_permission(perm_code text) returns void as $$
begin
  if not app_has_permission(perm_code) then
    raise exception 'Permission denied: this action requires the "%" permission', perm_code;
  end if;
end;
$$ language plpgsql;

-- 1. approve_driver -- application decisions
create or replace function guard_application_decision() returns trigger as $$
begin
  if new.status is distinct from old.status
     and new.status in ('approved','conditionally_approved','declined') then
    perform reject_without_permission('approve_driver');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists application_decision_permission_guard on application;
create trigger application_decision_permission_guard
  before update on application
  for each row execute function guard_application_decision();

-- 2. assign_vehicle -- creating a rental_segment (the actual assignment act)
create or replace function guard_vehicle_assignment() returns trigger as $$
begin
  perform reject_without_permission('assign_vehicle');
  return new;
end;
$$ language plpgsql;

drop trigger if exists rental_segment_permission_guard on rental_segment;
create trigger rental_segment_permission_guard
  before insert on rental_segment
  for each row execute function guard_vehicle_assignment();

-- 3. approve_charge
create or replace function guard_charge_approval() returns trigger as $$
begin
  if new.approval_status is distinct from old.approval_status
     and new.approval_status = 'approved' then
    perform reject_without_permission('approve_charge');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists charge_approval_permission_guard on charge;
create trigger charge_approval_permission_guard
  before update on charge
  for each row execute function guard_charge_approval();

-- 4. authorize_recovery
create or replace function guard_recovery_authorization() returns trigger as $$
begin
  if new.authorized_at is not null
     and (tg_op = 'INSERT' or new.authorized_at is distinct from old.authorized_at) then
    perform reject_without_permission('authorize_recovery');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists recovery_case_authorization_guard on recovery_case;
create trigger recovery_case_authorization_guard
  before insert or update on recovery_case
  for each row execute function guard_recovery_authorization();

-- 5. approve_recovery_expense
create or replace function guard_recovery_expense_approval() returns trigger as $$
begin
  if new.approval_status is distinct from old.approval_status
     and new.approval_status = 'approved' then
    perform reject_without_permission('approve_recovery_expense');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists recovery_expense_approval_permission_guard on recovery_expense;
create trigger recovery_expense_approval_permission_guard
  before update on recovery_expense
  for each row execute function guard_recovery_expense_approval();

-- 6. manage_fleet -- vehicle and vehicle_category mutations
create or replace function guard_manage_fleet() returns trigger as $$
begin
  perform reject_without_permission('manage_fleet');
  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists vehicle_manage_fleet_guard on vehicle;
create trigger vehicle_manage_fleet_guard
  before insert or update or delete on vehicle
  for each row execute function guard_manage_fleet();

drop trigger if exists vehicle_category_manage_fleet_guard on vehicle_category;
create trigger vehicle_category_manage_fleet_guard
  before insert or update or delete on vehicle_category
  for each row execute function guard_manage_fleet();

-- 7. manage_users_roles -- role/membership/role_permission mutations
create or replace function guard_manage_users_roles() returns trigger as $$
begin
  perform reject_without_permission('manage_users_roles');
  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists role_manage_users_roles_guard on role;
create trigger role_manage_users_roles_guard
  before insert or update or delete on role
  for each row execute function guard_manage_users_roles();

drop trigger if exists membership_manage_users_roles_guard on membership;
create trigger membership_manage_users_roles_guard
  before insert or update or delete on membership
  for each row execute function guard_manage_users_roles();

drop trigger if exists role_permission_manage_users_roles_guard on role_permission;
create trigger role_permission_manage_users_roles_guard
  before insert or update or delete on role_permission
  for each row execute function guard_manage_users_roles();
