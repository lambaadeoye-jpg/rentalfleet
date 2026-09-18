-- CRM & Customer 360
-- Generated from the consolidated schema.sql baseline, split to match the
-- Migration Order defined in Fleet_Rental_SaaS_Physical_Database_Implementation_Specification_v2.0.
-- Phase reference: BUILD_MASTER_SPECIFICATION_v2.0.md / Implementation Plan v2.0


create table if not exists customer (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  first_name text not null,
  last_name text not null,
  email citext,
  phone text,
  status text not null default 'prospect',
  created_at timestamptz not null default now()
);

create table if not exists lead (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  customer_id uuid references customer(id),
  first_name text,
  last_name text,
  email citext,
  phone text,
  preferred_category_id uuid,
  pickup_date date,
  duration_value integer,
  duration_unit text,
  rideshare boolean,
  source text,
  campaign text,
  referral text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  stage text not null default 'new',
  lost_reason text,
  assigned_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
