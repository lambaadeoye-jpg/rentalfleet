-- 0082: Ending a rental after pickup: give the deposit back.
--
-- When a rental has been returned (the dropoff screen already moves it to returned/closed and stops weekly billing),
-- staff settle the deposit here:
--   * Returns what is still refundable on the deposit (the amount collected, minus any approved deductions).
--   * Weekly rent already paid is NOT refunded.
--   * Blocked while any charge on the rental is still waiting for approval, so a deduction can't be missed.
--   * Uses the same refund queue as cancellations (approval limit, Stripe refund, manual part, notices), reason 'rental_ended'.
--   * Under the approval limit it is approved straight away (the staff member reviewed the numbers first);
--     over the limit it waits for an admin on the Refunds page.
--   * One refund per rental, ever (the refund table is unique per rental).

alter table refund drop constraint if exists refund_reason_check;
alter table refund add constraint refund_reason_check check (reason in
  ('renter_cancelled', 'no_show', 'requirement_failed', 'zivo_cancelled', 'fraud_or_identity', 'rental_ended'));

create or replace function settle_rental_end(p_rental_id uuid, p_note text default null, p_dry_run boolean default true)
returns table (refund_id uuid, deposit_refund_cents integer, deductions_cents integer, manual_cents integer, status text, needs_admin boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_rental record;
  v_dep record;
  v_collected integer := 0;
  v_refundable integer := 0;
  v_card_dep integer;
  v_rent integer;
  v_manual integer;
  v_threshold numeric;
  v_needs_admin boolean;
  v_status text;
  v_id uuid;
  v_rules jsonb;
begin
  if auth.uid() is not null then perform reject_without_permission('issue_refund'); end if;

  select r.* into v_rental from rental r where r.id = p_rental_id for update;
  if not found or (auth.uid() is not null and v_rental.tenant_id not in (select app_current_tenant_ids())) then
    raise exception 'rental_not_found';
  end if;
  if v_rental.status not in ('returned', 'closed') then raise exception 'not_returned'; end if;
  if exists (select 1 from refund f where f.rental_id = p_rental_id) then raise exception 'already_settled'; end if;
  if exists (select 1 from charge c where c.rental_id = p_rental_id and c.approval_status = 'pending') then
    raise exception 'pending_charges';
  end if;

  select d.* into v_dep from deposit d where d.rental_id = p_rental_id and d.status = 'held' limit 1;
  if found then
    v_collected := round(v_dep.amount_collected * 100)::integer;
    v_refundable := greatest(0, least(v_collected, round(coalesce(v_dep.refundable_amount, v_dep.amount_collected) * 100)::integer));
  end if;

  select coalesce(sum(round(p.amount * 100)) filter (where p.kind = 'deposit' and p.provider = 'stripe'), 0)::integer,
         coalesce(sum(round(p.amount * 100)) filter (where p.kind = 'rent'), 0)::integer
    into v_card_dep, v_rent
    from payment p where p.rental_id = p_rental_id and p.status = 'paid';

  -- Card-paid deposit goes back to the card first; anything beyond that is refunded by hand.
  v_manual := greatest(0, v_refundable - v_card_dep);

  v_rules := v_rental.governing_policy_snapshot -> 'cancellation';
  if v_rules is null then
    select pv.rules -> 'cancellation' into v_rules from policy_version pv
     where pv.tenant_id = v_rental.tenant_id and pv.policy_type = 'pricing_and_mileage';
  end if;
  v_threshold := coalesce((v_rules ->> 'admin_approval_threshold_usd')::numeric, 200);
  v_needs_admin := (v_refundable / 100.0) > v_threshold;
  v_status := case when v_refundable = 0 then 'no_refund_due' when v_needs_admin then 'pending_approval' else 'approved' end;

  if p_dry_run then
    return query select null::uuid, v_refundable, (v_collected - v_refundable), v_manual, v_status, v_needs_admin;
    return;
  end if;

  insert into refund (tenant_id, rental_id, customer_id, reason, initiated_by, rent_paid_cents, deposit_paid_cents,
                      fee_cents, fee_kind, rent_refund_cents, deposit_refund_cents, total_refund_cents, manual_cents,
                      needs_admin, status, staff_note, approved_by, approved_at, completed_at)
  values (v_rental.tenant_id, p_rental_id, v_rental.customer_id, 'rental_ended', 'staff', v_rent, v_collected,
          0, 'none', 0, v_refundable, v_refundable, v_manual,
          v_needs_admin, v_status, left(p_note, 500),
          case when v_status = 'approved' then auth.uid() end, case when v_status = 'approved' then now() end,
          case when v_status = 'no_refund_due' then now() end)
  returning id into v_id;

  insert into audit_event (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  values (v_rental.tenant_id, auth.uid(), 'rental_deposit_settled', 'rental', p_rental_id,
          jsonb_build_object('refund_id', v_id, 'deposit_refund_cents', v_refundable, 'deductions_cents', v_collected - v_refundable,
                             'manual_cents', v_manual, 'status', v_status), 'settle_rental_end');

  return query select v_id, v_refundable, (v_collected - v_refundable), v_manual, v_status, v_needs_admin;
end;
$$;

revoke all on function settle_rental_end(uuid, text, boolean) from public, anon;
grant execute on function settle_rental_end(uuid, text, boolean) to authenticated;
