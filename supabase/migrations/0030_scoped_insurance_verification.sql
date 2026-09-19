-- Scoped-Down Insurance Verification (V2.3 spec, items 1-3 of the
-- recommended MVP-under-the-MVP)
-- Full spec (10-table schema, OCR, external provider adapter, automated
-- 7-day re-verification, exception workflow) explicitly deferred as
-- Post-MVP per the document's own §18 -- this implements only what a
-- 3-vehicle pilot with manual staff review actually needs: a real status
-- vocabulary, a permission-gated way to set it, and enforcement that a
-- rental cannot start without current renter insurance on file.
--
-- IMPORTANT SCOPE NOTE (see conversation): this mitigates the "we started
-- a rental with a known-unresolved insurance status" exposure and creates
-- an auditable record that verification happened. It does NOT catch
-- fabricated documents (needs real carrier verification, deferred) and
-- does NOT catch a policy lapsing mid-rental (needs the automated 7-day
-- re-verification cycle, deferred). Actual legal exposure reduction still
-- depends primarily on the business's own commercial coverage (Bonzah)
-- and a properly drafted rental agreement -- neither of which software
-- can fix.

-- ---------------------------------------------------------------------------
-- 1. REAL STATUS VOCABULARY
-- Manual-first subset of the spec's 12-state machine (§9) -- the states
-- that mean something without automation. Not building
-- EXPIRING_SOON-vs-VERIFICATION_REVIEW_REQUIRED-vs-UNABLE_TO_VERIFY as
-- separate concepts yet since there's no automated check to distinguish
-- them; a human sets one status.
-- ---------------------------------------------------------------------------
alter table insurance_policy drop constraint if exists insurance_policy_verification_status_check;
alter table insurance_policy add constraint insurance_policy_verification_status_check check (
  verification_status in (
    'pending',            -- no document yet, or not yet reviewed
    'document_received',  -- uploaded, awaiting staff review
    'verified_active',    -- staff confirmed: currently valid coverage
    'expiring_soon',      -- still valid now, renewal needed soon
    'expired',            -- past the policy's expiration date
    'review_required',    -- staff flagged a discrepancy needing follow-up
    'cancelled'           -- confirmed inactive/cancelled
  )
);

-- ---------------------------------------------------------------------------
-- 2. PERMISSION-GATED STATUS CHANGES
-- Same pattern as approve_driver/approve_charge/etc. -- setting insurance
-- verification status is a real decision, not a free-for-all update.
-- ---------------------------------------------------------------------------
insert into permission (code, description) values
  ('verify_insurance', 'Set or change an insurance policy''s verification status')
on conflict (code) do nothing;

insert into role_permission (tenant_id, role_id, permission_id)
select r.tenant_id, r.id, p.id
from role r
cross join permission p
where r.name = 'admin' and p.code = 'verify_insurance'
on conflict do nothing;

create or replace function guard_insurance_verification() returns trigger as $$
begin
  if new.verification_status is distinct from old.verification_status then
    perform reject_without_permission('verify_insurance');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists insurance_verification_permission_guard on insurance_policy;
create trigger insurance_verification_permission_guard
  before update on insurance_policy
  for each row execute function guard_insurance_verification();

-- ---------------------------------------------------------------------------
-- 3. PICKUP-BLOCKING RULE
-- Spec §19 acceptance criterion: "Pickup cannot be authorized when
-- mandatory insurance requirements are unresolved." Checks the customer's
-- own (policy_type = 'renter') insurance_policy -- not the vehicle's own
-- company/Bonzah coverage, which is a separate concern. 'verified_active'
-- and 'expiring_soon' both mean currently-active coverage; everything else
-- blocks.
--
-- SECURITY DEFINER applied proactively here: this is the exact same shape
-- of internal table lookup that turned out to be broken in
-- enforce_status_transition() (migration 0029) when it wasn't security
-- definer -- its own SELECT was subject to the target table's RLS. Not
-- repeating that bug a second time now that the failure mode is known.
-- ---------------------------------------------------------------------------
create or replace function guard_rental_requires_insurance() returns trigger as $$
declare
  has_valid_insurance boolean;
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select exists (
      select 1 from insurance_policy
      where customer_id = new.customer_id
        and policy_type = 'renter'
        and verification_status in ('verified_active', 'expiring_soon')
    ) into has_valid_insurance;

    if not has_valid_insurance then
      raise exception 'Cannot start this rental: renter insurance is not verified as active. Resolve the insurance status first.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists rental_requires_insurance_guard on rental;
create trigger rental_requires_insurance_guard
  before insert or update on rental
  for each row execute function guard_rental_requires_insurance();
