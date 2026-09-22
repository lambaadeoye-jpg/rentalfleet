-- Inspection Photos: storage bucket + permission gate
--
-- inspection/inspection_media tables have existed since the very first
-- migration, completely unused -- no UI ever captured pickup/return
-- condition photos, despite this being explicitly named in the locked
-- flow ("pickup inspection -> active rental -> ... -> return inspection").
-- Real legal/dispute protection gap: no documented vehicle condition at
-- handover or return.
--
-- Storage RLS follows the exact same pattern as applicant-documents
-- (0026): path structure {tenant_id}/{inspection_id}/{filename}, staff
-- can read/write within their own tenant's folder prefix. Scoped
-- staff-only for now, not customer-facing -- this is internal dispute
-- documentation, and adding customer-facing read access would need a
-- join through inspection->rental->customer_id at RLS-check time, real
-- added complexity deliberately left for a later pass if wanted.

insert into storage.buckets (id, name, public)
values ('inspection-photos', 'inspection-photos', false)
on conflict (id) do nothing;

drop policy if exists staff_tenant_inspection_photos_select on storage.objects;
create policy staff_tenant_inspection_photos_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] in (select app_current_tenant_ids()::text)
  );

drop policy if exists staff_tenant_inspection_photos_insert on storage.objects;
create policy staff_tenant_inspection_photos_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] in (select app_current_tenant_ids()::text)
  );

-- Permission gate on the inspection table itself -- reuses start_rental/
-- confirm_dropoff conceptually (this happens exactly at pickup/dropoff
-- confirmation), but since a single permission code is needed and both
-- pickup and dropoff staff need to be able to do this, and field_staff
-- already holds both start_rental and confirm_dropoff, gating on
-- EITHER is the correct match for who should actually be able to do this.
create or replace function guard_inspection_action() returns trigger as $$
begin
  if app_has_permission('start_rental') or app_has_permission('confirm_dropoff') then
    return coalesce(new, old);
  end if;
  perform reject_without_permission('start_rental');
  return coalesce(new, old);
end;
$$ language plpgsql set search_path = public;

drop trigger if exists inspection_action_guard on inspection;
create trigger inspection_action_guard
  before insert on inspection
  for each row execute function guard_inspection_action();

drop trigger if exists inspection_media_action_guard on inspection_media;
create trigger inspection_media_action_guard
  before insert on inspection_media
  for each row execute function guard_inspection_action();
