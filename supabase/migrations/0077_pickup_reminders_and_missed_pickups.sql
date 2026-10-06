-- 0077: pickup reminder texts (24h / 4h / 2h before) and missed-pickup handling (Phase 4A).
-- Wording and timing rules live in lib/pickup-reminders.ts; this is the record of what was
-- sent, safe claiming (no double texts), and the renter's YES / CHANGE reply.
--
-- Reminders are derived from the live pickup time (booking.pickup_at), so changing the
-- pickup time automatically gives the new time its own reminders.
-- A missed pickup is flagged for staff and the renter is offered a new time. It never
-- charges a fee or cancels anything by itself.

alter table rental add column if not exists missed_pickup_at timestamptz;

create table if not exists pickup_reminder (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid not null references rental(id) on delete cascade,
  customer_id uuid not null references customer(id),
  kind text not null check (kind in ('24h', '4h', '2h', 'missed')),
  pickup_at timestamptz not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'skipped')),
  sent_at timestamptz,
  provider_message_id text,
  error text,
  response text check (response in ('yes', 'change')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (rental_id, kind, pickup_at)
);
create index if not exists pickup_reminder_rental_idx on pickup_reminder (rental_id, created_at desc);

alter table pickup_reminder enable row level security;
alter table pickup_reminder force row level security;
drop policy if exists tenant_isolation_select on pickup_reminder;
create policy tenant_isolation_select on pickup_reminder for select
  using (tenant_id in (select app_current_tenant_ids()));
-- No insert/update policies: only the service role and the functions below write it.

