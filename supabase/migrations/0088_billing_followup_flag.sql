-- 0088: The "needs follow-up" flag that billing raises after the 4th failed charge now clears itself when the charge finally
-- succeeds (for example after the renter saves a new card).
--
-- Why a new column: rental.needs_human_followup is shared with call outcomes (a renter asked to reschedule, etc.), so billing
-- cannot just switch it off. billing_followup_at records WHEN billing raised it. On a successful charge:
--   * billing_followup_at is cleared, and
--   * needs_human_followup is cleared too, but only if no call outcome came in after billing raised it (otherwise someone
--     else's follow-up is still open and stays flagged).
-- Raising the flag works as before (4th failure, and the extra 5th attempt after a card change).
-- Safe to run twice.

alter table rental add column if not exists billing_followup_at timestamptz;

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
    -- Billing's own follow-up is resolved. Someone else's (a call outcome after billing raised it) is left alone.
    update rental set billing_followup_at = null,
           needs_human_followup = case when last_call_at is null or last_call_at <= billing_followup_at then false else needs_human_followup end
     where id = a.rental_id and billing_followup_at is not null;
    return 'succeeded';
  end if;

  update billing_attempt set status = 'failed', error = left(coalesce(p_error, 'failed'), 200), finished_at = now() where id = a.id;
  if a.attempt_no >= 4 then
    update rental set needs_human_followup = true, billing_followup_at = coalesce(billing_followup_at, now()) where id = a.rental_id;
  end if;
  insert into audit_event (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  values (a.tenant_id, null, 'weekly_rent_charge_failed', 'rental', a.rental_id,
          jsonb_build_object('amount_cents', a.amount_cents, 'attempt_no', a.attempt_no, 'error', left(coalesce(p_error, 'failed'), 200)), 'finish_billing_attempt');
  return 'failed';
end;
$$;
revoke all on function finish_billing_attempt(uuid, boolean, text, text) from public, anon, authenticated;
