-- Tenant Settings (key-value) + Manage Marketing Settings Permission
--
-- Small, extensible key-value store scoped per tenant -- starts with the
-- Google review link and current Facebook ad URL, since staff explicitly
-- asked to manage these from the dashboard instead of editing the n8n
-- workflow directly every time a new ad campaign starts. Same shape
-- extends to any future setting without another migration.

create table if not exists tenant_setting (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  key text not null,
  value text,
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);

alter table tenant_setting enable row level security;
alter table tenant_setting force row level security;

drop policy if exists tenant_isolation_select on tenant_setting;
create policy tenant_isolation_select on tenant_setting for select
  using (tenant_id in (select app_current_tenant_ids()));

drop policy if exists tenant_isolation_write on tenant_setting;
create policy tenant_isolation_write on tenant_setting for insert
  with check (tenant_id in (select app_current_tenant_ids()));

drop policy if exists tenant_isolation_update on tenant_setting;
create policy tenant_isolation_update on tenant_setting for update
  using (tenant_id in (select app_current_tenant_ids()))
  with check (tenant_id in (select app_current_tenant_ids()));

insert into permission (code, description) values
  ('manage_marketing_settings', 'Edit marketing-facing settings: Google review link, current Facebook ad URL')
on conflict (code) do nothing;

insert into role_permission (tenant_id, role_id, permission_id)
select r.tenant_id, r.id, p.id
from role r cross join permission p
where r.name = 'admin' and p.code = 'manage_marketing_settings'
on conflict do nothing;

create or replace function guard_manage_marketing_settings() returns trigger as $$
begin
  perform reject_without_permission('manage_marketing_settings');
  return coalesce(new, old);
end;
$$ language plpgsql set search_path = public;

drop trigger if exists tenant_setting_permission_guard on tenant_setting;
create trigger tenant_setting_permission_guard
  before insert or update on tenant_setting
  for each row execute function guard_manage_marketing_settings();
