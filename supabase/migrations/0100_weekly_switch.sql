-- 0100: Switch a daily rental to the weekly plan (offered on day 3).
--
-- Business rules (decided with the owner):
--   * The 7-day minimum and the deposit do not change.
--   * A renter who starts on the daily plan has prepaid a fixed 7-day term. From day 3 they can move to the weekly
--     plan. The week they already paid for stays paid (no credit, no refund of the difference). The weekly rate
--     starts at the end of that first week (or at once if the switch is made later) and is charged automatically
--     to the card on file.
--   * The weekly plan REQUIRES a saved card and the tenant's weekly_billing_enabled switch. Without both, the
--     switch is refused (otherwise the renter would keep the car with nothing ever charged).
--   * One switch per rental. It is recorded in plan_change with the renter's consent text.
--   * Days the renter already paid for beyond the first week are credited: the first weekly charge moves out by
--     that many days (payment_schedule.due_offset), so nobody pays twice for the same days.
--   * The day the offer opens is a business-wide setting (tenant_setting 'weekly_offer_day', default 3, 1 to 30),
--     so it can be tested (for example 3 days against 7 days). Each switch records the day that was in force.
--
-- What this adds:
--   1. plan_change: the record of each switch (read-only for staff; written only by the function below).
--   2. switch_rental_to_weekly(...): the only way to switch. Service role only; the app checks who is asking.
--   3. 'weekly_offer' notice kind, queued for day 3 of a daily rental (replaces the generic day-3 check-in there).
-- Safe to run twice.

-- 1. Record of plan changes -------------------------------------------------------------------------------------
create table if not exists plan_change (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid not null references rental(id),
  customer_id uuid not null references customer(id),
  from_plan text not null check (from_plan in ('daily', 'weekly')),
  to_plan text not null check (to_plan in ('daily', 'weekly')),
  weekly_rate_usd numeric(14,2) not null check (weekly_rate_usd > 0),
  initiated_by text not null check (initiated_by in ('renter', 'staff')),
  actor_user_id uuid,
  consent_text text,
  consented_at timestamptz,
  card_last4 text,
  offer_day integer,
  credit_days integer not null default 0,
  created_at timestamptz not null default now(),
  unique (rental_id, to_plan)
);
alter table plan_change add column if not exists offer_day integer;
alter table plan_change add column if not exists credit_days integer not null default 0;

-- Days already paid for beyond the first week push the first weekly charge (and every one after it) out by this much.
alter table payment_schedule add column if not exists due_offset interval not null default '0';

-- The day the weekly offer opens (business-wide setting). Always a whole number from 1 to 30; default 3.
create or replace function _weekly_offer_day(p_tenant uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when ts.value ~ '^[0-9]{1,2}$' and ts.value::int between 1 and 30 then ts.value::int end
       from tenant_setting ts where ts.tenant_id = p_tenant and ts.key = 'weekly_offer_day'),
    3)
$$;
revoke all on function _weekly_offer_day(uuid) from public, anon, authenticated;
create index if not exists plan_change_tenant_idx on plan_change (tenant_id, created_at desc);

alter table plan_change enable row level security;
alter table plan_change force row level security;
drop policy if exists tenant_isolation_select on plan_change;
create policy tenant_isolation_select on plan_change for select using (tenant_id in (select app_current_tenant_ids()));
-- No write policies: only the function below (and the service role) write.


