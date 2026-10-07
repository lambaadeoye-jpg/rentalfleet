-- 0087: After a renter saves a new card (0086):
--   1) a failed weekly charge is retried right away with the new card (no waiting for the next retry slot), and
--   2) the renter gets a confirmation text.
--
-- How the retry works (no new state to keep in sync):
--   * claim_due_billing already finds schedules that are due. Now, when the NEWEST saved card is not the card used by the
--     last failed attempt for the current due date, the waiting rules (1/2/4 day spacing, 12 hours between tries) are
--     skipped and the charge is handed out at once. After that attempt the last card equals the newest card again, so the
--     normal rules resume. One new card = one immediate retry.
--   * That immediate retry may be an extra 5th attempt, so a renter who exhausted the 4 normal tries and then fixes
--     their card is still charged. A 5th attempt exists only for a changed card; nothing else can create one.
--   * Never more than one successful charge per rental per 20 hours, and nothing in flight: both rules are unchanged.
--   * The app calls the claim for just that renter the moment the Stripe webhook saves the card; the regular billing
--     job would also pick it up on its next run, so nothing depends on that one call succeeding.
--   * If the retry on the new card fails, the renter is told (and gets a fresh update-card link), even though it is not
--     one of the usual 1st/3rd-failure texts.
-- Confirmation text: new notice kind 'card_updated', queued when the card is saved (same switch, quiet hours and opt-out
-- list as the other renter notices; nothing is queued while renter_notices_enabled is off).
-- Safe to run twice.

-- ---------------------------------------------------------------------------------------------------------------
-- Allow a 5th attempt (used only after the card changed).
alter table billing_attempt drop constraint if exists billing_attempt_attempt_no_check;
alter table billing_attempt add constraint billing_attempt_attempt_no_check check (attempt_no between 1 and 5);

-- New notice kind.
alter table renter_notice drop constraint if exists renter_notice_kind_check;
alter table renter_notice add constraint renter_notice_kind_check check (kind in (
  'cancelled', 'refund_sent', 'payment_received', 'weekly_rent_charged', 'weekly_charge_failed',
  'checkin_day1', 'checkin_day3', 'referral_ask', 'card_updated'));

-- ---------------------------------------------------------------------------------------------------------------
-- Billing claim: same as 0080 plus (a) optional single-renter filter, (b) immediate retry on a changed card.
drop function if exists claim_due_billing(integer);
create or replace function claim_due_billing(p_limit integer default 10, p_customer uuid default null)
returns table (attempt_id uuid, tenant_id uuid, rental_id uuid, customer_id uuid, amount_cents integer,
               stripe_customer_id text, stripe_payment_method_id text, due_at timestamptz, attempt_no integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  r record;
  v_pm record;
  v_cents integer;
  v_last record;
  v_no integer;
  v_wait interval;
  v_new_card boolean;
  v_made uuid[] := '{}';
  v_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
begin
  -- 1) Attempts that crashed mid-flight: hand them out again (same id => same Stripe idempotency key).
  for r in
    select a.id from billing_attempt a
     where a.status = 'processing' and a.processing_started_at < now() - interval '15 minutes'
       and (p_customer is null or a.customer_id = p_customer)
     order by a.created_at limit v_limit for update skip locked
  loop
    update billing_attempt set processing_started_at = now() where id = r.id;
    v_made := v_made || r.id;
  end loop;

  -- 2) New attempts for schedules that are due.
  for r in
    select ps.id as schedule_id, ps.tenant_id, ps.rental_id, ps.next_due_at, ps.amount, rt.customer_id
      from payment_schedule ps
      join rental rt on rt.id = ps.rental_id
     where ps.status = 'active' and ps.cadence = 'weekly' and not ps.billing_paused
       and ps.next_due_at is not null and ps.next_due_at <= now()
       and coalesce(ps.amount, 0) > 0
       and rt.status in ('active', 'extended')
       and (p_customer is null or rt.customer_id = p_customer)
       and _setting_on(ps.tenant_id, 'weekly_billing_enabled', false)
     order by ps.next_due_at
     for update of ps skip locked
  loop
    exit when coalesce(array_length(v_made, 1), 0) >= v_limit;

    -- Nothing in flight for this schedule, and no success in the last 20 hours.
    continue when exists (select 1 from billing_attempt a where a.schedule_id = r.schedule_id and a.status = 'processing');
    continue when exists (select 1 from billing_attempt a where a.schedule_id = r.schedule_id and a.status = 'succeeded' and a.finished_at > now() - interval '20 hours');

    -- The last failed attempt for this due date (if any) and the card it used.
    select a.attempt_no, a.finished_at, a.payment_method_id into v_last from billing_attempt a
     where a.schedule_id = r.schedule_id and a.due_at = r.next_due_at and a.status = 'failed'
     order by a.attempt_no desc limit 1;
    v_no := coalesce(v_last.attempt_no, 0) + 1;

    select m.* into v_pm from customer_payment_method m
     where m.tenant_id = r.tenant_id and m.customer_id = r.customer_id
     order by m.created_at desc limit 1;
    continue when v_pm.id is null;

    -- A different card than the one that just failed: try it now, and allow one extra attempt (5th).
    v_new_card := v_last.attempt_no is not null and v_last.payment_method_id is distinct from v_pm.id;

    continue when v_no > case when v_new_card then 5 else 4 end;
    if not v_new_card then
      v_wait := case v_no when 1 then interval '0' when 2 then interval '1 day' when 3 then interval '2 days' else interval '4 days' end;
      continue when now() < r.next_due_at + v_wait;
      continue when v_last.finished_at is not null and now() < v_last.finished_at + interval '12 hours';
    end if;

    v_cents := round(r.amount * 100)::integer;
    continue when v_cents < 50 or v_cents > 500000;

    v_id := null;
    insert into billing_attempt (tenant_id, rental_id, schedule_id, customer_id, due_at, attempt_no, amount_cents, payment_method_id)
    values (r.tenant_id, r.rental_id, r.schedule_id, r.customer_id, r.next_due_at, v_no, v_cents, v_pm.id)
    on conflict (schedule_id, due_at, attempt_no) do nothing
    returning id into v_id;
    if v_id is not null then v_made := v_made || v_id; end if;
  end loop;

  return query
  select a.id, a.tenant_id, a.rental_id, a.customer_id, a.amount_cents, m.stripe_customer_id, m.stripe_payment_method_id, a.due_at, a.attempt_no
    from billing_attempt a join customer_payment_method m on m.id = a.payment_method_id
   where a.id = any(v_made);
