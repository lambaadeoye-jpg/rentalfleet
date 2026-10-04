-- Foundation for the omni-channel lead/customer inbox. communication_event
-- already existed, well-designed for exactly this (channel, direction,
-- lead_id, payload jsonb, no channel constraint) but was never actually
-- written to by any app code -- confirmed zero rows and zero references
-- before this migration. This adds the one real gap: staff access control.
--
-- Access restricted the same way as the CRM notes field (confirmed
-- decision): all staff except field_staff. Only two real roles exist
-- today (admin, field_staff), so in practice this means admin only for
-- now, but the permission-based approach (not a hardcoded role name)
-- means any future role just needs the permission granted, not a code
-- change here.

-- permission is a global catalog (no tenant_id); role_permission is the
-- tenant-scoped junction table. Confirmed this the hard way -- an earlier
-- version of this migration guessed permission had a tenant_id column,
-- which failed against the real schema and was corrected before applying.
insert into permission (code, description)
values ('engage_leads', 'View and reply to lead/customer messages across channels (SMS, WhatsApp, etc.)')
on conflict (code) do nothing;

insert into role_permission (tenant_id, role_id, permission_id)
select r.tenant_id, r.id, p.id
from role r
cross join permission p
where r.name = 'admin' and p.code = 'engage_leads'
on conflict do nothing;

-- SELECT: staff need app_has_permission in addition to tenant match.
-- The existing customer_self_select policy is untouched and still lets
-- a customer see their own messages independently -- RLS SELECT
-- policies combine with OR, so restricting this one doesn't affect that.
drop policy if exists tenant_isolation_select on communication_event;
create policy tenant_isolation_select on communication_event for select
  using (tenant_id in (select app_current_tenant_ids()) and app_has_permission('engage_leads'));

-- INSERT guard: only applies to staff-initiated writes. A customer
-- inserting their own message (via customer_self_insert) has no
-- membership row, so is_staff is false and the permission check never
-- fires for them -- same for the inbound-webhook path, which will use
-- the service role key (auth.uid() is null there too). Only an actual
-- staff session without the engage_leads permission gets rejected.
create or replace function guard_communication_event_write() returns trigger as $$
declare
  is_staff boolean;
begin
  select exists(select 1 from membership where user_id = auth.uid()) into is_staff;
  if is_staff then
    perform reject_without_permission('engage_leads');
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql set search_path = public;

drop trigger if exists communication_event_write_guard on communication_event;
create trigger communication_event_write_guard
  before insert on communication_event
  for each row execute function guard_communication_event_write();
