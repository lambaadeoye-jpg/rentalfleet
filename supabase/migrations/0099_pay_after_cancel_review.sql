-- 0099: a payment that lands on a cancelled/revoked link goes to staff review instead of being booked silently.
-- Re-creates complete_pay_request (from 0076) with that one extra branch. Safe to re-run.

create or replace function complete_pay_request(
  p_event_id text, p_session_id text, p_request_id uuid, p_payment_intent text, p_amount_total_cents integer, p_card_name_matches boolean
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_hold uuid;
  v_dep record;
begin
  insert into stripe_event (id) values (p_event_id) on conflict do nothing;
  if not found then return 'duplicate'; end if;

  select * into v from pay_request p where p.id = p_request_id and p.stripe_session_id = p_session_id for update;
  if not found then
    -- Not recorded as handled, so Stripe's retry can succeed once the session is attached.
    delete from stripe_event where id = p_event_id;
    return 'not_found';
  end if;
  if v.status = 'paid' then return 'already_paid'; end if;
  -- Money arrived for a link staff had already cancelled or revoked. Record the intent and hold it for a
  -- person to decide (refund or honour); do not silently book it as a normal payment.
  if v.status in ('cancelled', 'review') or v.revoked_at is not null then
    update pay_request set status = 'review', stripe_payment_intent_id = coalesce(p_payment_intent, stripe_payment_intent_id),
           review_note = coalesce(v.review_note || ' | ', '') || 'Payment of ' || coalesce(p_amount_total_cents::text, '?') ||
                         ' cents arrived on a link that was ' || case when v.status = 'review' then 'already in review' else 'cancelled or revoked' end || '. Refund or honour it.'
     where id = v.id;
    return 'paid_after_cancel';
  end if;
  if p_amount_total_cents is distinct from (v.rent_cents + v.deposit_cents) then
    update pay_request set status = 'review', stripe_payment_intent_id = p_payment_intent,
           review_note = 'Stripe charged ' || coalesce(p_amount_total_cents::text, '?') || ' cents; expected ' || (v.rent_cents + v.deposit_cents)::text
     where id = v.id;
    return 'amount_mismatch';
  end if;

  if v.rent_cents > 0 then
    insert into payment (tenant_id, rental_id, customer_id, provider, provider_payment_id, method_type, amount, status, paid_at, kind, metadata)
    values (v.tenant_id, v.rental_id, v.customer_id, 'stripe', p_payment_intent || '#rent', 'card', v.rent_cents / 100.0, 'paid', now(), 'rent',
            jsonb_build_object('pay_request_id', v.id, 'payment_intent', p_payment_intent));
  end if;
  if v.deposit_cents > 0 then
    insert into payment (tenant_id, rental_id, customer_id, provider, provider_payment_id, method_type, amount, status, paid_at, kind, metadata)
    values (v.tenant_id, v.rental_id, v.customer_id, 'stripe', p_payment_intent || '#deposit', 'card', v.deposit_cents / 100.0, 'paid', now(), 'deposit',
            jsonb_build_object('pay_request_id', v.id, 'payment_intent', p_payment_intent));
    select d.id, d.amount_collected, d.refundable_amount into v_dep from deposit d where d.rental_id = v.rental_id and d.status = 'held';
    if found then
      update deposit set amount_collected = v_dep.amount_collected + v.deposit_cents / 100.0,
                         refundable_amount = coalesce(v_dep.refundable_amount, v_dep.amount_collected) + v.deposit_cents / 100.0
       where id = v_dep.id;
    else
      insert into deposit (tenant_id, rental_id, amount_collected, refundable_amount, status)
      values (v.tenant_id, v.rental_id, v.deposit_cents / 100.0, v.deposit_cents / 100.0, 'held');
    end if;
  end if;

  update pay_request set status = 'paid', paid_at = now(), stripe_payment_intent_id = p_payment_intent, card_name_matches = p_card_name_matches
   where id = v.id;

  -- A pickup time held "until payment" becomes firm now.
  select h.id into v_hold from slot_hold h where h.rental_id = v.rental_id and h.status = 'held' and h.expires_at > now() limit 1;
  if v_hold is not null then perform confirm_pickup_slot(v_hold, null, 'payment'); end if;
  return 'paid';
end;
$$;
