-- Finance, Payments & Ledger
-- Generated from the consolidated schema.sql baseline, split to match the
-- Migration Order defined in Fleet_Rental_SaaS_Physical_Database_Implementation_Specification_v2.0.
-- Phase reference: BUILD_MASTER_SPECIFICATION_v2.0.md / Implementation Plan v2.0


create table if not exists payment_schedule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid not null references rental(id),
  cadence text not null,
  next_due_at timestamptz,
  amount numeric(14,2) not null,
  status text not null default 'active'
);

create table if not exists payment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid references rental(id),
  customer_id uuid references customer(id),
  provider text,
  provider_payment_id text,
  method_type text,
  amount numeric(14,2) not null,
  currency char(3) not null default 'USD',
  status text not null default 'scheduled',
  paid_at timestamptz,
  metadata jsonb not null default '{}'
);

create table if not exists deposit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid not null references rental(id),
  amount_collected numeric(14,2) not null,
  status text not null default 'held',
  refundable_amount numeric(14,2),
  refunded_at timestamptz
);

create table if not exists charge (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid references rental(id),
  customer_id uuid references customer(id),
  charge_type text not null,
  amount numeric(14,2) not null,
  responsibility text not null default 'unassigned',
  approval_status text not null default 'pending',
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists ledger_entry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid references rental(id),
  customer_id uuid references customer(id),
  entry_type text not null,
  amount numeric(14,2) not null,
  reference_type text,
  reference_id uuid,
  created_at timestamptz not null default now()
);
