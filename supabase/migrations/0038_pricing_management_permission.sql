-- Pricing Management Permission + Approved-Status Fix
--
-- Two real gaps found while building this, both closed together:
--
-- 1. policy_version had NO permission gate at all -- only an "already
--    immutable, can't touch it" guard. Any staff member, any role, could
--    edit live pricing. New manage_pricing permission closes this,
--    admin-only per the explicit requirement ("the right admin staff").
--
-- 2. The seeded policy_version row already had weekly_rate_usd: 400 with
--    a "DRAFT - not yet approved" status STRING -- but startRental()'s
--    payment_schedule creation only checked whether weekly_rate_usd was
--    truthy, never read that status marker. In practice, a weekly-option
--    rental today would have silently used this unapproved draft number.
--    Restructured rules to explicit boolean approved flags the code
--    actually checks, not a string comment nothing enforces.
--
-- Daily pricing ($220 first 3 days, $74/day after) is a genuinely locked
-- V2.1 business rule already, not a TBD number -- seeded as already
-- approved. Weekly rate and late fee start unapproved until a real admin
-- sets them through the new UI.

insert into permission (code, description) values
  ('manage_pricing', 'Set or modify pricing rules: daily/weekly rates, late fees, mileage policy')
on conflict (code) do nothing;

insert into role_permission (tenant_id, role_id, permission_id)
select r.tenant_id, r.id, p.id
from role r cross join permission p
where r.name = 'admin' and p.code = 'manage_pricing'
on conflict do nothing;

create or replace function guard_manage_pricing() returns trigger as $$
begin
  perform reject_without_permission('manage_pricing');
  return coalesce(new, old);
end;
$$ language plpgsql set search_path = public;

drop trigger if exists policy_version_pricing_permission_guard on policy_version;
create trigger policy_version_pricing_permission_guard
  before update on policy_version
  for each row execute function guard_manage_pricing();

-- Restructure the existing draft policy's rules to explicit approved flags.
update policy_version
set rules = jsonb_build_object(
  'mileage_policy', 'unlimited',
  'deposit_weeks', 1,
  'daily', jsonb_build_object(
    'first_tier_days', 3,
    'first_tier_total_usd', 220,
    'per_day_after_usd', 74,
    'approved', true
  ),
  'weekly_rate_usd', null,
  'weekly_approved', false,
  'late_fee', jsonb_build_object(
    'grace_days', 0,
    'amount_usd', null,
    'approved', false
  )
)
where tenant_id = (select id from tenant where slug = 'fleet-rental-pilot')
  and policy_type = 'pricing_and_mileage'
  and immutable = false;
