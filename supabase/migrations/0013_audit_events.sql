-- Audit & Domain Events
-- Generated from the consolidated schema.sql baseline, split to match the
-- Migration Order defined in Fleet_Rental_SaaS_Physical_Database_Implementation_Specification_v2.0.
-- Phase reference: BUILD_MASTER_SPECIFICATION_v2.0.md / Implementation Plan v2.0


create table if not exists audit_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenant(id),
  actor_user_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  source text,
  created_at timestamptz not null default now()
);
