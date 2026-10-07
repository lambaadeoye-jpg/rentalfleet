-- 0085: Texts to renters after pickup: day-1 and day-3 check-ins, and one referral ask.
--
-- Reuses the renter notice queue from 0081 (same sender job, same quiet hours, same opt-out list). What is new:
--   * renter_notice.send_after: a notice can be scheduled for later. It is only claimed once send_after has passed,
--     and dropped if still unsent 48 hours after that.
--   * Three new kinds: checkin_day1 (1 day after pickup), checkin_day3 (3 days), referral_ask (8 days).
--   * Two NEW switches, both default OFF, separate from renter_notices_enabled:
--       renter_checkins_enabled   (check-ins about the rental in progress)
--       referral_asks_enabled     (a promotional text: needs counsel sign-off on the consent wording first)
--     While a switch is off nothing is queued, so turning it on never sends old messages.
--   * Check-ins are skipped if the rental is no longer active when the time comes. The referral ask is skipped unless
--     the renter has a recorded text/call consent on their lead.
-- Safe to run twice.

alter table renter_notice add column if not exists send_after timestamptz not null default now();
update renter_notice set send_after = created_at where send_after > created_at;

alter table renter_notice drop constraint if exists renter_notice_kind_check;
alter table renter_notice add constraint renter_notice_kind_check check (kind in (
  'cancelled', 'refund_sent', 'payment_received', 'weekly_rent_charged', 'weekly_charge_failed',
  'checkin_day1', 'checkin_day3', 'referral_ask'));
drop index if exists renter_notice_queue_idx;
create index if not exists renter_notice_queue_idx on renter_notice (status, send_after);

-- Queue helper, now with a send time and a choice of switch.
drop function if exists _queue_renter_notice(uuid, uuid, uuid, text, jsonb, text);
create or replace function _queue_renter_notice(
  p_tenant uuid, p_customer uuid, p_rental uuid, p_kind text, p_data jsonb, p_key text,
  p_send_after timestamptz default now(), p_switch text default 'renter_notices_enabled')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_customer is null or not _setting_on(p_tenant, coalesce(p_switch, 'renter_notices_enabled'), false) then return; end if;
  insert into renter_notice (tenant_id, customer_id, rental_id, kind, data, dedupe_key, send_after)
  values (p_tenant, p_customer, p_rental, p_kind, coalesce(p_data, '{}'::jsonb), p_key, coalesce(p_send_after, now()))
  on conflict (tenant_id, dedupe_key) do nothing;
exception when others then
  raise warning 'renter notice not queued: %', sqlerrm;
end;
$$;
revoke all on function _queue_renter_notice(uuid, uuid, uuid, text, jsonb, text, timestamptz, text) from public, anon, authenticated;

-- When a rental becomes active (pickup), schedule the three messages.
create or replace function trg_notice_rental_active() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_base timestamptz := coalesce(new.start_at, now());
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    perform _queue_renter_notice(new.tenant_id, new.customer_id, new.id, 'checkin_day1', '{}'::jsonb,
      'checkin1:' || new.id, v_base + interval '1 day', 'renter_checkins_enabled');
    perform _queue_renter_notice(new.tenant_id, new.customer_id, new.id, 'checkin_day3', '{}'::jsonb,
      'checkin3:' || new.id, v_base + interval '3 days', 'renter_checkins_enabled');
    perform _queue_renter_notice(new.tenant_id, new.customer_id, new.id, 'referral_ask', '{}'::jsonb,
      'referral_ask:' || new.id, v_base + interval '8 days', 'referral_asks_enabled');
  end if;
  return new;
exception when others then
  raise warning 'rental active notices not queued: %', sqlerrm;
  return new;
end;
$$;
revoke all on function trg_notice_rental_active() from public, anon, authenticated;
drop trigger if exists notice_rental_active on rental;
create trigger notice_rental_active after insert or update of status on rental
  for each row execute function trg_notice_rental_active();

-- Sender job: only notices that are due; old ones are dropped, stuck ones are failed (never re-sent).
drop function if exists claim_renter_notices(integer);
create or replace function claim_renter_notices(p_limit integer default 25)
returns table (id uuid, tenant_id uuid, customer_id uuid, rental_id uuid, kind text, data jsonb, first_name text, phone text,
               suppressed boolean, rental_status text, referral_code text, has_consent boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ids uuid[];
begin
  update renter_notice set status = 'skipped', error = 'stale' where status = 'queued' and send_after < now() - interval '48 hours';
  update renter_notice set status = 'failed', error = 'stuck_sending' where status = 'sending' and claimed_at < now() - interval '30 minutes';

  with picked as (
    select n.id from renter_notice n where n.status = 'queued' and n.send_after <= now() order by n.send_after
     limit greatest(1, least(coalesce(p_limit, 25), 100)) for update skip locked
  ), upd as (
    update renter_notice n set status = 'sending', claimed_at = now() from picked where n.id = picked.id returning n.id
  )
  select coalesce(array_agg(upd.id), '{}') into v_ids from upd;

  return query
  select n.id, n.tenant_id, n.customer_id, n.rental_id, n.kind, n.data, c.first_name, c.phone,
         exists (select 1 from contact_suppression s
                  where s.tenant_id = n.tenant_id and s.phone_norm is not null and s.phone_norm = normalize_phone(c.phone)),
         (select r.status from rental r where r.id = n.rental_id),
         c.referral_code,
         exists (select 1 from lead l where l.customer_id = n.customer_id and l.contact_consent_at is not null)
    from renter_notice n join customer c on c.id = n.customer_id
   where n.id = any(v_ids);
end;
$$;
revoke all on function claim_renter_notices(integer) from public, anon, authenticated;
