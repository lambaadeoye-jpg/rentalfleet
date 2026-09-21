-- Referral System
--
-- Design decisions locked in by explicit instruction:
-- 1. Bonus amount: not invented -- admin sets via policy_version.rules.referral,
--    same "don't invent the number, gate behind an explicit approved flag"
--    pattern as weekly rate and late fee (0038).
-- 2. Qualification: referred person completes their first FULL PAID WEEK --
--    NOT just "a payment exists" (which could just be the pickup deposit
--    on day 1). Defined precisely as: their rental has been active 7+
--    days AND at least one payment has been recorded for them.
-- 3. Requires staff approval before credit becomes usable -- mirrors the
--    existing charge-approval pattern. Reuses the approve_charge
--    permission (approving a pending financial credit is the same kind
--    of action as approving a pending charge, just the other direction).
-- 4. Cap is configurable per tenant: unlimited, or a dollar amount per
--    a configurable period -- built flexible, not hardcoded either way.
-- 5. Single-level only (no multi-level/MLM referral chains), per
--    explicit confirmation.
--
-- Reuses ledger_entry (existing, append-only) for both earning and
-- spending the credit, rather than inventing a parallel balance system --
-- matches "use an append-only financial ledger" already locked in the
-- architecture. referral_credit_earned when staff approves;
-- referral_credit_applied when the credit is actually used against a
-- charge -- preserves full audit history of both, consistent with
-- "corrections are reversals, not deletions."

alter table customer add column if not exists referral_code text unique;
alter table lead add column if not exists referred_by_customer_id uuid references customer(id);

create table if not exists referral (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  referrer_customer_id uuid not null references customer(id),
  referred_lead_id uuid not null references lead(id),
  status text not null default 'pending', -- pending | qualified | credited | declined
  qualified_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  credit_amount numeric(14,2),
  created_at timestamptz not null default now(),
  unique (referrer_customer_id, referred_lead_id)
);

alter table referral enable row level security;
alter table referral force row level security;

drop policy if exists tenant_isolation_select on referral;
create policy tenant_isolation_select on referral for select
  using (tenant_id in (select app_current_tenant_ids()));

drop policy if exists tenant_isolation_write on referral;
create policy tenant_isolation_write on referral for insert
  with check (tenant_id in (select app_current_tenant_ids()));

drop policy if exists tenant_isolation_update on referral;
create policy tenant_isolation_update on referral for update
  using (tenant_id in (select app_current_tenant_ids()))
  with check (tenant_id in (select app_current_tenant_ids()));

-- Customers can see their OWN referrals (as the referrer) from the
-- portal -- reuses the existing app_current_customer_id() helper.
drop policy if exists customer_self_select on referral;
create policy customer_self_select on referral for select
  using (referrer_customer_id = app_current_customer_id());

-- Approving a referral (setting status to 'credited') requires
-- approve_charge -- same permission as approving any other pending
-- financial benefit, not a new bespoke code.
create or replace function guard_referral_approval() returns trigger as $$
begin
  if new.status is distinct from old.status and new.status = 'credited' then
    perform reject_without_permission('approve_charge');
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists referral_approval_guard on referral;
create trigger referral_approval_guard
  before update on referral
  for each row execute function guard_referral_approval();

-- Seed the referral config into the existing pricing policy -- same
-- admin surface (/staff/pricing) as weekly rate and late fee, not a
-- separate settings page for a closely-related concept.
update policy_version
set rules = rules || jsonb_build_object(
  'referral', jsonb_build_object(
    'bonus_usd', null,
    'approved', false,
    'cap_type', 'unlimited',
    'cap_amount_usd', null,
    'cap_period_days', null
  )
)
where policy_type = 'pricing_and_mileage' and immutable = false
  and not (rules ? 'referral');

-- Daily qualification check (pg_cron, same architecture as late fees --
-- 0041/0042): finds referrals where the referred lead has converted to
-- a real customer with an active-or-further rental that's been running
-- 7+ days with at least one payment recorded, and flags them 'qualified'
-- for staff review. Does NOT issue credit itself -- that's the staff
-- approval step, per explicit instruction.
create or replace function detect_qualified_referrals() returns void as $$
begin
  update referral r
  set status = 'qualified', qualified_at = now()
  where r.status = 'pending'
    and exists (
      select 1
      from lead l
      join customer c on c.id = l.customer_id
      join rental rt on rt.customer_id = c.id
      where l.id = r.referred_lead_id
        and l.customer_id is not null
        and rt.start_at is not null
        and rt.start_at <= now() - interval '7 days'
        and exists (
          select 1 from payment p
          where p.customer_id = c.id and p.status = 'paid'
        )
    );
end;
$$ language plpgsql security definer set search_path = public;

select cron.schedule(
  'detect-qualified-referrals-daily',
  '0 8 * * *',
  $$select detect_qualified_referrals();$$
);

-- Narrow, safe RPC for the public lead form to link a referral code to a
-- new lead. Anon has no read access to customer at all (by design) --
-- this is the one narrow, trusted path that resolves a code and creates
-- the referral row server-side, without broadening anon's actual table
-- access. Returns nothing meaningful either way (invalid code = silent
-- no-op), so this can never be used to enumerate/verify which codes are
-- real. Verified live as the anon role specifically, not just trusted
-- context -- that's the actual runtime scenario.
create or replace function link_referral(p_referral_code text, p_lead_id uuid) returns void as $$
declare
  v_referrer_id uuid;
  v_tenant_id uuid;
begin
  if p_referral_code is null or trim(p_referral_code) = '' then
    return;
  end if;

  select id, tenant_id into v_referrer_id, v_tenant_id
  from customer where referral_code = p_referral_code;

  if v_referrer_id is null then
    return;
  end if;

  update lead set referred_by_customer_id = v_referrer_id where id = p_lead_id;

  insert into referral (tenant_id, referrer_customer_id, referred_lead_id)
    values (v_tenant_id, v_referrer_id, p_lead_id)
    on conflict (referrer_customer_id, referred_lead_id) do nothing;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function link_referral(text, uuid) to anon;
