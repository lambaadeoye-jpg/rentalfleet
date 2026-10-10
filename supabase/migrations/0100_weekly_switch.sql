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
  created_at timestamptz not null default now(),
  unique (rental_id, to_plan)
);
create index if not exists plan_change_tenant_idx on plan_change (tenant_id, created_at desc);

alter table plan_change enable row level security;
alter table plan_change force row level security;
drop policy if exists tenant_isolation_select on plan_change;
create policy tenant_isolation_select on plan_change for select using (tenant_id in (select app_current_tenant_ids()));
-- No write policies: only the function below (and the service role) write.

-- 2. The switch -------------------------------------------------------------------------------------------------
-- Returns one of: switched, not_found, not_active, already_weekly, weekly_not_approved, bad_rate, billing_off,
-- card_required, not_paid, too_early.
create or replace function switch_rental_to_weekly(
  p_rental uuid, p_rate numeric, p_by text, p_actor uuid default null, p_consent text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_r record;
  v_rules jsonb;
  v_cap numeric;
  v_card record;
  v_due timestamptz;
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

  -- Renters can switch from day 3 (staff can do it any time). There is no end date: the offer stays open.
  -- The first weekly charge is at the end of the prepaid first week, or right away if that date has passed.
  if p_by = 'renter' and now() < v_r.start_at + interval '3 days' then return 'too_early'; end if;
  v_due := greatest(v_r.start_at + interval '7 days', now());

  insert into plan_change (tenant_id, rental_id, customer_id, from_plan, to_plan, weekly_rate_usd,
                           initiated_by, actor_user_id, consent_text, consented_at, card_last4)
  values (v_r.tenant_id, v_r.id, v_r.customer_id, 'daily', 'weekly', p_rate,
          p_by, p_actor, p_consent, case when p_consent is not null then now() end, v_card.last4)
  on conflict (rental_id, to_plan) do nothing;
  if not found then return 'already_weekly'; end if;

  -- First week is already paid: weeks_paid = 1, so the first weekly charge is on day 7.
  perform set_config('app.payment_schedule_sync', 'on', true);
  insert into payment_schedule (tenant_id, rental_id, cadence, next_due_at, amount, status, weeks_paid, rent_credit)
  values (v_r.tenant_id, v_r.id, 'weekly', v_due, p_rate, 'active', 1, 0);
  perform set_config('app.payment_schedule_sync', 'off', true);

  update rental set agreed_weekly_rate_usd = p_rate where id = v_r.id;
  return 'switched';
end;
$$;
revoke all on function switch_rental_to_weekly(uuid, numeric, text, uuid, text) from public, anon, authenticated;
grant execute on function switch_rental_to_weekly(uuid, numeric, text, uuid, text) to service_role;

-- 3. The day-3 offer ---------------------------------------------------------------------------------------------
alter table renter_notice drop constraint if exists renter_notice_kind_check;
alter table renter_notice add constraint renter_notice_kind_check check (kind in (
  'cancelled', 'refund_sent', 'payment_received', 'weekly_rent_charged', 'weekly_charge_failed',
  'checkin_day1', 'checkin_day3', 'referral_ask', 'card_updated', 'rent_due_tomorrow', 'weekly_offer'));

-- Same trigger as 0085, plus: a daily-plan rental (no weekly schedule) gets the weekly offer on day 3 instead of the
-- generic day-3 check-in, when weekly pricing is approved and automatic billing is on.
create or replace function trg_notice_rental_active() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_base timestamptz := coalesce(new.start_at, now());
  v_rules jsonb;
  v_offer boolean := false;
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    begin
      select rules into v_rules from policy_version
       where tenant_id = new.tenant_id and policy_type = 'pricing_and_mileage' and immutable = false;
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
        'weekly_offer:' || new.id, v_base + interval '3 days', 'renter_notices_enabled');
    else
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