end;
$$;
revoke all on function claim_due_billing(integer, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Failed-charge text: first and third failures as before, plus any failure on a freshly changed card.
create or replace function trg_notice_billing_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'succeeded' and old.status is distinct from 'succeeded' then
    perform _queue_renter_notice(new.tenant_id, new.customer_id, new.rental_id, 'weekly_rent_charged',
      jsonb_build_object('amount_cents', new.amount_cents), 'bill_ok:' || new.id);
  elsif new.status = 'failed' and old.status is distinct from 'failed'
        and (new.attempt_no in (1, 3)
             or (new.attempt_no > 1 and exists (
                   select 1 from billing_attempt p
                    where p.schedule_id = new.schedule_id and p.due_at = new.due_at and p.attempt_no < new.attempt_no
                      and p.payment_method_id is distinct from new.payment_method_id))) then
    perform _queue_renter_notice(new.tenant_id, new.customer_id, new.rental_id, 'weekly_charge_failed',
      jsonb_build_object('amount_cents', new.amount_cents, 'attempt_no', new.attempt_no), 'bill_fail:' || new.id);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- complete_card_update: same as 0086 plus the confirmation notice.
create or replace function complete_card_update(
  p_event_id text, p_session_id text, p_request_id uuid, p_stripe_customer text, p_pm text,
  p_brand text, p_last4 text, p_exp_month integer, p_exp_year integer, p_billing_name text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  insert into stripe_event (id) values (p_event_id) on conflict do nothing;
  if not found then return 'duplicate'; end if;

  select * into v from card_update_request r where r.id = p_request_id and r.stripe_session_id = p_session_id for update;
  if not found then
    delete from stripe_event where id = p_event_id; -- let Stripe's retry succeed once the session is attached
    return 'not_found';
  end if;
  if v.status = 'completed' then return 'already_done'; end if;
  if p_pm is null or p_pm !~ '^pm_[A-Za-z0-9_]+$' or p_stripe_customer is null or p_stripe_customer !~ '^cus_[A-Za-z0-9_]+$' then
    delete from stripe_event where id = p_event_id;
    return 'not_found';
  end if;

  insert into customer_payment_method (tenant_id, customer_id, stripe_customer_id, stripe_payment_method_id, brand, last4, exp_month, exp_year, billing_name, created_at)
  values (v.tenant_id, v.customer_id, p_stripe_customer, p_pm, left(p_brand, 30), left(p_last4, 4), p_exp_month, p_exp_year, left(p_billing_name, 120), clock_timestamp())
  on conflict (tenant_id, stripe_payment_method_id) do update set created_at = clock_timestamp();

  update card_update_request set status = 'completed', completed_at = now() where id = v.id;
  insert into audit_event (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  values (v.tenant_id, null, 'card_updated', 'customer', v.customer_id,
          jsonb_build_object('last4', left(p_last4, 4), 'brand', left(p_brand, 30)), 'complete_card_update');

  -- Confirmation text (swallows its own errors; never blocks saving the card).
  perform _queue_renter_notice(v.tenant_id, v.customer_id, null, 'card_updated',
    jsonb_build_object('last4', left(p_last4, 4), 'brand', left(p_brand, 30)), 'card_updated:' || v.id);
  return 'saved';
end;
$$;
revoke all on function complete_card_update(text, text, uuid, text, text, text, text, integer, integer, text) from public, anon, authenticated;
