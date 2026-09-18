-- Customer-Side Authentication + Portal RLS
-- Closes the gap flagged in 0014's header comment and hit directly by
-- rls_tenant_isolation_test.sql Test 3 ("customer cannot access another
-- customer") -- there was previously no way for a customer to authenticate
-- at all, so nothing to test or build a portal against.
--
-- Design: customers authenticate through the SAME Supabase Auth users table
-- staff do (one auth backend, two separate applications/RLS paths). A
-- customer's `auth.users` row is linked via a new `customer.auth_user_id`
-- column. Staff access (via `membership`) and customer self-access (via this
-- link) are separate, independently-evaluated RLS policies -- Postgres OR's
-- multiple permissive policies together, so adding these does not touch or
-- weaken the existing staff tenant-isolation policies from 0014 at all.
--
-- Scope: covers the entities named in Architecture v2.0 §6's customer portal
-- IA (Dashboard, Application, Rental, Vehicle, Payments, Documents,
-- Agreement, Drivers, Insurance, Requests, Support, Profile). Deliberately
-- EXCLUDES `screening` -- raw screening/consumer-report data needs a
-- compliant adverse-action disclosure flow, not a direct table read, and
-- that's a separate piece of work, not a table grant.

-- ---------------------------------------------------------------------------
-- 1. LINK CUSTOMER <-> AUTH USER
-- ---------------------------------------------------------------------------
alter table customer add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;
create index if not exists idx_customer_auth_user on customer(auth_user_id);

create or replace function app_current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from customer where auth_user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 2. CUSTOMER SELF-ACCESS POLICIES
-- All read-only except where explicitly noted (profile edit, support intake).
-- Staff/tenant policies from 0014 are untouched -- these are additive.
-- ---------------------------------------------------------------------------

-- customer: see and edit own profile only
drop policy if exists customer_self_select on customer;
create policy customer_self_select on customer for select
  using (auth_user_id = auth.uid());

drop policy if exists customer_self_update on customer;
create policy customer_self_update on customer for update
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- application: view own application (including decision_reason -- adverse
-- action compliance requires the applicant be able to see why, not just
-- staff)
drop policy if exists customer_self_select on application;
create policy customer_self_select on application for select
  using (customer_id = app_current_customer_id());

-- rental
drop policy if exists customer_self_select on rental;
create policy customer_self_select on rental for select
  using (customer_id = app_current_customer_id());

-- rental_segment (via rental) -- lets the portal show current/past vehicle
drop policy if exists customer_self_select on rental_segment;
create policy customer_self_select on rental_segment for select
  using (rental_id in (select id from rental where customer_id = app_current_customer_id()));

-- vehicle (only the one(s) actually assigned to their rental(s) -- not the
-- whole fleet)
drop policy if exists customer_self_select on vehicle;
create policy customer_self_select on vehicle for select
  using (id in (
    select vehicle_id from rental_segment
    where rental_id in (select id from rental where customer_id = app_current_customer_id())
  ));

-- booking
drop policy if exists customer_self_select on booking;
create policy customer_self_select on booking for select
  using (customer_id = app_current_customer_id());

-- payments / deposits / charges / schedules
drop policy if exists customer_self_select on payment;
create policy customer_self_select on payment for select
  using (customer_id = app_current_customer_id());

drop policy if exists customer_self_select on payment_schedule;
create policy customer_self_select on payment_schedule for select
  using (rental_id in (select id from rental where customer_id = app_current_customer_id()));

drop policy if exists customer_self_select on deposit;
create policy customer_self_select on deposit for select
  using (rental_id in (select id from rental where customer_id = app_current_customer_id()));

drop policy if exists customer_self_select on charge;
create policy customer_self_select on charge for select
  using (customer_id = app_current_customer_id());

-- documents / agreements
drop policy if exists customer_self_select on customer_document;
create policy customer_self_select on customer_document for select
  using (customer_id = app_current_customer_id());

drop policy if exists customer_self_select on signed_document;
create policy customer_self_select on signed_document for select
  using (
    signer_customer_id = app_current_customer_id()
    or rental_id in (select id from rental where customer_id = app_current_customer_id())
  );

-- authorized drivers
drop policy if exists customer_self_select on authorized_driver;
create policy customer_self_select on authorized_driver for select
  using (customer_id = app_current_customer_id());

-- insurance
drop policy if exists customer_self_select on insurance_policy;
create policy customer_self_select on insurance_policy for select
  using (customer_id = app_current_customer_id());

-- gig platform self-report / eligibility (from migration 0017)
drop policy if exists customer_self_select on platform_eligibility;
create policy customer_self_select on platform_eligibility for select
  using (customer_id = app_current_customer_id());

-- support: customers can view AND create their own tickets/messages
-- (locked rule: "Customer support is initiated through the customer portal")
drop policy if exists customer_self_select on support_ticket;
create policy customer_self_select on support_ticket for select
  using (customer_id = app_current_customer_id());

drop policy if exists customer_self_insert on support_ticket;
create policy customer_self_insert on support_ticket for insert
  with check (customer_id = app_current_customer_id());

drop policy if exists customer_self_select on communication_event;
create policy customer_self_select on communication_event for select
  using (customer_id = app_current_customer_id());

drop policy if exists customer_self_insert on communication_event;
create policy customer_self_insert on communication_event for insert
  with check (customer_id = app_current_customer_id());
