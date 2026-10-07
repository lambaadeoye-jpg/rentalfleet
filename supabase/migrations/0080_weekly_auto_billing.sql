-- 0080: Weekly auto-billing. Charges the renter's saved card for each week of rent as it comes due.
--
-- How it fits with what already exists:
--   * payment_schedule.next_due_at is the single source of "what is due" (0067/0069). A paid rent row
--     advances it by a week through the existing trigger, so this migration never touches due dates.
--   * Switch: tenant_setting 'weekly_billing_enabled' = 'on' (default OFF). Setting it to 'off' stops charging at once.
--   * Staff can pause one rental (payment_schedule.billing_paused) without ending the schedule.
--   * Retries: up to 4 attempts per due date, at the due time, +1 day, +2 days, +4 days. After the last failure
--     the rental is flagged for staff (needs_human_followup). Nothing is auto-suspended or recovered.
--   * Safety: never more than one successful charge per rental in 20 hours, so a long outage or switching this on
--     late cannot charge several weeks in one run. Stripe's idempotency key (one per attempt) makes a retry of a
--     crashed attempt safe.
--   * Late fees keep working as before (charge rows from apply_late_fees); this does not collect them.

alter table payment_schedule add column if not exists billing_paused boolean not null default false;

create table if not exists billing_attempt (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid not null references rental(id),
  schedule_id uuid not null references payment_schedule(id),
  customer_id uuid not null references customer(id),
  due_at timestamptz not null,
  attempt_no integer not null check (attempt_no between 1 and 4),
  amount_cents integer not null check (amount_cents between 50 and 500000),
  payment_method_id uuid references customer_payment_method(id),
  status text not null default 'processing' check (status in ('processing', 'succeeded', 'failed')),
  stripe_payment_intent_id text,
  error text,
  processing_started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (schedule_id, due_at, attempt_no)
);
create index if not exists billing_attempt_rental_idx on billing_attempt (rental_id, created_at desc);

alter table billing_attempt enable row level security;
alter table billing_attempt force row level security;
drop policy if exists tenant_isolation_select on billing_attempt;
create policy tenant_isolation_select on billing_attempt for select using (tenant_id in (select app_current_tenant_ids()));
-- No write policies: only the service role writes.

-- Service (n8n -> app): pick the charges that are due now. Returns each attempt to send to Stripe.
create or replace function claim_due_billing(p_limit integer default 10)
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
  v_made uuid[] := '{}';
  v_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
begin
  -- 1) Attempts that crashed mid-flight: hand them out again (same id => same Stripe idempotency key).
  for r in
    select a.id from billing_attempt a
     where a.status = 'processing' and a.processing_started_at < now() - interval '15 minutes'
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
       and _setting_on(ps.tenant_id, 'weekly_billing_enabled', false)
     order by ps.next_due_at
     for update of ps skip locked
  loop
    exit when coalesce(array_length(v_made, 1), 0) >= v_limit;

    -- Nothing in flight for this schedule, and no success in the last 20 hours.
    continue when exists (select 1 from billing_attempt a where a.schedule_id = r.schedule_id and a.status = 'processing');
    continue when exists (select 1 from billing_attempt a where a.schedule_id = r.schedule_id and a.status = 'succeeded' and a.finished_at > now() - interval '20 hours');

    -- Which attempt is this for this due date? Max 4; spaced out.
    select a.attempt_no, a.finished_at into v_last from billing_attempt a
     where a.schedule_id = r.schedule_id and a.due_at = r.next_due_at and a.status = 'failed'
     order by a.attempt_no desc limit 1;
    v_no := coalesce(v_last.attempt_no, 0) + 1;
    continue when v_no > 4;
    v_wait := case v_no when 1 then interval '0' when 2 then interval '1 day' when 3 then interval '2 days' else interval '4 days' end;
    continue when now() < r.next_due_at + v_wait;
    continue when v_last.finished_at is not null and now() < v_last.finished_at + interval '12 hours';

    v_cents := round(r.amount * 100)::integer;
    continue when v_cents < 50 or v_cents > 500000;

    select m.* into v_pm from customer_payment_method m
     where m.tenant_id = r.tenant_id and m.customer_id = r.customer_id
     order by m.created_at desc limit 1;
    continue when v_pm.id is null;

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