-- The weekly due date now includes the credit offset (0069's versions, plus + due_offset).
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

  select id, amount, next_due_at, rent_credit, weeks_paid, due_offset into v_ps
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
    v_due := v_start + (greatest(1, v_weeks) * 7) * interval '1 day' + v_ps.due_offset;
    if v_ps.next_due_at is null or v_due > v_ps.next_due_at then
      update payment_schedule set next_due_at = v_due where id = v_ps.id;
    end if;
  end if;
  perform set_config('app.payment_schedule_sync', 'off', true);

  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke all on function advance_weekly_due_date() from public, anon, authenticated;

create or replace function sync_payment_schedule_for_rental() returns trigger as $$
begin
  perform set_config('app.payment_schedule_sync', 'on', true);

  if new.status in ('returned', 'closed', 'cancelled', 'terminated') then
    update payment_schedule set status = 'ended'
    where rental_id = new.id and status = 'active';

  elsif new.status in ('active', 'extended') and new.start_at is not null
        and old.status = 'scheduled' then
    update payment_schedule
    set next_due_at = new.start_at + (greatest(1, weeks_paid) * 7) * interval '1 day' + due_offset
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
revoke all on function sync_payment_schedule_for_rental() from public, anon, authenticated;

-- 2. The switch -------------------------------------------------------------------------------------------------
-- Returns one of: switched, not_found, not_active, already_weekly, weekly_not_approved, bad_rate, billing_off,
-- card_required, not_paid, too_early.
-- p_paid_through: the date the renter's rent already covers (end of the first week plus any extra days they paid
-- for). The app works it out from what was paid; the first weekly charge is on that date, or right away if it has
-- passed. p_remainder: leftover money that did not make a whole day, carried as rent credit.
drop function if exists switch_rental_to_weekly(uuid, numeric, text, uuid, text);
create or replace function switch_rental_to_weekly(
  p_rental uuid, p_rate numeric, p_by text, p_actor uuid default null, p_consent text default null,
  p_paid_through timestamptz default null, p_remainder numeric default 0, p_credit_days integer default 0)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_r record;
  v_rules jsonb;
  v_cap numeric;
  v_card record;
  v_term_end timestamptz;
  v_paid timestamptz;
  v_due timestamptz;
  v_day integer;
begin
  if p_by not in ('renter', 'staff') then return 'bad_rate'; end if;

  select id, tenant_id, customer_id, status, start_at into v_r from rental where id = p_rental for update;
  if v_r.id is null then return 'not_found'; end if;
  if v_r.status not in ('active', 'extended') or v_r.start_at is null then return 'not_active'; end if;

  if exists (select 1 from payment_schedule where rental_id = v_r.id and cadence = 'weekly' and status = 'active')
     or exists (select 1 from plan_change where rental_id = v_r.id and to_plan = 'weekly') then
    return 'already_weekly';
  end if;

  select rules into v_rules from policy_version
   where tenant_id = v_r.tenant_id and policy_type = 'pricing_and_mileage' and immutable = false;
  if coalesce((v_rules ->> 'weekly_approved')::boolean, false) is not true then return 'weekly_not_approved'; end if;
  begin
    v_cap := (v_rules ->> 'weekly_rate_usd')::numeric;
  exception when others then
    v_cap := null;
  end;
  if v_cap is null or v_cap <= 0 then return 'weekly_not_approved'; end if;
  -- The app works out the rate (insurance discount included); it can never be above the approved weekly rate.
  if p_rate is null or p_rate <= 0 or p_rate > v_cap then return 'bad_rate'; end if;

  if not _setting_on(v_r.tenant_id, 'weekly_billing_enabled', false) then return 'billing_off'; end if;

  select m.last4 into v_card from customer_payment_method m
   where m.tenant_id = v_r.tenant_id and m.customer_id = v_r.customer_id
   order by m.created_at desc limit 1;
  if not found then return 'card_required'; end if;

  -- The prepaid daily week must actually be paid, or the switch would hand out a free week.
  if not exists (select 1 from payment where rental_id = v_r.id and kind = 'rent' and status = 'paid') then
    return 'not_paid';
  end if;

  -- Renters can switch once the offer day has been reached (staff any time). The offer never expires.
  v_day := _weekly_offer_day(v_r.tenant_id);
  if p_by = 'renter' and now() < v_r.start_at + make_interval(days => v_day) then return 'too_early'; end if;

  -- Credit for days already paid beyond the first week: never earlier than the end of the first week, and a sane
  -- upper limit so a bad number can't push billing out for months.
  v_term_end := v_r.start_at + interval '7 days';
  v_paid := greatest(coalesce(p_paid_through, v_term_end), v_term_end);
  if v_paid > now() + interval '90 days' then return 'bad_rate'; end if;
  if coalesce(p_remainder, 0) < 0 or coalesce(p_remainder, 0) >= p_rate then return 'bad_rate'; end if;
  v_due := greatest(v_paid, now());

  insert into plan_change (tenant_id, rental_id, customer_id, from_plan, to_plan, weekly_rate_usd,
                           initiated_by, actor_user_id, consent_text, consented_at, card_last4, offer_day, credit_days)
  values (v_r.tenant_id, v_r.id, v_r.customer_id, 'daily', 'weekly', p_rate,
          p_by, p_actor, p_consent, case when p_consent is not null then now() end, v_card.last4, v_day,
          greatest(0, least(coalesce(p_credit_days, 0), 90)))
  on conflict (rental_id, to_plan) do nothing;
  if not found then return 'already_weekly'; end if;

  -- First week is already paid: weeks_paid = 1. due_offset keeps every later due date in step with the credit.
  perform set_config('app.payment_schedule_sync', 'on', true);
  insert into payment_schedule (tenant_id, rental_id, cadence, next_due_at, amount, status, weeks_paid, rent_credit, due_offset)
  values (v_r.tenant_id, v_r.id, 'weekly', v_due, p_rate, 'active', 1, coalesce(p_remainder, 0), v_due - v_term_end);
  perform set_config('app.payment_schedule_sync', 'off', true);

  update rental set agreed_weekly_rate_usd = p_rate where id = v_r.id;
  return 'switched';
