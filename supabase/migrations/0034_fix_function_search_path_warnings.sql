-- Fix: Function Search Path Mutable (Supabase Advisor WARN finding, 16
-- functions). Pure hardening -- ALTER FUNCTION ... SET search_path
-- changes nothing about behavior, grants, or return values; it just pins
-- the schema resolution order so a malicious schema earlier in a caller's
-- search_path can't shadow expected tables/functions. Safe to apply
-- broadly since it's non-behavioral.

alter function reject_mutation() set search_path = public;
alter function reject_if_immutable() set search_path = public;
alter function reject_without_permission(text) set search_path = public;
alter function enforce_recovery_expense_approval() set search_path = public;
alter function guard_application_decision() set search_path = public;
alter function guard_vehicle_assignment() set search_path = public;
alter function guard_charge_approval() set search_path = public;
alter function guard_recovery_authorization() set search_path = public;
alter function guard_recovery_expense_approval() set search_path = public;
alter function guard_manage_fleet() set search_path = public;
alter function guard_manage_users_roles() set search_path = public;
alter function guard_insurance_verification() set search_path = public;
alter function guard_rental_start() set search_path = public;

alter function test.assert(boolean, text) set search_path = public;
alter function test.assert_raises(text, text) set search_path = public;
alter function test.assert_row_count(text, integer, text) set search_path = public;
