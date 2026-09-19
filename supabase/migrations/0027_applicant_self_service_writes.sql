-- Applicant Self-Service Write Access
-- Migration 0020 gave customers/applicants READ access to their own rows
-- across the portal-relevant tables, explicitly scoped as "read-only except
-- where noted." Building the actual Application Workspace surfaced the real
-- gap: an applicant can't insert their OWN initial customer row, can't
-- create/update their OWN application, and can't write authorized_driver,
-- customer_document, platform_eligibility, or insurance_policy rows for
-- themselves either. None of that is staff-only data -- it's exactly what
-- V2.1's application flow requires the applicant to submit -- so this closes
-- the gap rather than routing every application field write through a
-- trusted/service context, which would contradict the whole point of RLS
-- doing this job.
--
-- Scope, deliberately conservative: an applicant can only ever write rows
-- where the row's own customer_id resolves to THEIR customer record
-- (app_current_customer_id(), same trusted function as everywhere else).
-- Not yet handled (flagged, not silently skipped): locking these down once
-- application.status reaches 'approved' so a decided application can't be
-- edited after the fact -- worth adding before this goes further than a
-- pilot, not required to make the workspace itself function.

-- customer: self-registration. An applicant can create exactly one row for
-- themselves (auth_user_id = their own uid) -- they can't impersonate anyone
-- else since they don't control auth.uid().
drop policy if exists customer_self_insert on customer;
create policy customer_self_insert on customer for insert
  with check (auth_user_id = auth.uid());

-- application: own applications only
drop policy if exists customer_self_insert on application;
create policy customer_self_insert on application for insert
  with check (customer_id = app_current_customer_id());

drop policy if exists customer_self_update on application;
create policy customer_self_update on application for update
  using (customer_id = app_current_customer_id())
  with check (customer_id = app_current_customer_id());

-- authorized_driver
drop policy if exists customer_self_insert on authorized_driver;
create policy customer_self_insert on authorized_driver for insert
  with check (customer_id = app_current_customer_id());

drop policy if exists customer_self_update on authorized_driver;
create policy customer_self_update on authorized_driver for update
  using (customer_id = app_current_customer_id())
  with check (customer_id = app_current_customer_id());

-- customer_document
drop policy if exists customer_self_insert on customer_document;
create policy customer_self_insert on customer_document for insert
  with check (customer_id = app_current_customer_id());

-- platform_eligibility (insert + delete, since the Work step replaces the
-- selection set on each save rather than diffing it)
drop policy if exists customer_self_insert on platform_eligibility;
create policy customer_self_insert on platform_eligibility for insert
  with check (customer_id = app_current_customer_id());

drop policy if exists customer_self_delete on platform_eligibility;
create policy customer_self_delete on platform_eligibility for delete
  using (customer_id = app_current_customer_id());

-- insurance_policy
drop policy if exists customer_self_insert on insurance_policy;
create policy customer_self_insert on insurance_policy for insert
  with check (customer_id = app_current_customer_id());

drop policy if exists customer_self_update on insurance_policy;
create policy customer_self_update on insurance_policy for update
  using (customer_id = app_current_customer_id())
  with check (customer_id = app_current_customer_id());
