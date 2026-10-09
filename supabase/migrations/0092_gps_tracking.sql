-- GPS tracking: provider-neutral cache of each tracker's latest state, plus
-- duplicate protection and cleanup for the position history.
--
-- Builds on telematics_device / telematics_event / telematics_alert from 0010.
-- Providers (Bouncie, GoldStar, anything else) are translated into one shape in
-- app code; nothing in this migration is provider-specific.
--
-- Safe to run more than once.

alter table telematics_device
  add column if not exists nickname text,
  add column if not exists created_at timestamptz not null default now(),
  -- Latest state, so the map and tracking pages don't scan the history table.
  add column if not exists last_seen_at timestamptz,        -- any message from the device
  add column if not exists last_position_at timestamptz,    -- last message that carried a location
  add column if not exists last_latitude numeric(10,7),
  add column if not exists last_longitude numeric(10,7),
  add column if not exists last_speed numeric(8,2),
  add column if not exists last_ignition boolean,
  add column if not exists last_odometer bigint;

alter table telematics_device drop constraint if exists telematics_device_provider_check;
alter table telematics_device
  add constraint telematics_device_provider_check
  check (provider in ('bouncie', 'goldstar', 'other', 'manual'));

-- A provider can resend the same reading (Bouncie documents this). One row per
-- device, type and moment; the ingest code relies on this to drop repeats.
create unique index if not exists uq_telematics_event_dedupe
  on telematics_event (device_id, event_type, occurred_at);

create index if not exists idx_telematics_event_vehicle_time
  on telematics_event (vehicle_id, occurred_at desc);

create index if not exists idx_telematics_alert_vehicle_open
  on telematics_alert (vehicle_id) where status = 'open';

-- Raw position history grows quickly while cars are driving. Keep the useful
-- events (trips, unplug, alerts) and drop old plain positions.
-- Call from a scheduled job, for example: select prune_telematics_positions(30);
create or replace function prune_telematics_positions(p_keep_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_keep_days < 7 then
    raise exception 'Keep at least 7 days of positions';
  end if;
  delete from telematics_event
   where event_type = 'position'
     and occurred_at < now() - make_interval(days => p_keep_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function prune_telematics_positions(integer) from public, anon, authenticated;
grant execute on function prune_telematics_positions(integer) to service_role;
