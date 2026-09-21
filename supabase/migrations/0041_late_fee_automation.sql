-- Late Fee Automation via pg_cron
--
-- Runs the fee-CREATION logic directly inside Postgres on a schedule --
-- not n8n. This is a pure internal database operation (check overdue
-- payment_schedule rows, insert a charge) with no external SMS/email step
-- of its own; routing something this mechanical through an external
-- service would be an unnecessary extra hop. n8n still handles NOTIFYING
-- the renter about the fee, via the same webhook pattern as everything
-- else -- this migration only creates the charge record.
--
-- Auto-applies per explicit instruction (no staff approval step, unlike
-- insurance verification) -- approval_status is set directly to
-- 'approved' at creation. Grace period of 0 days means the fee applies
-- starting the day after the due date, also per explicit instruction.
--
-- Only fires when BOTH late_fee.approved is true AND a real amount is
-- set on the pricing policy (/staff/pricing) -- there is currently no
-- real late fee amount set, so this function will find eligible overdue
-- schedules but skip every single one until that's configured. That's
-- correct behavior, not a bug: no invented number gets charged.

alter table charge add column if not exists late_fee_for_schedule_id uuid references payment_schedule(id);

create extension if not exists pg_cron;

create or replace function apply_late_fees() returns void as $$
declare
  v_schedule record;
  v_rules jsonb;
  v_late_fee jsonb;
  v_grace_days int;
  v_amount numeric;
  v_already_charged boolean;
  v_recently_paid boolean;
begin
  for v_schedule in
    select ps.id, ps.rental_id, ps.next_due_at, r.tenant_id, r.customer_id
    from payment_schedule ps
    join rental r on r.id = ps.rental_id
    where ps.status = 'active'
      and ps.next_due_at < now()
  loop
    select rules into v_rules
    from policy_version
    where tenant_id = v_schedule.tenant_id and policy_type = 'pricing_and_mileage' and immutable = false;

    v_late_fee := v_rules -> 'late_fee';
    v_grace_days := coalesce((v_late_fee ->> 'grace_days')::int, 0);
    v_amount := (v_late_fee ->> 'amount_usd')::numeric;

    -- Skip entirely unless explicitly approved AND a real amount exists --
    -- no invented number ever gets charged.
    continue when v_late_fee is null
      or (v_late_fee ->> 'approved')::boolean is not true
      or v_amount is null;

    -- Grace period check: "day after due date" with grace_days=0 means
    -- the fee applies starting exactly one day past next_due_at.
    continue when now() < v_schedule.next_due_at + make_interval(days => v_grace_days + 1);

    -- Has a payment actually landed for this billing cycle? Heuristic,
    -- not a strict per-cycle link (payment isn't tied to a specific
    -- payment_schedule row in this schema): any payment on this rental
    -- paid within the week leading up to the due date counts as covering
    -- this cycle.
    select exists (
      select 1 from payment
      where rental_id = v_schedule.rental_id
        and paid_at >= v_schedule.next_due_at - interval '7 days'
        and status = 'paid'
    ) into v_recently_paid;
    continue when v_recently_paid;

    -- Already charged for this exact schedule row? Prevents the same
    -- missed payment from generating a new late fee every single day
    -- this function runs.
    select exists (select 1 from charge where late_fee_for_schedule_id = v_schedule.id) into v_already_charged;
    continue when v_already_charged;

    insert into charge (
      tenant_id, rental_id, customer_id, charge_type, amount,
      responsibility, approval_status, approved_at, late_fee_for_schedule_id
    ) values (
      v_schedule.tenant_id, v_schedule.rental_id, v_schedule.customer_id, 'late_fee', v_amount,
      'renter', 'approved', now(), v_schedule.id
    );
  end loop;
end;
$$ language plpgsql security definer set search_path = public;

select cron.schedule(
  'apply-late-fees-daily',
  '0 9 * * *',  -- 9am daily
  $$select apply_late_fees();$$
);
