-- Ad spend per channel per month (Phase 3 of the Business charts). ADMIN ONLY.
-- `source` must match the channel name stored on leads (lead.source), for example meta_ads, google_ads,
-- facebook_marketplace. `month` is always the first day of the month. One row per channel per month.
-- Requires app_is_admin() from 0102. Safe to run more than once.

create table if not exists ad_spend (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenant(id),
  month      date not null check (month = date_trunc('month', month)::date),
  source     text not null check (length(trim(source)) between 1 and 60),
  amount     numeric(10,2) not null check (amount >= 0 and amount <= 1000000),
  notes      text check (notes is null or length(notes) <= 300),
  updated_at timestamptz not null default now(),
  unique (tenant_id, month, source)
);

alter table ad_spend enable row level security;

drop policy if exists ad_spend_admin_all on ad_spend;
create policy ad_spend_admin_all on ad_spend
  for all to authenticated
  using (app_is_admin() and tenant_id in (select app_current_tenant_ids()))
  with check (app_is_admin() and tenant_id in (select app_current_tenant_ids()));

revoke all on ad_spend from anon;
grant select, insert, update, delete on ad_spend to authenticated;
