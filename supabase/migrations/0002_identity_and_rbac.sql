-- Tenant, Identity & RBAC
-- Generated from the consolidated schema.sql baseline, split to match the
-- Migration Order defined in Fleet_Rental_SaaS_Physical_Database_Implementation_Specification_v2.0.
-- Phase reference: BUILD_MASTER_SPECIFICATION_v2.0.md / Implementation Plan v2.0


create table if not exists tenant (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug citext unique not null,
  status text not null default 'active',
  timezone text not null default 'America/Chicago',
  currency char(3) not null default 'USD',
  locale text not null default 'en-US',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists location (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  name text not null,
  address_line1 text,
  city text,
  state text,
  postal_code text,
  timezone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists user_profile (
  id uuid primary key,
  tenant_id uuid not null references tenant(id),
  email citext,
  full_name text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists role (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  name text not null,
  unique (tenant_id,name)
);

create table if not exists membership (
  tenant_id uuid not null references tenant(id),
  user_id uuid not null references user_profile(id),
  role_id uuid references role(id),
  primary key (tenant_id,user_id)
);
