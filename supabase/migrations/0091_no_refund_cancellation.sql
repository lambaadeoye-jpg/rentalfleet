-- 0091: no refund of rent once a car is reserved (rental agreement clause 14).
-- Adds an optional rule cancellation.no_refund = true to the approved cancellation policy. When it is true:
--   * renter_cancelled, no_show and requirement_failed keep ALL rent paid (recorded as a 'late' fee equal to the rent);
--   * zivo_cancelled and fraud_or_identity still refund in full;
--   * the security deposit still comes back in full before pickup.
-- Nothing changes until staff turn it on and approve it on Staff -> Pricing; rentals already created keep the policy they
-- were booked under. Replaces request_cancellation() (copied from 0078 with one block added). Safe to run twice.

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

  -- No-refund policy: rent is kept when the renter cancels, no-shows or fails a requirement.
  -- Zivo's own cancellation and fraud found before pickup still refund in full.
  if coalesce((v_rules ->> 'no_refund')::boolean, false) and p_reason in ('renter_cancelled', 'no_show', 'requirement_failed') then
    v_s.fee_cents := v_rent;
    v_s.fee_kind := case when v_rent > 0 then 'late' else 'none' end;
    v_s.rent_refund_cents := 0;
  end if;

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