end;
$$;
revoke all on function switch_rental_to_weekly(uuid, numeric, text, uuid, text, timestamptz, numeric, integer) from public, anon, authenticated;
grant execute on function switch_rental_to_weekly(uuid, numeric, text, uuid, text, timestamptz, numeric, integer) to service_role;

-- 3. The day-3 offer ---------------------------------------------------------------------------------------------
alter table renter_notice drop constraint if exists renter_notice_kind_check;
alter table renter_notice add constraint renter_notice_kind_check check (kind in (
  'cancelled', 'refund_sent', 'payment_received', 'weekly_rent_charged', 'weekly_charge_failed',
  'checkin_day1', 'checkin_day3', 'referral_ask', 'card_updated', 'rent_due_tomorrow', 'weekly_offer'));

-- Same trigger as 0085, plus: a daily-plan rental (no weekly schedule) gets the weekly offer on day 3 instead of the
-- generic day-3 check-in (when the offer day is 3; otherwise both are sent), when weekly pricing is approved and automatic billing is on.
create or replace function trg_notice_rental_active() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_base timestamptz := coalesce(new.start_at, now());
  v_rules jsonb;
  v_offer boolean := false;
  v_day integer := 3;
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    begin
      select rules into v_rules from policy_version
       where tenant_id = new.tenant_id and policy_type = 'pricing_and_mileage' and immutable = false;
      v_day := _weekly_offer_day(new.tenant_id);
      v_offer := coalesce((v_rules ->> 'weekly_approved')::boolean, false)
             and not exists (select 1 from payment_schedule where rental_id = new.id and cadence = 'weekly' and status = 'active')
             and _setting_on(new.tenant_id, 'weekly_billing_enabled', false);
    exception when others then
      v_offer := false;
    end;

    perform _queue_renter_notice(new.tenant_id, new.customer_id, new.id, 'checkin_day1', '{}'::jsonb,
      'checkin1:' || new.id, v_base + interval '1 day', 'renter_checkins_enabled');
    if v_offer then
      perform _queue_renter_notice(new.tenant_id, new.customer_id, new.id, 'weekly_offer', '{}'::jsonb,
        'weekly_offer:' || new.id, v_base + make_interval(days => v_day), 'renter_notices_enabled');
    end if;
    -- The offer takes the place of the day-3 check-in only when it is sent on day 3.
    if not (v_offer and v_day = 3) then
      perform _queue_renter_notice(new.tenant_id, new.customer_id, new.id, 'checkin_day3', '{}'::jsonb,
        'checkin3:' || new.id, v_base + interval '3 days', 'renter_checkins_enabled');
    end if;
    perform _queue_renter_notice(new.tenant_id, new.customer_id, new.id, 'referral_ask', '{}'::jsonb,
      'referral_ask:' || new.id, v_base + interval '8 days', 'referral_asks_enabled');
  end if;
  return new;
exception when others then
  raise warning 'rental active notices not queued: %', sqlerrm;
  return new;
end;
$$;
revoke all on function trg_notice_rental_active() from public, anon, authenticated;
drop trigger if exists notice_rental_active on rental;
create trigger notice_rental_active after insert or update of status on rental
  for each row execute function trg_notice_rental_active();
