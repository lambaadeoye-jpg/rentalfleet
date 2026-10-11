-- Per-car cash costs (Phase 2 of the Business charts). ADMIN ONLY.
--
-- Kept in its own table, not on `vehicle`, because every office/field role can read `vehicle`.
-- Only real cash costs are stored (no depreciation). `partner_share_pct` is the share of a car's
-- profit that goes to a JV partner (0 = Zivo owns it outright); it drives the "after partner" view.
-- Safe to run more than once.

create or replace function app_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membership m join role r on r.id = m.role_id
    where m.user_id = auth.uid() and r.name = 'admin'
  );
$$;
revoke all on function app_is_admin() from public;
grant execute on function app_is_admin() to authenticated;

create table if not exists vehicle_cost (
  vehicle_id        uuid primary key references vehicle(id) on delete cascade,
  tenant_id         uuid not null references tenant(id),
  purchase_price    numeric(12,2) check (purchase_price is null or purchase_price >= 0),
  purchased_on      date,
  monthly_loan      numeric(10,2) not null default 0 check (monthly_loan >= 0),
  monthly_insurance numeric(10,2) not null default 0 check (monthly_insurance >= 0),
  monthly_other     numeric(10,2) not null default 0 check (monthly_other >= 0),
  partner_share_pct numeric(5,2)  not null default 0 check (partner_share_pct >= 0 and partner_share_pct <= 100),
  updated_at        timestamptz not null default now()
);

alter table vehicle_cost enable row level security;

drop policy if exists vehicle_cost_admin_all on vehicle_cost;
create policy vehicle_cost_admin_all on vehicle_cost
  for all to authenticated
  using (app_is_admin() and tenant_id in (select app_current_tenant_ids()))
  with check (app_is_admin() and tenant_id in (select app_current_tenant_ids()));

revoke all on vehicle_cost from anon;
grant select, insert, update, delete on vehicle_cost to authenticated;
