-- Late Fees Accumulate Daily
--
-- Real behavior change per explicit instruction: the original
-- apply_late_fees() (0041) charged exactly ONE late fee per missed
-- payment_schedule -- the dedup check was "has ANY charge ever been
-- created for this schedule," which correctly prevented double-charging
-- on repeated cron runs, but also meant the fee never grew the longer a
-- payment stayed unpaid. Now it should charge once per calendar day the
-- payment remains overdue, accumulating until paid.
--
-- Added late_fee_charge_date to charge -- the specific calendar day a
-- given daily fee represents, separate from late_fee_for_schedule_id
-- (which schedule it's for). The dedup check changes from "ever charged
-- for this schedule" to "charged for this schedule ON TODAY'S DATE" --
-- since the cron runs once daily, this naturally produces exactly one
-- new charge per day the schedule stays overdue and unpaid, which is
-- the accumulation behavior asked for, without needing to backfill
-- multiple days in a single run.
--
-- The "was this recently paid" check already had no upper time bound on
-- paid_at (only a lower bound, next_due_at - 7 days), so a LATE payment
-- made any time after that window already correctly stops future daily
-- charges from accumulating further -- verified this holds, not just
-- assumed, before relying on it here.

alter table charge add column if not exists late_fee_charge_date date;

create or replace function apply_late_fees() returns void as $$
declare
  v_schedule record;
  v_rules jsonb;
  v_late_fee jsonb;
  v_grace_days int;
  v_amount numeric;
  v_already_charged_today boolean;
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

    continue when v_late_fee is null
      or (v_late_fee ->> 'approved')::boolean is not true
      or v_amount is null;

    continue when now() < v_schedule.next_due_at + make_interval(days => v_grace_days + 1);

    select exists (
      select 1 from payment
      where rental_id = v_schedule.rental_id
        and paid_at >= v_schedule.next_due_at - interval '7 days'
        and status = 'paid'
    ) into v_recently_paid;
    continue when v_recently_paid;

    -- Changed: dedup is now per calendar day, not "ever" -- this is what
    -- makes the fee accumulate on each subsequent daily run instead of
    -- charging exactly once and stopping.
    select exists (
      select 1 from charge
      where late_fee_for_schedule_id = v_schedule.id
        and late_fee_charge_date = current_date
    ) into v_already_charged_today;
    continue when v_already_charged_today;

    insert into charge (
      tenant_id, rental_id, customer_id, charge_type, amount,
      responsibility, approval_status, approved_at, late_fee_for_schedule_id, late_fee_charge_date
    ) values (
      v_schedule.tenant_id, v_schedule.rental_id, v_schedule.customer_id, 'late_fee', v_amount,
      'renter', 'approved', now(), v_schedule.id, current_date
    );
  end loop;
end;
$$ language plpgsql security definer set search_path = public;
