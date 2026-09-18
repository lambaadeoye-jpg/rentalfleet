-- Fleet & Rental Readiness
-- Generated from the consolidated schema.sql baseline, split to match the
-- Migration Order defined in Fleet_Rental_SaaS_Physical_Database_Implementation_Specification_v2.0.
-- Phase reference: BUILD_MASTER_SPECIFICATION_v2.0.md / Implementation Plan v2.0


create table if not exists vehicle_category (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  name text not null,
  description text,
  active boolean not null default true,
  unique (tenant_id,name)
);

create table if not exists vehicle (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  category_id uuid references vehicle_category(id),
  location_id uuid references location(id),
  vin text,
  year integer,
  make text,
  model text,
  trim text,
  plate text,
  registration_expiry date,
  mileage bigint not null default 0,
  status text not null default 'acquired',
  ownership_type text not null default 'company_owned',
  created_at timestamptz not null default now()
);

create table if not exists vehicle_readiness_check (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  vehicle_id uuid not null references vehicle(id),
  check_type text not null,
  status text not null,
  checked_at timestamptz not null default now(),
  expires_at timestamptz,
  evidence jsonb not null default '{}',
  notes text
);
