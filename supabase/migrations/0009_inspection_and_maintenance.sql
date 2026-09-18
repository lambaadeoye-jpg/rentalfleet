-- Inspection & Maintenance
-- Generated from the consolidated schema.sql baseline, split to match the
-- Migration Order defined in Fleet_Rental_SaaS_Physical_Database_Implementation_Specification_v2.0.
-- Phase reference: BUILD_MASTER_SPECIFICATION_v2.0.md / Implementation Plan v2.0


create table if not exists inspection (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid references rental(id),
  vehicle_id uuid not null references vehicle(id),
  inspection_type text not null,
  completed_by_user_id uuid,
  completed_by_customer_id uuid references customer(id),
  completed_at timestamptz,
  notes text
);

create table if not exists inspection_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  inspection_id uuid not null references inspection(id),
  storage_key text not null,
  media_type text not null,
  captured_at timestamptz
);

create table if not exists maintenance_work_order (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  vehicle_id uuid not null references vehicle(id),
  status text not null default 'open',
  work_type text,
  cost numeric(14,2),
  downtime_start timestamptz,
  downtime_end timestamptz,
  notes text
);
