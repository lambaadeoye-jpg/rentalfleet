-- Insurance, Telematics, Tolls, Incidents & Recovery
-- Generated from the consolidated schema.sql baseline, split to match the
-- Migration Order defined in Fleet_Rental_SaaS_Physical_Database_Implementation_Specification_v2.0.
-- Phase reference: BUILD_MASTER_SPECIFICATION_v2.0.md / Implementation Plan v2.0


create table if not exists insurance_policy (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  vehicle_id uuid references vehicle(id),
  customer_id uuid references customer(id),
  rental_id uuid references rental(id),
  policy_type text not null,
  provider text,
  policy_reference text,
  effective_from date,
  effective_to date,
  verification_status text not null default 'pending',
  evidence jsonb not null default '{}'
);

create table if not exists telematics_device (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  vehicle_id uuid not null references vehicle(id),
  provider text not null,
  external_device_id text not null,
  active boolean not null default true,
  unique (tenant_id,provider,external_device_id)
);

create table if not exists telematics_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  vehicle_id uuid not null references vehicle(id),
  device_id uuid references telematics_device(id),
  event_type text not null,
  occurred_at timestamptz not null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  mileage bigint,
  speed numeric(8,2),
  battery numeric(8,2),
  payload jsonb not null default '{}'
);

create table if not exists geofence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  name text not null,
  definition jsonb not null,
  active boolean not null default true
);

create table if not exists telematics_alert (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  vehicle_id uuid not null references vehicle(id),
  alert_type text not null,
  severity text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists toll_transaction (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  vehicle_id uuid references vehicle(id),
  rental_id uuid references rental(id),
  external_reference text,
  amount numeric(14,2) not null,
  occurred_at timestamptz,
  responsibility text not null default 'renter'
);

create table if not exists incident (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  vehicle_id uuid references vehicle(id),
  rental_id uuid references rental(id),
  customer_id uuid references customer(id),
  incident_type text not null,
  status text not null default 'open',
  occurred_at timestamptz,
  description text
);

create table if not exists recovery_case (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid not null references rental(id),
  vehicle_id uuid not null references vehicle(id),
  customer_id uuid not null references customer(id),
  status text not null default 'delinquent',
  balance_due numeric(14,2) not null default 0,
  days_delinquent integer not null default 0,
  last_known_location jsonb,
  authorization_reason text,
  authorized_by uuid,
  authorized_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists recovery_assignment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  recovery_case_id uuid not null references recovery_case(id),
  assignment_type text not null,
  vendor_name text,
  status text not null default 'assigned',
  assigned_at timestamptz,
  completed_at timestamptz
);

create table if not exists recovery_expense (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  recovery_case_id uuid not null references recovery_case(id),
  expense_type text not null,
  amount numeric(14,2) not null,
  responsibility text not null default 'company',
  approval_status text not null default 'pending',
  approved_by uuid,
  approved_at timestamptz
);
