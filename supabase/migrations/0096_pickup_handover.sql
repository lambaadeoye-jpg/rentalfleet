-- Guided pickup handover.
--   1. Each walkthrough photo/video is tagged with the area of the car it shows, and videos are capped at 60 seconds.
--   2. One row per rental records the runner's guided steps: ID check, rules explained, quick checks, testimonial release,
--      and whether the post-pickup message went out. The rules text shown is saved too, as proof of what the renter was told.
-- A runner can only write the row for a rental assigned to them that is still waiting for pickup.
--
-- Safe to run more than once.

alter table inspection_media add column if not exists area text;
alter table inspection_media add column if not exists duration_seconds integer;
alter table inspection_media drop constraint if exists inspection_media_video_length_check;
alter table inspection_media add constraint inspection_media_video_length_check
  check (media_type <> 'video' or (duration_seconds is not null and duration_seconds between 1 and 60));

create table if not exists pickup_handover (
  rental_id uuid primary key references rental(id) on delete cascade,
  tenant_id uuid not null references tenant(id),
  identity_verified_at timestamptz,
  identity_verified_by uuid,
  checks jsonb not null default '{}'::jsonb,
  briefing_acked jsonb not null default '{}'::jsonb,
  briefing_snapshot jsonb,
  testimonial_status text not null default 'none' check (testimonial_status in ('none', 'recorded', 'declined')),
  testimonial_release_name text,
  testimonial_release_text text,
  testimonial_release_at timestamptz,
  message_sent_at timestamptz,
  message_channels jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pickup_handover_tenant on pickup_handover (tenant_id);

alter table pickup_handover enable row level security;
alter table pickup_handover force row level security;

drop policy if exists tenant_isolation_select on pickup_handover;
create policy tenant_isolation_select on pickup_handover for select
  using (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_write on pickup_handover;
create policy tenant_isolation_write on pickup_handover for insert
  with check (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_update on pickup_handover;
create policy tenant_isolation_update on pickup_handover for update
  using (tenant_id in (select app_current_tenant_ids()))
  with check (tenant_id in (select app_current_tenant_ids()));

create or replace function guard_pickup_handover() returns trigger as $$
begin
  -- The server's own service role (no signed-in user) is trusted.
  if auth.uid() is null then
    new.updated_at := now();
    return new;
  end if;

  if app_has_permission('manage_fleet') then
    new.updated_at := now();
    return new;
  end if;

  if app_has_permission('start_rental') and exists (
    select 1 from rental r
    where r.id = new.rental_id
      and r.tenant_id = new.tenant_id
      and r.assigned_runner_id = auth.uid()
      and r.status = 'scheduled'
  ) then
    -- A runner cannot fake the message record.
    if tg_op = 'INSERT' then
      new.message_sent_at := null;
      new.message_channels := null;
    else
      new.message_sent_at := old.message_sent_at;
      new.message_channels := old.message_channels;
    end if;
    new.updated_at := now();
    return new;
  end if;

  perform reject_without_permission('start_rental');
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists pickup_handover_guard on pickup_handover;
create trigger pickup_handover_guard
  before insert or update on pickup_handover
  for each row execute function guard_pickup_handover();
