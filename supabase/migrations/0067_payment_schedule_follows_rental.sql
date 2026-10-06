-- Weekly payment schedule follows the rental's real dates.
--
-- Rules (weekly plan):
--   * First weekly payment is due 7 days after PICKUP: the planned pickup
--     while the rental is 'scheduled', then the actual start_at once it
--     becomes 'active'. (Previously fixed at scheduling time + 7 days.)
--   * When a rental is returned / closed / cancelled / terminated its
--     schedule is ended, so apply_late_fees() stops charging a rental that
--     is over. (Previously nothing ended it.)
--   * Changing the drop-off date alone does not move a due date.
--
-- The derived update runs from a trigger, so it must not require the
-- manage_pricing permission of whoever edited the rental. A transaction-
-- local flag lets ONLY this function through the payment_schedule guard;
-- direct edits of payment_schedule still require manage_pricing.

create or replace function guard_payment_schedule_pricing() returns trigger as $$
begin
  if coalesce(current_setting('app.payment_schedule_sync', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  perform reject_without_permission('manage_pricing');
  return coalesce(new, old);
end;
$$ language plpgsql set search_path = public;

drop trigger if exists payment_schedule_pricing_guard on payment_schedule;
create trigger payment_schedule_pricing_guard
  before insert or update on payment_schedule
  for each row execute function guard_payment_schedule_pricing();

create or replace function sync_payment_schedule_for_rental() returns trigger as $$
begin
  perform set_config('app.payment_schedule_sync', 'on', true);

  if new.status in ('returned', 'closed', 'cancelled', 'terminated') then
    update payment_schedule set status = 'ended'
    where rental_id = new.id and status = 'active';

  elsif new.status in ('active', 'extended') and new.start_at is not null
        and (old.status is distinct from new.status or old.start_at is distinct from new.start_at)
        and old.status = 'scheduled' then
    update payment_schedule set next_due_at = new.start_at + interval '7 days'
    where rental_id = new.id and status = 'active' and cadence = 'weekly';

  elsif new.status = 'scheduled' then
    update payment_schedule ps set next_due_at = b.pickup_at + interval '7 days'
    from booking b
    where b.id = new.booking_id
      and b.pickup_location_id is not null
      and b.pickup_at is not null
      and ps.rental_id = new.id and ps.status = 'active' and ps.cadence = 'weekly';
  end if;

  perform set_config('app.payment_schedule_sync', 'off', true);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists rental_sync_payment_schedule on rental;
create trigger rental_sync_payment_schedule
  after update of status, start_at, expected_return_at, pickup_confirmed_at on rental
  for each row execute function sync_payment_schedule_for_rental();

-- One-time cleanup: schedules still 'active' on rentals that are already over.
update payment_schedule ps set status = 'ended'
from rental r
where r.id = ps.rental_id
  and ps.status = 'active'
  and r.status in ('returned', 'closed', 'cancelled', 'terminated');