-- Claim every reminder that is due right now (each one at most once, ever) and flag
-- missed pickups. Returns what the dispatcher needs to send.
--   24h: sent from 24h to 21h before pickup, but not once the 4h reminder is due
--   4h : sent from 4h to 1h before pickup, but not once the 2h reminder is due
--   2h : sent from 2h before pickup until 30 minutes before
-- A rental booked late therefore gets only the reminders that still make sense.
create or replace function claim_due_pickup_messages(p_limit integer default 25)
returns table (
  id uuid, tenant_id uuid, rental_id uuid, customer_id uuid, kind text, pickup_at timestamptz,
  first_name text, phone text, location_name text, location_tz text, suppressed boolean
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ids uuid[] := '{}';
  v_new uuid[];
  v_lim integer := greatest(1, least(coalesce(p_limit, 25), 100));
begin
  -- 1. Missed pickups: scheduled, never picked up, past the no-show grace.
  with cand as (
    select r.id as rental_id, r.tenant_id, r.customer_id, b.pickup_at,
           (b.pickup_at + make_interval(mins => round(coalesce(
              case when (r.governing_policy_snapshot -> 'cancellation' ->> 'approved') = 'true'
                   then (r.governing_policy_snapshot -> 'cancellation' ->> 'noshow_grace_hours')::numeric end, 2) * 60)::integer)) as due_at
      from rental r
      join booking b on b.id = r.booking_id
     where r.status = 'scheduled' and r.pickup_confirmed_at is null
       and b.pickup_location_id is not null and b.pickup_at is not null
       and b.pickup_at > now() - interval '7 days'
  ), due as (
    select * from cand c
     where c.due_at <= now()
       and not exists (select 1 from pickup_reminder x where x.rental_id = c.rental_id and x.kind = 'missed' and x.pickup_at = c.pickup_at)
     order by c.due_at
     limit v_lim
  ), ins as (
    insert into pickup_reminder (tenant_id, rental_id, customer_id, kind, pickup_at, status, error)
    select d.tenant_id, d.rental_id, d.customer_id, 'missed', d.pickup_at,
           case when d.due_at > now() - interval '12 hours' then 'sending' else 'skipped' end,
           case when d.due_at > now() - interval '12 hours' then null else 'stale' end
      from due d
    on conflict (rental_id, kind, pickup_at) do nothing
    returning pickup_reminder.id, pickup_reminder.rental_id, pickup_reminder.status
  ), flag as (
    update rental r set missed_pickup_at = now(), needs_human_followup = true
     where r.id in (select i.rental_id from ins i)
    returning r.id
  )
  select coalesce(array_agg(i.id) filter (where i.status = 'sending'), '{}') into v_new from ins i;
  v_ids := v_ids || v_new;

  -- 2. Reminders 24h / 4h / 2h.
  with cand as (
    select r.id as rental_id, r.tenant_id, r.customer_id, b.pickup_at, k.kind
      from rental r
      join booking b on b.id = r.booking_id
      cross join (values ('24h', 24, 21, 4), ('4h', 4, 1, 2), ('2h', 2, 0, 0)) as k(kind, hrs, until_hrs, next_hrs)
     where r.status = 'scheduled' and r.pickup_confirmed_at is null
       and b.pickup_location_id is not null and b.pickup_at is not null
       and now() >= b.pickup_at - make_interval(hours => k.hrs)
       and (k.until_hrs > 0 and now() < b.pickup_at - make_interval(hours => k.until_hrs)
            or k.until_hrs = 0 and now() < b.pickup_at - interval '30 minutes')
       and (k.next_hrs = 0 or now() < b.pickup_at - make_interval(hours => k.next_hrs))
       and not exists (select 1 from pickup_reminder x where x.rental_id = r.id and x.kind = k.kind and x.pickup_at = b.pickup_at)
     order by b.pickup_at
     limit v_lim
  ), ins as (
    insert into pickup_reminder (tenant_id, rental_id, customer_id, kind, pickup_at)
    select c.tenant_id, c.rental_id, c.customer_id, c.kind, c.pickup_at from cand c
    on conflict (rental_id, kind, pickup_at) do nothing
    returning pickup_reminder.id
  )
  select coalesce(array_agg(i.id), '{}') into v_new from ins i;
  v_ids := v_ids || v_new;

  return query
  select p.id, p.tenant_id, p.rental_id, p.customer_id, p.kind, p.pickup_at,
         c.first_name, c.phone, l.name, coalesce(l.timezone, 'America/Chicago'),
         exists (select 1 from contact_suppression s
                  where s.tenant_id = p.tenant_id and s.phone_norm is not null and s.phone_norm = normalize_phone(c.phone))
    from pickup_reminder p
    join customer c on c.id = p.customer_id
    join rental r on r.id = p.rental_id
    join booking b on b.id = r.booking_id
    left join location l on l.id = b.pickup_location_id
   where p.id = any(v_ids);
end;
$$;

-- The renter replied YES or CHANGE to a reminder (service role, from the inbound text route).
-- Matches only a recent, unanswered reminder, so an unrelated YES (to a lead nudge) is left alone.
-- CHANGE also flags the rental for staff. Returns the pickup time and place for the reply text.
create or replace function record_pickup_reply(p_tenant_id uuid, p_phone text, p_keyword text)
returns table (rental_id uuid, pickup_at timestamptz, location_name text, location_tz text, kind text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v record;
  v_norm text := normalize_phone(p_phone);
begin
  if v_norm is null or p_keyword not in ('yes', 'change') then return; end if;
  select p.id as reminder_id, p.rental_id as rid, p.pickup_at as pat, p.kind as k, r.booking_id
    into v
    from pickup_reminder p
    join customer c on c.id = p.customer_id
    join rental r on r.id = p.rental_id
   where p.tenant_id = p_tenant_id and p.status = 'sent' and p.response is null
     and p.kind in ('24h', '4h', '2h', 'missed')
     and p.sent_at > now() - interval '36 hours'
     and r.status = 'scheduled'
     and normalize_phone(c.phone) = v_norm
   order by p.sent_at desc
   limit 1
   for update of p;
  if not found then return; end if;

  update pickup_reminder set response = p_keyword, responded_at = now() where id = v.reminder_id;
  if p_keyword = 'change' then
    update rental set needs_human_followup = true where id = v.rid;
  end if;

  return query
  select v.rid, b.pickup_at, l.name, coalesce(l.timezone, 'America/Chicago'), v.k
    from booking b left join location l on l.id = b.pickup_location_id
   where b.id = v.booking_id;
end;
$$;

revoke all on function claim_due_pickup_messages(integer) from public, anon, authenticated;
revoke all on function record_pickup_reply(uuid, text, text) from public, anon, authenticated;
