-- 0078: cancel a rental before pickup and refund the card (Phase 4B).
-- The money rules (fees, free cancellations, the deposit coming back in full) come from the
-- approved cancellation policy and are applied HERE, in the database, so no caller can pass in
-- its own amounts. lib/cancellation-policy.ts holds the same rules for tests and previews.
--
-- Flow: request_cancellation() -> refund row (pending_approval, or approved when the optional
-- automatic switch is on) -> staff approve_refund() -> the app sends one Stripe refund
-- (claim_approved_refunds / finish_refund) -> deposit marked refunded.
-- Switch: tenant_setting 'auto_refunds_enabled' = 'on' (default OFF) lets a renter's own
-- clear-cut cancellation under the approval limit skip the staff tap.

create table if not exists refund (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid not null references rental(id),
  customer_id uuid not null references customer(id),
  reason text not null check (reason in ('renter_cancelled', 'no_show', 'requirement_failed', 'zivo_cancelled', 'fraud_or_identity')),
  initiated_by text not null check (initiated_by in ('renter', 'staff')),
  hours_until_pickup numeric,
  prior_free_cancellations integer not null default 0,
  rent_paid_cents integer not null default 0,
  deposit_paid_cents integer not null default 0,
  fee_cents integer not null default 0,
  fee_kind text not null default 'none' check (fee_kind in ('none', 'early', 'late')),
  rent_refund_cents integer not null default 0,
  deposit_refund_cents integer not null default 0,
  total_refund_cents integer not null default 0,
  manual_cents integer not null default 0,           -- part not paid by card: staff refunds it by hand
  needs_admin boolean not null default false,        -- over the approval limit
  status text not null default 'pending_approval' check (status in
    ('pending_approval', 'approved', 'processing', 'succeeded', 'failed', 'rejected', 'no_refund_due', 'manual_pending')),
  rules_snapshot jsonb,
  staff_note text,
  review_note text,
  approved_by uuid,
  approved_at timestamptz,
  processing_started_at timestamptz,
  stripe_refund_ids text[],
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (rental_id)
);
create index if not exists refund_status_idx on refund (tenant_id, status, created_at desc);

alter table refund enable row level security;
alter table refund force row level security;
drop policy if exists tenant_isolation_select on refund;
create policy tenant_isolation_select on refund for select using (tenant_id in (select app_current_tenant_ids()));
drop policy if exists customer_self_select on refund;
create policy customer_self_select on refund for select using (customer_id = app_current_customer_id());
-- No insert/update policies: only the functions below write it.

-- The fee rules. Mirrors settlePrePickup() in lib/cancellation-policy.ts.
create or replace function _settle_pre_pickup(
  p_reason text, p_hours numeric, p_prior_free integer, p_rent_cents integer, p_deposit_cents integer,
  p_late_fee_usd numeric, p_early_fee_usd numeric, p_free_per_90d integer, p_window_hours integer
) returns table (fee_cents integer, fee_kind text, rent_refund_cents integer, deposit_refund_cents integer)
language plpgsql immutable as $$
declare
  v_kind text := 'none';
  v_fee integer := 0;
  v_rent integer := greatest(0, coalesce(p_rent_cents, 0));
begin
  if p_reason in ('no_show', 'requirement_failed') then
    v_kind := 'late'; v_fee := round(coalesce(p_late_fee_usd, 0) * 100)::integer;
  elsif p_reason = 'renter_cancelled' then
    if p_hours > p_window_hours then
      if p_prior_free >= p_free_per_90d then
        v_kind := 'early'; v_fee := round(coalesce(p_early_fee_usd, 0) * 100)::integer;
      end if;
    else
      v_kind := 'late'; v_fee := round(coalesce(p_late_fee_usd, 0) * 100)::integer;
    end if;
  end if;  -- zivo_cancelled / fraud_or_identity: no fee
  v_fee := least(v_fee, v_rent);
  if v_fee = 0 then v_kind := 'none'; end if;
  fee_cents := v_fee; fee_kind := v_kind;
  rent_refund_cents := v_rent - v_fee;
  deposit_refund_cents := greatest(0, coalesce(p_deposit_cents, 0));
  return next;
end;
$$;

