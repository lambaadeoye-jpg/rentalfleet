-- Ticket deadline, rental ban list, and the day-before rent text.
--   1. toll_transaction.pay_by: when a toll or ticket is charged to a renter, the deadline to pay it (24 hours by default),
--      and a new status 'paid'.
--   2. rental_ban: people we will not rent to again. Kept in its OWN table (not on the customer row) because renters
--      can edit their own customer row; matched by phone or email so a new sign-up can't get around it.
--   3. A new renter text, 'rent_due_tomorrow': "we'll charge your card ending 1234 tomorrow". Queued by
--      queue_rent_due_reminders(), which the renter-notices job calls before it sends. Same switch, quiet hours and
--      opt-out list as the other renter texts.
--
-- Safe to run more than once. Requires 0087 (notice kinds) and 0093 (tolls).

-- 1. Ticket deadline --------------------------------------------------------------------------------------------
alter table toll_transaction add column if not exists pay_by timestamptz;
-- A charged toll or ticket can now be marked paid once the renter has paid it.
alter table toll_transaction drop constraint if exists toll_transaction_status_check;
alter table toll_transaction add constraint toll_transaction_status_check check (status in ('open', 'charged', 'waived', 'paid'));

-- 2. Rental ban list -------------------------------------------------------------------------------------------
create table if not exists rental_ban (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  customer_id uuid references customer(id),
  phone_norm text,
  email text,
  reason text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid,
  check (phone_norm is not null or email is not null)
);
create index if not exists idx_rental_ban_phone on rental_ban (tenant_id, phone_norm) where lifted_at is null and phone_norm is not null;
create index if not exists idx_rental_ban_email on rental_ban (tenant_id, email) where lifted_at is null and email is not null;
create index if not exists idx_rental_ban_customer on rental_ban (tenant_id, customer_id);

alter table rental_ban enable row level security;
alter table rental_ban force row level security;
drop policy if exists tenant_isolation_select on rental_ban;
create policy tenant_isolation_select on rental_ban for select using (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_write on rental_ban;
create policy tenant_isolation_write on rental_ban for insert with check (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_update on rental_ban;
create policy tenant_isolation_update on rental_ban for update
  using (tenant_id in (select app_current_tenant_ids())) with check (tenant_id in (select app_current_tenant_ids()));

-- Only someone who can decide applications may add or lift a ban. Nobody deletes one.
create or replace function guard_rental_ban() returns trigger as $$
begin
  if auth.uid() is not null and not app_has_permission('approve_driver') then
    perform reject_without_permission('approve_driver');
  end if;
  if tg_op = 'UPDATE' then
    -- Only lifting is allowed; the record of who/why stays as it was.
    if new.tenant_id is distinct from old.tenant_id or new.customer_id is distinct from old.customer_id
       or new.phone_norm is distinct from old.phone_norm or new.email is distinct from old.email
       or new.reason is distinct from old.reason or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'rental_ban_immutable';
    end if;
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists rental_ban_guard on rental_ban;
create trigger rental_ban_guard before insert or update on rental_ban
  for each row execute function guard_rental_ban();

-- Deleting is never allowed.
revoke delete on rental_ban from authenticated, anon;

-- Server-side check used when someone applies. Only the app's service role may call it (so nobody can use it to
-- test whether a given phone number or email is on the list).
create or replace function rental_ban_matches(p_tenant uuid, p_phone text, p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from rental_ban b
     where b.tenant_id = p_tenant and b.lifted_at is null
       and ((b.phone_norm is not null and b.phone_norm = normalize_phone(p_phone))
         or (b.email is not null and lower(b.email) = lower(btrim(coalesce(p_email, '')))))
  )
$$;
revoke all on function rental_ban_matches(uuid, text, text) from public, anon, authenticated;
grant execute on function rental_ban_matches(uuid, text, text) to service_role;

-- 3. Day-before rent text --------------------------------------------------------------------------------------
alter table renter_notice drop constraint if exists renter_notice_kind_check;
alter table renter_notice add constraint renter_notice_kind_check check (kind in (
  'cancelled', 'refund_sent', 'payment_received', 'weekly_rent_charged', 'weekly_charge_failed',
  'checkin_day1', 'checkin_day3', 'referral_ask', 'card_updated', 'rent_due_tomorrow'));

-- Queue a reminder for every active weekly schedule whose charge is due within the next 30 hours.
-- One per schedule per due date (the key includes the due time), so running it often is safe.
create or replace function queue_rent_due_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_card record;
  v_n integer := 0;
begin
  for r in
    select ps.id as schedule_id, ps.tenant_id, ps.rental_id, ps.next_due_at, ps.amount, rt.customer_id
      from payment_schedule ps
      join rental rt on rt.id = ps.rental_id
     where ps.status = 'active' and ps.cadence = 'weekly' and not ps.billing_paused
       and ps.next_due_at is not null
       and ps.next_due_at > now() and ps.next_due_at <= now() + interval '30 hours'
       and coalesce(ps.amount, 0) > 0
       and rt.status in ('active', 'extended')
  loop
    select m.last4 into v_card from customer_payment_method m
     where m.tenant_id = r.tenant_id and m.customer_id = r.customer_id
     order by m.created_at desc limit 1;
    continue when not found;

    perform _queue_renter_notice(
      r.tenant_id, r.customer_id, r.rental_id, 'rent_due_tomorrow',
      jsonb_build_object('amount_cents', round(r.amount * 100)::integer, 'last4', v_card.last4, 'due_at', r.next_due_at),
      'rentdue:' || r.schedule_id || ':' || extract(epoch from r.next_due_at)::bigint,
      greatest(now(), r.next_due_at - interval '24 hours'));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function queue_rent_due_reminders() from public, anon, authenticated;
grant execute on function queue_rent_due_reminders() to service_role;
