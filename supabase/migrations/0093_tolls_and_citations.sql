-- Tolls and citations: turn the existing toll_transaction table (0010, unused so far)
-- into a working log. Staff record a toll or ticket against a car; the app finds the
-- rental that had the car at that moment and can raise a charge for the renter,
-- which then goes through the normal approval on the Charges page.
--
-- Safe to run more than once.

alter table toll_transaction
  add column if not exists kind text not null default 'toll',
  add column if not exists description text,
  add column if not exists status text not null default 'open',
  add column if not exists charge_id uuid references charge(id),
  add column if not exists created_at timestamptz not null default now();

alter table toll_transaction drop constraint if exists toll_transaction_kind_check;
alter table toll_transaction add constraint toll_transaction_kind_check check (kind in ('toll', 'citation'));

alter table toll_transaction drop constraint if exists toll_transaction_status_check;
alter table toll_transaction add constraint toll_transaction_status_check check (status in ('open', 'charged', 'waived'));

-- The same toll invoice or ticket number can't be entered twice.
create unique index if not exists uq_toll_transaction_reference
  on toll_transaction (tenant_id, external_reference)
  where external_reference is not null;

create index if not exists idx_toll_transaction_vehicle_time
  on toll_transaction (vehicle_id, occurred_at desc);

create index if not exists idx_toll_transaction_open
  on toll_transaction (tenant_id) where status = 'open';
