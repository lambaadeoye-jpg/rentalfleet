-- Support, Communications & Automation
-- Generated from the consolidated schema.sql baseline, split to match the
-- Migration Order defined in Fleet_Rental_SaaS_Physical_Database_Implementation_Specification_v2.0.
-- Phase reference: BUILD_MASTER_SPECIFICATION_v2.0.md / Implementation Plan v2.0


create table if not exists support_ticket (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  customer_id uuid not null references customer(id),
  rental_id uuid references rental(id),
  status text not null default 'open',
  priority text not null default 'normal',
  subject text not null,
  created_at timestamptz not null default now()
);

create table if not exists communication_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  customer_id uuid references customer(id),
  lead_id uuid references lead(id),
  rental_id uuid references rental(id),
  channel text not null,
  direction text,
  event_type text not null,
  external_reference text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists automation_execution (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  automation_key text not null,
  status text not null default 'queued',
  idempotency_key text,
  started_at timestamptz,
  completed_at timestamptz,
  error text
);

create table if not exists webhook_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenant(id),
  provider text not null,
  external_event_id text not null,
  event_type text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received',
  payload jsonb not null default '{}',
  unique(provider,external_event_id)
);
