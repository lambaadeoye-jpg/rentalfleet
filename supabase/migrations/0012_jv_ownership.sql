-- JV & Ownership
-- Generated from the consolidated schema.sql baseline, split to match the
-- Migration Order defined in Fleet_Rental_SaaS_Physical_Database_Implementation_Specification_v2.0.
-- Phase reference: BUILD_MASTER_SPECIFICATION_v2.0.md / Implementation Plan v2.0


create table if not exists jv_agreement (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  name text not null,
  economic_model text not null,
  investment_amount numeric(14,2),
  agreement_document_id uuid references signed_document(id),
  active boolean not null default true
);

create table if not exists jv_vehicle (
  jv_agreement_id uuid not null references jv_agreement(id),
  vehicle_id uuid not null references vehicle(id),
  primary key (jv_agreement_id,vehicle_id)
);

create table if not exists jv_distribution (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  jv_agreement_id uuid not null references jv_agreement(id),
  period_start date not null,
  period_end date not null,
  amount numeric(14,2) not null,
  status text not null default 'calculated',
  paid_at timestamptz
);