-- Service: record the result of one attempt.
create or replace function finish_billing_attempt(p_attempt_id uuid, p_ok boolean, p_payment_intent text, p_error text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  a record;
begin
  select * into a from billing_attempt where id = p_attempt_id for update;
  if not found then return 'not_found'; end if;
  if a.status <> 'processing' then return a.status; end if;

  if p_ok then
    if p_payment_intent is null or p_payment_intent !~ '^pi_[A-Za-z0-9_]+$' then
      update billing_attempt set status = 'failed', error = 'bad_payment_intent', finished_at = now() where id = a.id;
      return 'failed';
    end if;
    update billing_attempt set status = 'succeeded', stripe_payment_intent_id = p_payment_intent, finished_at = now() where id = a.id;
    if not exists (select 1 from payment where tenant_id = a.tenant_id and provider = 'stripe' and provider_payment_id = p_payment_intent || '#rent') then
      insert into payment (tenant_id, rental_id, customer_id, provider, provider_payment_id, method_type, amount, status, paid_at, kind, metadata)
      values (a.tenant_id, a.rental_id, a.customer_id, 'stripe', p_payment_intent || '#rent', 'card', a.amount_cents / 100.0, 'paid', now(), 'rent',
              jsonb_build_object('payment_intent', p_payment_intent, 'source', 'weekly_billing', 'billing_attempt_id', a.id, 'due_at', a.due_at));
    end if;
    insert into audit_event (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
    values (a.tenant_id, null, 'weekly_rent_charged', 'rental', a.rental_id,
            jsonb_build_object('amount_cents', a.amount_cents, 'attempt_no', a.attempt_no, 'payment_intent', p_payment_intent), 'finish_billing_attempt');
    return 'succeeded';
  end if;

  update billing_attempt set status = 'failed', error = left(coalesce(p_error, 'failed'), 200), finished_at = now() where id = a.id;
  if a.attempt_no >= 4 then
    update rental set needs_human_followup = true where id = a.rental_id;
  end if;
  insert into audit_event (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  values (a.tenant_id, null, 'weekly_rent_charge_failed', 'rental', a.rental_id,
          jsonb_build_object('amount_cents', a.amount_cents, 'attempt_no', a.attempt_no, 'error', left(coalesce(p_error, 'failed'), 200)), 'finish_billing_attempt');
  return 'failed';
end;
$$;

-- Staff: pause or resume automatic charging for one rental.
create or replace function set_billing_paused(p_rental_id uuid, p_paused boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
begin
  perform reject_without_permission('manage_pricing');
  select tenant_id into v_tenant from rental where id = p_rental_id;
  if v_tenant is null or v_tenant not in (select app_current_tenant_ids()) then
    raise exception 'Rental not found';
  end if;
  perform set_config('app.payment_schedule_sync', 'on', true);
  update payment_schedule set billing_paused = coalesce(p_paused, false) where rental_id = p_rental_id and status = 'active' and cadence = 'weekly';
  perform set_config('app.payment_schedule_sync', 'off', true);
  insert into audit_event (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  values (v_tenant, auth.uid(), case when p_paused then 'billing_paused' else 'billing_resumed' end, 'rental', p_rental_id, '{}'::jsonb, 'set_billing_paused');
end;
$$;

revoke all on function claim_due_billing(integer) from public, anon, authenticated;
revoke all on function finish_billing_attempt(uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function set_billing_paused(uuid, boolean) from public, anon;
grant execute on function set_billing_paused(uuid, boolean) to authenticated;
