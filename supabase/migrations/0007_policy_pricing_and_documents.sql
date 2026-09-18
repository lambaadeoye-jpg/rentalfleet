-- Policy, Pricing & Documents
-- Generated from the consolidated schema.sql baseline, split to match the
-- Migration Order defined in Fleet_Rental_SaaS_Physical_Database_Implementation_Specification_v2.0.
-- Phase reference: BUILD_MASTER_SPECIFICATION_v2.0.md / Implementation Plan v2.0


create table if not exists policy_version (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  policy_type text not null,
  version integer not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  rules jsonb not null default '{}',
  immutable boolean not null default false,
  unique (tenant_id,policy_type,version)
);

create table if not exists document_version (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  document_type text not null,
  version integer not null,
  template_body text,
  effective_from timestamptz not null,
  effective_to timestamptz,
  unique (tenant_id,document_type,version)
);

create table if not exists signed_document (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid references rental(id),
  document_version_id uuid references document_version(id),
  storage_key text not null,
  signed_at timestamptz,
  signer_customer_id uuid references customer(id)
);
