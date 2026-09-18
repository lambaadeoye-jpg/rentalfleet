-- Application, Trust & Screening
-- Generated from the consolidated schema.sql baseline, split to match the
-- Migration Order defined in Fleet_Rental_SaaS_Physical_Database_Implementation_Specification_v2.0.
-- Phase reference: BUILD_MASTER_SPECIFICATION_v2.0.md / Implementation Plan v2.0


create table if not exists application (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  customer_id uuid not null references customer(id),
  status text not null default 'draft',
  submitted_at timestamptz,
  decision_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now()
);

create table if not exists screening (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  application_id uuid not null references application(id),
  provider text,
  provider_reference text,
  status text not null default 'pending',
  report_received_at timestamptz,
  adverse_action_status text,
  metadata jsonb not null default '{}'
);

-- NOTE: rental_id below intentionally has NO foreign-key constraint yet.
-- `rental` doesn't exist until the Booking/Rental migration (0006), which per
-- the documented Migration Order runs AFTER Application/Trust. The FK
-- constraint is attached at the end of 0006_booking_rental_assignment.sql
-- once the referenced table exists. This is a real forward-reference in the
-- original schema.sql (which got away with it by declaring every table in one
-- file); splitting into sequential migrations surfaces it.
create table if not exists authorized_driver (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  customer_id uuid not null references customer(id),
  rental_id uuid,
  first_name text not null,
  last_name text not null,
  license_state text,
  license_number_ref text,
  status text not null default 'pending',
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- rental_id: FK attached in 0006 once `rental` exists (see note above).
create table if not exists customer_document (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  customer_id uuid references customer(id),
  rental_id uuid,
  document_type text not null,
  storage_key text not null,
  status text not null default 'active',
  expires_at date,
  created_at timestamptz not null default now()
);
