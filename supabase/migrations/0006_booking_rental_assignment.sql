-- Booking, Rental & Assignment
-- Generated from the consolidated schema.sql baseline, split to match the
-- Migration Order defined in Fleet_Rental_SaaS_Physical_Database_Implementation_Specification_v2.0.
-- Phase reference: BUILD_MASTER_SPECIFICATION_v2.0.md / Implementation Plan v2.0


create table if not exists booking_channel (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  code text not null,
  name text not null,
  active boolean not null default true,
  unique (tenant_id,code)
);

create table if not exists booking (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  customer_id uuid not null references customer(id),
  category_id uuid not null references vehicle_category(id),
  channel_id uuid references booking_channel(id),
  external_booking_id text,
  pickup_location_id uuid references location(id),
  pickup_at timestamptz not null,
  return_at timestamptz not null,
  status text not null default 'pending',
  quoted_amount numeric(14,2),
  policy_snapshot jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists rental (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  booking_id uuid references booking(id),
  customer_id uuid not null references customer(id),
  status text not null default 'pending',
  start_at timestamptz,
  expected_return_at timestamptz,
  actual_return_at timestamptz,
  governing_policy_snapshot jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists rental_segment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid not null references rental(id),
  vehicle_id uuid not null references vehicle(id),
  starts_at timestamptz not null,
  ends_at timestamptz,
  start_mileage bigint,
  end_mileage bigint,
  assignment_reason text,
  created_at timestamptz not null default now()
);

-- Attach FK constraints deferred from 0004_application_trust_screening.sql:
-- authorized_driver.rental_id and customer_document.rental_id were created
-- without a foreign key because `rental` did not exist yet at that point in
-- the migration order. Attaching now that it does.
alter table authorized_driver
  add constraint authorized_driver_rental_id_fkey
  foreign key (rental_id) references rental(id);

alter table customer_document
  add constraint customer_document_rental_id_fkey
  foreign key (rental_id) references rental(id);
