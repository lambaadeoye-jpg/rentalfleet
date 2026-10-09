-- CRM notes: staff-addable, free-text, for recording findings after a
-- background check, insurance verification, or driver's license check
-- (confirmed use case -- not a general-purpose comment box). A
-- dedicated table with one row per note, not a single overwritable
-- text field on customer, matching the project's established
-- discipline of preserving history with a real author and timestamp
-- rather than a mutable blob anyone's edit silently overwrites.
--
-- Permission: reuses approve_driver, the existing trust/screening-
-- domain permission already reused for red_flag entries -- notes are
-- literally about the same domain (background check / insurance /
-- license findings), not a new concept needing its own code. Confirmed
-- live: granted to admin, not field_staff, matching the confirmed
-- access decision ("all staff apart from field staff") exactly.
--
-- Append-only by design -- no update or delete policy. A note is a
-- record of what was found and when; letting staff silently edit or
-- remove history here would undermine the entire reason this table
-- exists. If a note turns out to be wrong, the fix is a new note
-- correcting it, not erasing the old one -- same principle as every
-- other historical record in this build (ledger, red flag resolution,
-- rental segments).

create table if not exists customer_note (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  customer_id uuid not null references customer(id),
  author_user_id uuid references user_profile(id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table customer_note enable row level security;
alter table customer_note force row level security;

drop policy if exists tenant_isolation_select on customer_note;
create policy tenant_isolation_select on customer_note for select
  using (tenant_id in (select app_current_tenant_ids()) and app_has_permission('approve_driver'));

drop policy if exists tenant_isolation_insert on customer_note;
create policy tenant_isolation_insert on customer_note for insert
  with check (tenant_id in (select app_current_tenant_ids()));

create or replace function guard_customer_note_write() returns trigger as $$
begin
  perform reject_without_permission('approve_driver');
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists customer_note_write_guard on customer_note;
create trigger customer_note_write_guard
  before insert on customer_note
  for each row execute function guard_customer_note_write();

create index if not exists idx_customer_note_customer
  on customer_note(customer_id, created_at desc);
