-- 0081: Renter notices. Text messages the renter should get when money moves or a rental is cancelled.
--
--   * A row is queued by a database trigger when something happens (cancellation, refund issued, payment received,
--     weekly rent charged, weekly charge failed). The app's notice job sends the text.
--   * Switch: tenant_setting 'renter_notices_enabled' = 'on' (default OFF). While off, NOTHING is queued, so switching it
--     on later never sends a flood of old messages. Notices older than 48 hours are never sent.
--   * Queueing can never break the real action: the queue step swallows its own errors.
--   * Wording lives in the app (lib/renter-notices.ts) so it can be changed without a migration.

create table if not exists renter_notice (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  customer_id uuid not null references customer(id),
  rental_id uuid references rental(id),
  kind text not null check (kind in ('cancelled', 'refund_sent', 'payment_received', 'weekly_rent_charged', 'weekly_charge_failed')),
  data jsonb not null default '{}',
  dedupe_key text not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'skipped', 'failed')),
  error text,
  provider_message_id text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, dedupe_key)
);
create index if not exists renter_notice_queue_idx on renter_notice (status, created_at);

alter table renter_notice enable row level security;
alter table renter_notice force row level security;
drop policy if exists tenant_isolation_select on renter_notice;
create policy tenant_isolation_select on renter_notice for select using (tenant_id in (select app_current_tenant_ids()));
-- No write policies: only triggers and the service role write.

create or replace function _queue_renter_notice(p_tenant uuid, p_customer uuid, p_rental uuid, p_kind text, p_data jsonb, p_key text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_customer is null or not _setting_on(p_tenant, 'renter_notices_enabled', false) then return; end if;
  insert into renter_notice (tenant_id, customer_id, rental_id, kind, data, dedupe_key)
  values (p_tenant, p_customer, p_rental, p_kind, coalesce(p_data, '{}'::jsonb), p_key)
  on conflict (tenant_id, dedupe_key) do nothing;
exception when others then
  raise warning 'renter notice not queued: %', sqlerrm;
end;
$$;

-- Cancellation (a refund row is created with every cancellation).
create or replace function trg_notice_refund_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- A deposit return after a finished rental is not a cancellation.
  if new.reason = 'rental_ended' then return new; end if;
  perform _queue_renter_notice(new.tenant_id, new.customer_id, new.rental_id, 'cancelled',
    jsonb_build_object('total_refund_cents', new.total_refund_cents, 'status', new.status), 'cancelled:' || new.id);
  return new;
end;
$$;
drop trigger if exists notice_refund_insert on refund;
create trigger notice_refund_insert after insert on refund for each row execute function trg_notice_refund_insert();

-- Refund issued.
create or replace function trg_notice_refund_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'succeeded' and old.status is distinct from 'succeeded' and new.total_refund_cents > 0 then
    perform _queue_renter_notice(new.tenant_id, new.customer_id, new.rental_id, 'refund_sent',
      jsonb_build_object('total_refund_cents', new.total_refund_cents, 'manual_cents', new.manual_cents, 'reason', new.reason), 'refund_sent:' || new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists notice_refund_update on refund;
create trigger notice_refund_update after update of status on refund for each row execute function trg_notice_refund_update();

-- Checkout payment received.
create or replace function trg_notice_pay_request_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    perform _queue_renter_notice(new.tenant_id, new.customer_id, new.rental_id, 'payment_received',
      jsonb_build_object('rent_cents', new.rent_cents, 'deposit_cents', new.deposit_cents), 'paid:' || new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists notice_pay_request_update on pay_request;
create trigger notice_pay_request_update after update of status on pay_request for each row execute function trg_notice_pay_request_update();

-- Weekly rent charged / failed (first and third failures only, so a renter is not texted four times).
create or replace function trg_notice_billing_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'succeeded' and old.status is distinct from 'succeeded' then
    perform _queue_renter_notice(new.tenant_id, new.customer_id, new.rental_id, 'weekly_rent_charged',
      jsonb_build_object('amount_cents', new.amount_cents), 'bill_ok:' || new.id);
  elsif new.status = 'failed' and old.status is distinct from 'failed' and new.attempt_no in (1, 3) then
    perform _queue_renter_notice(new.tenant_id, new.customer_id, new.rental_id, 'weekly_charge_failed',
      jsonb_build_object('amount_cents', new.amount_cents, 'attempt_no', new.attempt_no), 'bill_fail:' || new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists notice_billing_update on billing_attempt;
create trigger notice_billing_update after update of status on billing_attempt for each row execute function trg_notice_billing_update();

-- Service (app job): hand out queued notices. Old ones are dropped, stuck ones are failed (never re-sent: a duplicate text is worse than a missed one).
create or replace function claim_renter_notices(p_limit integer default 25)
returns table (id uuid, tenant_id uuid, customer_id uuid, rental_id uuid, kind text, data jsonb, first_name text, phone text, suppressed boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ids uuid[];
begin
  update renter_notice set status = 'skipped', error = 'stale' where status = 'queued' and created_at < now() - interval '48 hours';
  update renter_notice set status = 'failed', error = 'stuck_sending' where status = 'sending' and claimed_at < now() - interval '30 minutes';

  with picked as (
    select n.id from renter_notice n where n.status = 'queued' order by n.created_at
     limit greatest(1, least(coalesce(p_limit, 25), 100)) for update skip locked
  ), upd as (
    update renter_notice n set status = 'sending', claimed_at = now() from picked where n.id = picked.id returning n.id
  )
  select coalesce(array_agg(upd.id), '{}') into v_ids from upd;

  return query
  select n.id, n.tenant_id, n.customer_id, n.rental_id, n.kind, n.data, c.first_name, c.phone,
         exists (select 1 from contact_suppression s
                  where s.tenant_id = n.tenant_id and s.phone_norm is not null and s.phone_norm = normalize_phone(c.phone))
    from renter_notice n join customer c on c.id = n.customer_id
   where n.id = any(v_ids);
end;
$$;

revoke all on function _queue_renter_notice(uuid, uuid, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function claim_renter_notices(integer) from public, anon, authenticated;
