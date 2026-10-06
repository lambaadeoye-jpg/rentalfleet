-- Insurance arrangement + insured discount + separate refundable deposit.
-- Backend-only mechanism: renters never see this logic.
--
--  * rental stores the arrangement ('own' insurance -> % discount, or
--    'via_provider' -> fixed weekly amount comes off because the renter pays
--    the provider directly), the locked weekly rate, and the deposit that
--    must be collected before pickup.
--  * payment.kind separates rent from the refundable deposit.
--  * Weekly due date is now tracked incrementally (rent_credit / weeks_paid
--    on payment_schedule) instead of derived from a total, so a mid-rental
--    rate change can never corrupt it. Replaces the 0068 trigger.
--  * apply_late_fees(): the old "was anything paid recently" shortcut is
--    removed (a payment at pickup suppressed fees for the first due date);
--    the due date now only advances when rent is actually paid, so
--    "overdue" means unpaid. Only open rentals are charged.
--  Everything is idempotent.

alter table rental
  add column if not exists insurance_arrangement text check (insurance_arrangement in ('own', 'via_provider')),
  add column if not exists agreed_weekly_rate_usd numeric(14,2),
  add column if not exists deposit_required_usd numeric(14,2);

alter table payment
  add column if not exists kind text not null default 'rent' check (kind in ('rent', 'deposit'));

alter table payment_schedule
  add column if not exists rent_credit numeric(14,2) not null default 0,
  add column if not exists weeks_paid int not null default 0;

-- Incremental weekly due-date tracking ------------------------------------
drop trigger if exists payment_advance_weekly_due on payment;

create or replace function advance_weekly_due_date() returns trigger as $$
declare
  v_ps record;
  v_start timestamptz;
  v_status text;
  v_credit numeric;
  v_weeks int;
  v_due timestamptz;
begin
  if new.rental_id is null or new.kind <> 'rent' or new.status is distinct from 'paid' then
    return new;
  end if;

  select id, amount, next_due_at, rent_credit, weeks_paid into v_ps
  from payment_schedule
  where rental_id = new.rental_id and status = 'active' and cadence = 'weekly'
  limit 1
  for update;
  if v_ps.id is null or coalesce(v_ps.amount, 0) <= 0 then
    return new;
  end if;

  v_credit := v_ps.rent_credit + new.amount;
  v_weeks := v_ps.weeks_paid;
  while v_credit >= v_ps.amount loop
    v_credit := v_credit - v_ps.amount;
    v_weeks := v_weeks + 1;
  end loop;

  perform set_config('app.payment_schedule_sync', 'on', true);
  update payment_schedule set rent_credit = v_credit, weeks_paid = v_weeks where id = v_ps.id;

  select start_at, status into v_start, v_status from rental where id = new.rental_id;
  if v_start is not null and v_status in ('active', 'extended') then
    v_due := v_start + (greatest(1, v_weeks) * 7) * interval '1 day';
    if v_ps.next_due_at is null or v_due > v_ps.next_due_at then
      update payment_schedule set next_due_at = v_due where id = v_ps.id;
    end if;
  end if;
  perform set_config('app.payment_schedule_sync', 'off', true);

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger payment_advance_weekly_due
  after insert on payment
  for each row execute function advance_weekly_due_date();

-- 0067's sync function, now honoring rent already paid before pickup.
create or replace function sync_payment_schedule_for_rental() returns trigger as $$
begin
  perform set_config('app.payment_schedule_sync', 'on', true);

  if new.status in ('returned', 'closed', 'cancelled', 'terminated') then
    update payment_schedule set status = 'ended'
    where rental_id = new.id and status = 'active';

  elsif new.status in ('active', 'extended') and new.start_at is not null
        and old.status = 'scheduled' then
    update payment_schedule
    set next_due_at = new.start_at + (greatest(1, weeks_paid) * 7) * interval '1 day'
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

-- Late fees: overdue now means unpaid -----------------------------------
create or replace function apply_late_fees() returns void as $$
declare
  v_schedule record;
  v_rules jsonb;
  v_late_fee jsonb;
  v_grace_days int;
  v_amount numeric;
  v_already_charged_today boolean;
begin
  for v_schedule in
    select ps.id, ps.rental_id, ps.next_due_at, r.tenant_id, r.customer_id
    from payment_schedule ps
    join rental r on r.id = ps.rental_id
    where ps.status = 'active'
      and ps.next_due_at < now()
      and r.status in ('active', 'extended', 'return_pending', 'delinquent', 'suspended')
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

-- Lets the app ask "may the signed-in staff member change pricing?" before
-- a rate change that doesn't happen to write to a guarded table.
create or replace function can_manage_pricing() returns boolean as $$
  select app_has_permission('manage_pricing');
$$ language sql stable security definer set search_path = public;
