-- Gig Platform Options + Platform Eligibility Tracking
-- Closes a real gap: PRS v2.0 §6 ("Gig Platform Eligibility") and the Physical
-- Database spec's entity groups both call for a `platform_eligibility` table
-- ("platform/market/ruleset/version/date-aware eligibility... never use a
-- permanent generic eligibility flag") — it was never actually built. The only
-- thing that existed was a single `lead.rideshare boolean`, which cannot
-- represent which platform(s) someone drives/delivers for.
--
-- Design note: the user's requested list included "Multiple Services" as its
-- own option. That's handled here by allowing MULTIPLE rows per lead/customer
-- (a proper many-to-many), so someone who does Uber + DoorDash just gets two
-- rows -- there's no separate "multiple" value to keep in sync. "Others" is
-- kept as a real catch-all platform code so intake forms always have an out.

-- ---------------------------------------------------------------------------
-- 1. GIG PLATFORM (global reference list -- not tenant-owned, not sensitive)
-- ---------------------------------------------------------------------------
create table if not exists gig_platform (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0
);

alter table gig_platform enable row level security;
drop policy if exists gig_platform_read_all on gig_platform;
create policy gig_platform_read_all on gig_platform for select
  using (auth.role() = 'authenticated');

insert into gig_platform (code, name, sort_order) values
  ('uber', 'Uber', 1),
  ('lyft', 'Lyft', 2),
  ('ubereats', 'Uber Eats', 3),
  ('doordash', 'DoorDash', 4),
  ('instacart', 'Instacart', 5),
  ('amazon_flex', 'Amazon Flex', 6),
  ('other', 'Other', 99)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. LEAD <-> GIG PLATFORM (which platform(s) a lead mentioned pre-application;
--    lightweight, self-reported, not yet verified)
-- ---------------------------------------------------------------------------
create table if not exists lead_gig_platform (
  tenant_id uuid not null references tenant(id),
  lead_id uuid not null references lead(id),
  gig_platform_id uuid not null references gig_platform(id),
  other_description text,
  primary key (lead_id, gig_platform_id)
);

alter table lead_gig_platform enable row level security;
alter table lead_gig_platform force row level security;

drop policy if exists tenant_isolation_select on lead_gig_platform;
create policy tenant_isolation_select on lead_gig_platform for select
  using (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_write on lead_gig_platform;
create policy tenant_isolation_write on lead_gig_platform for insert
  with check (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_update on lead_gig_platform;
create policy tenant_isolation_update on lead_gig_platform for update
  using (tenant_id in (select app_current_tenant_ids()))
  with check (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_delete on lead_gig_platform;
create policy tenant_isolation_delete on lead_gig_platform for delete
  using (tenant_id in (select app_current_tenant_ids()));

-- ---------------------------------------------------------------------------
-- 3. PLATFORM_ELIGIBILITY (the actual missing entity from the Physical DB
--    spec -- verified, evidenced, per-platform eligibility on the customer/
--    application side; this is what governs vehicle assignment eligibility,
--    NOT the lead-side self-report above)
-- ---------------------------------------------------------------------------
create table if not exists platform_eligibility (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  customer_id uuid not null references customer(id),
  application_id uuid references application(id),
  gig_platform_id uuid not null references gig_platform(id),
  other_description text,
  verification_status text not null default 'pending',
  evidence jsonb not null default '{}',
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

alter table platform_eligibility drop constraint if exists platform_eligibility_status_check;
alter table platform_eligibility add constraint platform_eligibility_status_check check (
  verification_status in ('pending','verified','failed','expired')
);

alter table platform_eligibility enable row level security;
alter table platform_eligibility force row level security;

drop policy if exists tenant_isolation_select on platform_eligibility;
create policy tenant_isolation_select on platform_eligibility for select
  using (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_write on platform_eligibility;
create policy tenant_isolation_write on platform_eligibility for insert
  with check (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_update on platform_eligibility;
create policy tenant_isolation_update on platform_eligibility for update
  using (tenant_id in (select app_current_tenant_ids()))
  with check (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_delete on platform_eligibility;
create policy tenant_isolation_delete on platform_eligibility for delete
  using (tenant_id in (select app_current_tenant_ids()));

create index if not exists idx_platform_eligibility_customer on platform_eligibility(tenant_id, customer_id);
