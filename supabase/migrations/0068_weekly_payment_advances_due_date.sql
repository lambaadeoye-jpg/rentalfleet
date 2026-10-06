-- Recording a weekly payment moves the next due date forward.
--
-- The payment table does not say what a payment was for, so coverage is
-- derived from the running total instead of per payment (idempotent, and
-- correct however payments are split):
--
--   rent_paid_total = all 'paid' payments on the rental - one week's rent
--                     (the refundable deposit equals one week's rent)
--   weeks_covered   = greatest(1, floor(total_paid / weekly_amount) - 1)
--   next_due_at     = start_at + 7 days * weeks_covered
--
-- Pickup requires a recorded payment, so week 1 is always treated as
-- covered. The due date only ever moves FORWARD, so recording a payment can
-- never create a late fee. Only active weekly schedules on active/extended
-- rentals are touched. Runs from a trigger, so it uses the same transaction-
-- local flag as 0067 to pass the payment_schedule pricing guard.

create or replace function advance_weekly_due_date() returns trigger as $$
declare
  v_start timestamptz;
  v_status text;
  v_sched record;
  v_total numeric;
  v_weeks int;
  v_new_due timestamptz;
begin
  if new.rental_id is null or new.status is distinct from 'paid' then
    return new;
  end if;

  select start_at, status into v_start, v_status from rental where id = new.rental_id;
  if v_start is null or v_status not in ('active', 'extended') then
    return new;
  end if;

  select id, amount, next_due_at into v_sched
  from payment_schedule
  where rental_id = new.rental_id and status = 'active' and cadence = 'weekly'
  limit 1;
  if v_sched.id is null or coalesce(v_sched.amount, 0) <= 0 then
    return new;
  end if;

  select coalesce(sum(amount), 0) into v_total
  from payment
  where rental_id = new.rental_id and status = 'paid';

  v_weeks := greatest(1, floor(v_total / v_sched.amount)::int - 1);
  v_new_due := v_start + (v_weeks * 7) * interval '1 day';

  if v_sched.next_due_at is null or v_new_due > v_sched.next_due_at then
    perform set_config('app.payment_schedule_sync', 'on', true);
    update payment_schedule set next_due_at = v_new_due where id = v_sched.id;
    perform set_config('app.payment_schedule_sync', 'off', true);
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists payment_advance_weekly_due on payment;
create trigger payment_advance_weekly_due
  after insert or update of amount, status on payment
  for each row execute function advance_weekly_due_date();