-- Cancel a rental that has not been picked up, and work out the refund.
-- p_dry_run = true only calculates (what the renter or staff sees before confirming).
create or replace function request_cancellation(
  p_rental_id uuid, p_reason text, p_initiator text, p_note text default null, p_dry_run boolean default true
) returns table (
  refund_id uuid, fee_cents integer, fee_kind text, rent_refund_cents integer, deposit_refund_cents integer,
  total_refund_cents integer, manual_cents integer, status text, needs_admin boolean, vehicle_released boolean
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_rental record;
  v_booking record;
  v_rules jsonb;
  v_rent integer;
  v_deposit integer;
  v_card integer;
  v_hours numeric;
  v_prior integer;
  v_s record;
  v_total integer;
  v_manual integer;
  v_threshold numeric;
  v_needs_admin boolean;
  v_status text;
  v_id uuid;
  v_released boolean := true;
begin
  if p_reason not in ('renter_cancelled', 'no_show', 'requirement_failed', 'zivo_cancelled', 'fraud_or_identity') then
    raise exception 'invalid_reason';
  end if;
  if p_initiator not in ('renter', 'staff') then raise exception 'invalid_initiator'; end if;
  if p_initiator = 'renter' and p_reason <> 'renter_cancelled' then raise exception 'invalid_reason'; end if;
  if auth.uid() is not null then perform reject_without_permission('issue_refund'); end if;

  select r.* into v_rental from rental r where r.id = p_rental_id for update;
  if not found then raise exception 'rental_not_found'; end if;
  if auth.uid() is not null and v_rental.tenant_id not in (select app_current_tenant_ids()) then
    raise exception 'rental_not_found';
  end if;
  if v_rental.status not in ('approved', 'scheduled') or v_rental.pickup_confirmed_at is not null then
    raise exception 'not_cancellable';
  end if;
  if exists (select 1 from refund f where f.rental_id = p_rental_id) then raise exception 'already_cancelled'; end if;

  select b.* into v_booking from booking b where b.id = v_rental.booking_id;
  v_rules := v_rental.governing_policy_snapshot -> 'cancellation';
  if v_rules is null or (v_rules ->> 'approved') is distinct from 'true' then
    select pv.rules -> 'cancellation' into v_rules from policy_version pv
     where pv.tenant_id = v_rental.tenant_id and pv.policy_type = 'pricing_and_mileage';
  end if;

  select coalesce(sum(round(p.amount * 100)) filter (where p.kind = 'rent'), 0)::integer,
         coalesce(sum(round(p.amount * 100)) filter (where p.kind = 'deposit'), 0)::integer,
         coalesce(sum(round(p.amount * 100)) filter (where p.provider = 'stripe'), 0)::integer
    into v_rent, v_deposit, v_card
    from payment p where p.rental_id = p_rental_id and p.status = 'paid';

  if (v_rent + v_deposit) > 0 and (v_rules is null or (v_rules ->> 'approved') is distinct from 'true') then
    raise exception 'rules_not_approved';
  end if;

  v_hours := case when v_booking.pickup_location_id is not null and v_booking.pickup_at is not null
                  then extract(epoch from (v_booking.pickup_at - now())) / 3600.0 else 100000 end;

  select count(*)::integer into v_prior from refund f
   where f.customer_id = v_rental.customer_id and f.reason = 'renter_cancelled' and f.fee_kind = 'none'
     and f.created_at > now() - interval '90 days';

  select * into v_s from _settle_pre_pickup(
    p_reason, v_hours, v_prior, v_rent, v_deposit,
    (v_rules ->> 'late_fee_usd')::numeric, (v_rules ->> 'early_fee_usd')::numeric,
    coalesce((v_rules ->> 'free_cancellations_per_90d')::integer, 0), coalesce((v_rules ->> 'late_window_hours')::integer, 24));

  v_total := v_s.rent_refund_cents + v_s.deposit_refund_cents;
  v_manual := greatest(0, v_total - v_card);
  v_threshold := coalesce((v_rules ->> 'admin_approval_threshold_usd')::numeric, 200);
  v_needs_admin := (v_total / 100.0) > v_threshold;

  v_status := case
    when v_total = 0 then 'no_refund_due'
    when p_initiator = 'renter' and p_reason = 'renter_cancelled' and not v_needs_admin and v_manual = 0
         and _setting_on(v_rental.tenant_id, 'auto_refunds_enabled', false) then 'approved'
    else 'pending_approval'
  end;

  if p_dry_run then
    return query select null::uuid, v_s.fee_cents, v_s.fee_kind, v_s.rent_refund_cents, v_s.deposit_refund_cents,
                        v_total, v_manual, v_status, v_needs_admin, true;
    return;
  end if;

  insert into refund (tenant_id, rental_id, customer_id, reason, initiated_by, hours_until_pickup, prior_free_cancellations,
                      rent_paid_cents, deposit_paid_cents, fee_cents, fee_kind, rent_refund_cents, deposit_refund_cents,
                      total_refund_cents, manual_cents, needs_admin, status, rules_snapshot, staff_note, completed_at)
  values (v_rental.tenant_id, p_rental_id, v_rental.customer_id, p_reason, p_initiator, least(v_hours, 99999), v_prior,
          v_rent, v_deposit, v_s.fee_cents, v_s.fee_kind, v_s.rent_refund_cents, v_s.deposit_refund_cents,
          v_total, v_manual, v_needs_admin, v_status, v_rules, left(p_note, 500),
          case when v_status = 'no_refund_due' then now() end)
  returning id into v_id;

  update rental set status = 'cancelled', needs_human_followup = false where id = p_rental_id;
  update booking set status = 'cancelled' where id = v_rental.booking_id;
  update slot_hold set status = 'released', released_reason = 'rental_cancelled', updated_at = now()
   where rental_id = p_rental_id and status in ('held', 'confirmed');
  update pay_request set status = 'cancelled', revoked_at = now() where rental_id = p_rental_id and status = 'open';

  -- Free the car. A staff member without fleet permission can still cancel; the car is then
  -- reported as not released so someone with that permission frees it.
  begin
    update vehicle set status = 'available'
     where status = 'reserved' and id in (select s.vehicle_id from rental_segment s where s.rental_id = p_rental_id);
  exception when others then
    v_released := false;
  end;

  insert into audit_event (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  values (v_rental.tenant_id, auth.uid(), 'rental_cancelled_before_pickup', 'rental', p_rental_id,
          jsonb_build_object('reason', p_reason, 'initiated_by', p_initiator, 'refund_id', v_id, 'fee_cents', v_s.fee_cents,
                             'fee_kind', v_s.fee_kind, 'total_refund_cents', v_total, 'status', v_status), 'request_cancellation');

  return query select v_id, v_s.fee_cents, v_s.fee_kind, v_s.rent_refund_cents, v_s.deposit_refund_cents,
                      v_total, v_manual, v_status, v_needs_admin, v_released;
end;
$$;

-- Staff: approve or reject a refund. Over the approval limit also needs the admin permission.
create or replace function approve_refund(p_refund_id uuid, p_approve boolean, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  if auth.uid() is not null then perform reject_without_permission('issue_refund'); end if;
  select * into v from refund f where f.id = p_refund_id for update;
  if not found or (auth.uid() is not null and v.tenant_id not in (select app_current_tenant_ids())) then
    raise exception 'refund_not_found';
  end if;
  if v.status <> 'pending_approval' then raise exception 'not_pending'; end if;
  if p_approve and v.needs_admin and auth.uid() is not null then perform reject_without_permission('manage_pricing_policy'); end if;
  if p_approve then
    update refund set status = 'approved', approved_by = auth.uid(), approved_at = now(), review_note = left(p_note, 500) where id = v.id;
  else
    update refund set status = 'rejected', approved_by = auth.uid(), approved_at = now(), review_note = left(p_note, 500), completed_at = now() where id = v.id;
  end if;
  insert into audit_event (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  values (v.tenant_id, auth.uid(), case when p_approve then 'refund_approved' else 'refund_rejected' end, 'refund', v.id,
          jsonb_build_object('total_refund_cents', v.total_refund_cents, 'note', left(p_note, 200)), 'approve_refund');
  return case when p_approve then 'approved' else 'rejected' end;
end;
$$;

-- Staff: put a failed refund back in line to be sent again.
create or replace function retry_refund(p_refund_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  if auth.uid() is not null then perform reject_without_permission('issue_refund'); end if;
  select * into v from refund f where f.id = p_refund_id for update;
  if not found or (auth.uid() is not null and v.tenant_id not in (select app_current_tenant_ids())) then
    raise exception 'refund_not_found';
  end if;
  if v.status <> 'failed' then raise exception 'not_failed'; end if;
  update refund set status = 'approved', error = null where id = v.id;
  return 'approved';
end;
$$;

-- Staff: the part paid by something other than the card was refunded by hand.
create or replace function mark_manual_refund_done(p_refund_id uuid, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  if auth.uid() is not null then perform reject_without_permission('issue_refund'); end if;
  select * into v from refund f where f.id = p_refund_id for update;
  if not found or (auth.uid() is not null and v.tenant_id not in (select app_current_tenant_ids())) then
    raise exception 'refund_not_found';
  end if;
  if v.status <> 'manual_pending' then raise exception 'not_manual_pending'; end if;
  update refund set status = 'succeeded', completed_at = now(), review_note = coalesce(left(p_note, 500), review_note) where id = v.id;
  return 'succeeded';
end;
$$;

-- Service: take approved refunds to send. A refund stuck in 'processing' for 15 minutes is offered
-- again; Stripe's idempotency key makes the repeat harmless.
create or replace function claim_approved_refunds(p_limit integer default 10)
returns table (refund_id uuid, tenant_id uuid, rental_id uuid, card_cents integer, intents jsonb)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ids uuid[];
begin
  with picked as (
    select f.id from refund f
     where f.status = 'approved' or (f.status = 'processing' and f.processing_started_at < now() - interval '15 minutes')
     order by f.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked
  ), upd as (
    update refund f set status = 'processing', processing_started_at = now()
      from picked where f.id = picked.id returning f.id
  )
  select coalesce(array_agg(upd.id), '{}') into v_ids from upd;

  return query
  select f.id, f.tenant_id, f.rental_id, (f.total_refund_cents - f.manual_cents),
         (select coalesce(jsonb_agg(jsonb_build_object('pi', x.pi, 'paid_cents', x.cents) order by x.pi), '[]'::jsonb)
            from (select p.metadata ->> 'payment_intent' as pi, sum(round(p.amount * 100))::integer as cents
                    from payment p
                   where p.rental_id = f.rental_id and p.provider = 'stripe' and p.status = 'paid'
                     and p.metadata ->> 'payment_intent' is not null
                   group by 1) x)
    from refund f where f.id = any(v_ids);
end;
$$;

-- Service: record how the Stripe refund went.
create or replace function finish_refund(p_refund_id uuid, p_ok boolean, p_stripe_refund_ids text[], p_error text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_new text;
begin
  select * into v from refund f where f.id = p_refund_id for update;
  if not found then raise exception 'refund_not_found'; end if;
  if v.status <> 'processing' then return v.status; end if;
  if not p_ok then
    update refund set status = 'failed', error = left(p_error, 300) where id = v.id;
    return 'failed';
  end if;
  v_new := case when v.manual_cents > 0 then 'manual_pending' else 'succeeded' end;
  update refund set status = v_new, stripe_refund_ids = p_stripe_refund_ids, error = null,
         completed_at = case when v_new = 'succeeded' then now() end
   where id = v.id;
  if v.deposit_refund_cents > 0 then
    update deposit set status = 'refunded', refunded_at = now(), refundable_amount = 0 where rental_id = v.rental_id and status = 'held';
  end if;
  insert into audit_event (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  values (v.tenant_id, null, 'refund_sent', 'refund', v.id,
          jsonb_build_object('total_refund_cents', v.total_refund_cents, 'card_cents', v.total_refund_cents - v.manual_cents), 'finish_refund');
  return v_new;
end;
$$;

revoke all on function _settle_pre_pickup(text, numeric, integer, integer, integer, numeric, numeric, integer, integer) from public, anon, authenticated;
revoke all on function request_cancellation(uuid, text, text, text, boolean) from public, anon;
grant execute on function request_cancellation(uuid, text, text, text, boolean) to authenticated;
revoke all on function approve_refund(uuid, boolean, text) from public, anon;
grant execute on function approve_refund(uuid, boolean, text) to authenticated;
revoke all on function retry_refund(uuid) from public, anon;
grant execute on function retry_refund(uuid) to authenticated;
revoke all on function mark_manual_refund_done(uuid, text) from public, anon;
grant execute on function mark_manual_refund_done(uuid, text) to authenticated;
revoke all on function claim_approved_refunds(integer) from public, anon, authenticated;
revoke all on function finish_refund(uuid, boolean, text[], text) from public, anon, authenticated;
