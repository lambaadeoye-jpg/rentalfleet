-- Customer Lifecycle Tracking + Applicant Document Storage
-- Closes a real gap found while starting the Application Workspace build:
-- V2.1 §4 locks Lead -> Applicant -> Customer as distinct, non-interchangeable
-- stages, but `application.customer_id` was NOT NULL from the original
-- schema -- meaning a `customer` row had to exist before an application
-- could, collapsing "applicant" into "customer" from day one.
--
-- RATHER THAN a new `applicant` table (more migration surface, another
-- table to keep RLS/tests in sync with), this uses `customer.status` as the
-- real lifecycle tracker -- the column already existed (default 'prospect')
-- but had no locked values and no real meaning yet. 'applicant' now
-- represents someone with an auth identity mid-application, distinct from
-- 'active' (an approved, transacting customer). Application Workspace vs.
-- Customer Portal routing (V2.1 §8) is decided by the app reading this
-- value plus the linked application.status, not by row existence alone.

-- ---------------------------------------------------------------------------
-- 1. LOCK CUSTOMER LIFECYCLE VALUES
-- ---------------------------------------------------------------------------
alter table customer drop constraint if exists customer_status_check;
alter table customer add constraint customer_status_check check (
  status in ('prospect','applicant','approved','active','declined','inactive')
);

-- ---------------------------------------------------------------------------
-- 2. APPLICANT DOCUMENT STORAGE
-- Driver's license and proof-of-residence uploads (V2.1 §6). Private bucket;
-- path convention: {tenant_id}/{customer_id}/{document_type}/{filename} --
-- RLS below scopes access by parsing that path, the same pattern Supabase's
-- own storage RLS docs use.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('applicant-documents', 'applicant-documents', false)
on conflict (id) do nothing;

-- Applicant: can upload/read/replace files under their OWN customer_id
-- folder only. Uses app_current_customer_id() (from 0020) -- same trusted
-- pattern used for every other customer-self policy this build.
drop policy if exists applicant_own_documents_select on storage.objects;
create policy applicant_own_documents_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'applicant-documents'
    and (storage.foldername(name))[2] = (select app_current_customer_id())::text
  );

drop policy if exists applicant_own_documents_insert on storage.objects;
create policy applicant_own_documents_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'applicant-documents'
    and (storage.foldername(name))[2] = (select app_current_customer_id())::text
  );

-- Staff: can read all documents within their own tenant's folder prefix.
drop policy if exists staff_tenant_documents_select on storage.objects;
create policy staff_tenant_documents_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'applicant-documents'
    and (storage.foldername(name))[1] in (select app_current_tenant_ids()::text)
  );
