-- 0099: audit follow-ups. (1) A payment that lands on a cancelled/revoked pay link goes to staff review instead of being
-- booked silently. (2) One open telematics alert per vehicle and type. (3) Field runners cannot read office-only money,
-- messaging and audit tables. (4) Signing and payment links are office-only, and a payment link cannot exceed what the
-- rental owes. Safe to re-run.

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

-- ---------------------------------------------------------------------------
-- Part 2 (V3.0 audit follow-up)
-- ---------------------------------------------------------------------------

-- A. One open telematics alert per vehicle and type, enforced by the database. (The app already checks; this
--    closes the race when two webhooks arrive together.) Older duplicates are marked resolved first.
update telematics_alert a set status = 'resolved', resolved_at = coalesce(a.resolved_at, now())
 where a.status = 'open'
   and exists (select 1 from telematics_alert b
                where b.vehicle_id = a.vehicle_id and b.alert_type = a.alert_type and b.status = 'open'
                  and (b.created_at, b.id) > (a.created_at, a.id));
create unique index if not exists uq_telematics_alert_open on telematics_alert (vehicle_id, alert_type) where status = 'open';

-- B. Field runners (field_staff only) cannot read office-only money, messaging and audit tables, even by
--    calling the data API directly. Their pages read none of these. A restrictive policy only ever narrows
--    access; admins, other staff, renters and the service role are untouched.
create or replace function app_is_field_runner() returns boolean as $$
  select auth.uid() is not null
     and exists (select 1 from membership m join role r on r.id = m.role_id where m.user_id = auth.uid())
     and not exists (select 1 from membership m join role r on r.id = m.role_id where m.user_id = auth.uid() and r.name <> 'field_staff')
$$ language sql stable security definer set search_path = public;
revoke all on function app_is_field_runner() from public, anon;
grant execute on function app_is_field_runner() to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'ledger_entry', 'audit_event', 'call_review', 'call_review_report', 'outreach_message', 'pay_request',
    'customer_payment_method', 'billing_attempt', 'generated_document', 'red_flag', 'rental_ban', 'renter_notice',
    'card_update_request', 'sign_request', 'upload_request', 'toll_transaction', 'lead_stage_history',
    'support_ticket', 'customer_note', 'referral', 'refund', 'recovery_case', 'recovery_expense', 'charge'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists runner_no_read on %I', t);
      execute format('create policy runner_no_read on %I as restrictive for select to authenticated using (not app_is_field_runner())', t);
    end if;
  end loop;
end $$;

-- C. Creating a signing or payment link is office work, and a payment link can never ask for more than the
--    rental itself says is owed. (The renter portal's "Pay now" calls these with the service role, which is
--    unchanged.)
create or replace function create_pay_request(
  p_rental_id uuid, p_token_hash text, p_rent_cents integer, p_deposit_cents integer, p_terms jsonb, p_terms_hash text, p_hours integer default 72
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_rental record;
  v_id uuid;
  v_quoted numeric;
  v_rent_cap numeric;
begin
  select r.id, r.tenant_id, r.customer_id, r.status, r.booking_id, r.agreed_weekly_rate_usd, r.deposit_required_usd into v_rental from rental r where r.id = p_rental_id;
  if not found then raise exception 'rental_not_found'; end if;
  if auth.uid() is not null and v_rental.tenant_id not in (select app_current_tenant_ids()) then raise exception 'rental_not_found'; end if;
  if auth.uid() is not null and app_is_field_runner() then raise exception 'permission_denied'; end if;
  if not _setting_on(v_rental.tenant_id, 'payments_enabled', false) then raise exception 'payments_disabled'; end if;
  if v_rental.status not in ('approved', 'scheduled') then raise exception 'rental_not_payable'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_terms_hash is null or p_terms_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_token'; end if;
  if p_terms is null or jsonb_typeof(p_terms) <> 'array' or jsonb_array_length(p_terms) = 0 then raise exception 'terms_required'; end if;
  if coalesce(p_rent_cents, -1) < 0 or coalesce(p_deposit_cents, -1) < 0 or p_rent_cents + p_deposit_cents < 50 or p_rent_cents + p_deposit_cents > 500000 then
    raise exception 'invalid_amount';
  end if;
  -- The amounts may never exceed what the rental itself says is owed (a direct call can't invent a price).
  select b.quoted_amount into v_quoted from booking b where b.id = v_rental.booking_id;
  v_rent_cap := coalesce(v_rental.agreed_weekly_rate_usd, v_quoted);
  if v_rent_cap is not null and p_rent_cents > round(v_rent_cap * 100) then raise exception 'invalid_amount'; end if;
  if v_rental.deposit_required_usd is not null and p_deposit_cents > round(v_rental.deposit_required_usd * 100) then raise exception 'invalid_amount'; end if;
  if _setting_on(v_rental.tenant_id, 'payments_require_signature', true)
     and not exists (select 1 from signed_document s where s.rental_id = p_rental_id and s.sign_request_id is not null) then
    raise exception 'agreement_not_signed';
  end if;

  update pay_request set revoked_at = now(), status = 'cancelled' where rental_id = p_rental_id and status = 'open';
  insert into pay_request (tenant_id, rental_id, customer_id, token_hash, rent_cents, deposit_cents, terms_lines, terms_hash, expires_at, created_by)
  values (v_rental.tenant_id, p_rental_id, v_rental.customer_id, p_token_hash, p_rent_cents, p_deposit_cents, p_terms, p_terms_hash,
          now() + make_interval(hours => least(greatest(coalesce(p_hours, 72), 1), 168)), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function create_sign_request(
  p_rental_id uuid, p_token_hash text, p_version_id uuid, p_rendered jsonb, p_content_hash text, p_hours integer default 72
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_rental record;
  v_ver record;
  v_id uuid;
begin
  select r.id, r.tenant_id, r.customer_id, r.status into v_rental from rental r where r.id = p_rental_id;
  if not found then raise exception 'rental_not_found'; end if;
  if auth.uid() is not null and v_rental.tenant_id not in (select app_current_tenant_ids()) then raise exception 'rental_not_found'; end if;
  if auth.uid() is not null and app_is_field_runner() then raise exception 'permission_denied'; end if;
  if v_rental.status not in ('approved', 'scheduled') then raise exception 'rental_not_signable'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_token';
  end if;
  if p_rendered is null or jsonb_typeof(p_rendered->'clauses') <> 'array' then raise exception 'invalid_template'; end if;
  select d.id, d.tenant_id, d.status into v_ver from document_version d where d.id = p_version_id and d.document_type = 'rental_agreement';
  if not found or v_ver.tenant_id <> v_rental.tenant_id or v_ver.status <> 'approved' then raise exception 'version_not_approved'; end if;
  if exists (select 1 from signed_document s where s.rental_id = p_rental_id and s.sign_request_id is not null) then raise exception 'already_signed'; end if;

  update sign_request set revoked_at = now() where rental_id = p_rental_id and revoked_at is null and signed_at is null;
  insert into sign_request (tenant_id, rental_id, customer_id, document_version_id, token_hash, rendered, content_hash, expires_at, created_by)
  values (v_rental.tenant_id, p_rental_id, v_rental.customer_id, p_version_id, p_token_hash, p_rendered, p_content_hash,
          now() + make_interval(hours => least(greatest(coalesce(p_hours, 72), 1), 168)), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
