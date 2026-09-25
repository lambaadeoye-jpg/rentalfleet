-- Charges (general + deductible), and a unified generated-documents table
-- for receipts, invoices, and damage reports.
--
-- Real gap closed: charge had zero permission gate on plain INSERT at
-- all (only the approval transition was gated) -- same class of gap
-- found repeatedly during the earlier audit, caught this time before
-- building the write path on top of it, not after.
--
-- Deductible charges: a charge can optionally link to a specific
-- deposit. Approving a deposit-linked charge reduces that deposit's
-- refundable_amount -- done in application code (not a DB trigger),
-- matching how every other financial side effect in this system works
-- (e.g. approveReferral() creating its ledger_entry explicitly), for
-- the same reason: visible, auditable, easy to reason about, rather
-- than an invisible trigger side effect.
--
-- generated_document is deliberately one table for receipts, invoices,
-- AND damage reports -- all three are the same underlying shape (staff
-- generates a document, it gets stored, it gets sent to a renter), so
-- one table with a document_type column beats three near-identical ones.

alter table charge add column if not exists deposit_id uuid references deposit(id);

create or replace function guard_charge_insert() returns trigger as $$
begin
  perform reject_without_permission('approve_charge');
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists charge_insert_guard on charge;
create trigger charge_insert_guard
  before insert on charge
  for each row execute function guard_charge_insert();

create table if not exists generated_document (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid references rental(id),
  customer_id uuid references customer(id),
  document_type text not null, -- receipt | invoice | damage_report
  storage_key text not null,
  amount numeric(14,2),
  related_charge_id uuid references charge(id),
  related_payment_id uuid references payment(id),
  related_inspection_id uuid references inspection(id),
  generated_at timestamptz not null default now(),
  generated_by uuid,
  sent_at timestamptz,
  sent_to_email text
);

alter table generated_document enable row level security;
alter table generated_document force row level security;

drop policy if exists tenant_isolation_select on generated_document;
create policy tenant_isolation_select on generated_document for select
  using (tenant_id in (select app_current_tenant_ids()));

drop policy if exists tenant_isolation_insert on generated_document;
create policy tenant_isolation_insert on generated_document for insert
  with check (tenant_id in (select app_current_tenant_ids()));

-- Customers can see their own generated documents (receipts/invoices/
-- damage reports) from the portal -- same self-select pattern as
-- referral.
drop policy if exists customer_self_select on generated_document;
create policy customer_self_select on generated_document for select
  using (customer_id = app_current_customer_id());

-- Creating a generated_document record needs to match whichever action
-- actually produces it: a receipt is a natural side effect of recording
-- a payment (collect_payment -- field_staff included), an invoice is
-- tied to charge approval (approve_charge), a damage report is tied to
-- confirming a dropoff (confirm_dropoff). A single uniform permission
-- here would have silently blocked field_staff from generating a
-- receipt for a payment they're explicitly allowed to collect -- caught
-- before applying, not after.
create or replace function guard_generated_document_insert() returns trigger as $$
begin
  if app_has_permission('collect_payment') or app_has_permission('approve_charge') or app_has_permission('confirm_dropoff') then
    return new;
  end if;
  perform reject_without_permission('collect_payment');
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists generated_document_insert_guard on generated_document;
create trigger generated_document_insert_guard
  before insert on generated_document
  for each row execute function guard_generated_document_insert();

-- Storage bucket for generated documents (PDFs), same private-bucket +
-- tenant-scoped RLS pattern as applicant-documents and inspection-photos.
insert into storage.buckets (id, name, public)
values ('generated-documents', 'generated-documents', false)
on conflict (id) do nothing;

drop policy if exists staff_tenant_generated_documents_select on storage.objects;
create policy staff_tenant_generated_documents_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] in (select app_current_tenant_ids()::text)
  );

-- Customers need to download their OWN receipts/invoices/damage reports
-- too -- app_current_tenant_ids() is membership-scoped (staff only) and
-- won't resolve for a customer session, so this needs its own policy
-- joining through generated_document to the actual owning customer.
drop policy if exists customer_own_generated_documents_select on storage.objects;
create policy customer_own_generated_documents_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'generated-documents'
    and exists (
      select 1 from generated_document gd
      where gd.storage_key = storage.objects.name
        and gd.customer_id = app_current_customer_id()
    )
  );

drop policy if exists staff_tenant_generated_documents_insert on storage.objects;
create policy staff_tenant_generated_documents_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] in (select app_current_tenant_ids()::text)
  );
