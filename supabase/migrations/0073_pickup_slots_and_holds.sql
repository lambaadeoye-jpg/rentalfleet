-- 0073: pickup slot availability + holds (Phase 3A).
--
-- Staff define weekly pickup windows per location (pickup_slot_rule). A renter
-- with a SCHEDULED rental (vehicle already reserved) picks a slot; the pick
-- creates a short HOLD (slot_hold) that confirms into booking.pickup_at /
-- pickup_location_id, or lapses. Nothing is offered unless staff switch the
-- feature on: tenant_setting 'slot_picker_enabled' = 'on' (default off).
--
-- Optional tenant_setting keys (integers as text):
--   slot_hold_minutes (30), slot_min_lead_minutes (120), slot_horizon_days (14),
--   slot_require_payment ('on' = customers cannot self-confirm; Phase 3D's
--   payment webhook confirms instead).
--
-- All functions are service-role only (revoked from public/anon/authenticated);
-- the app authenticates the renter and passes customer_id, and every function
-- re-checks that the rental belongs to that customer.

create table if not exists pickup_slot_rule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  location_id uuid not null references location(id),
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time time not null,
  end_time time not null,
  slot_minutes integer not null default 30 check (slot_minutes in (15, 20, 30, 45, 60)),
  capacity integer not null default 1 check (capacity >= 1 and capacity <= 20),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint pickup_slot_rule_window check (end_time > start_time),
  unique (location_id, weekday, start_time)
);

create table if not exists slot_hold (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid not null references rental(id) on delete cascade,
  customer_id uuid not null references customer(id),
  location_id uuid not null references location(id),
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  status text not null default 'held' check (status in ('held', 'confirmed', 'released', 'expired')),
  expires_at timestamptz not null,
  released_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one pending hold and one confirmed slot per rental.
create unique index if not exists slot_hold_one_pending_per_rental on slot_hold (rental_id) where status = 'held';
create unique index if not exists slot_hold_one_confirmed_per_rental on slot_hold (rental_id) where status = 'confirmed';
create index if not exists slot_hold_slot_idx on slot_hold (location_id, slot_start) where status in ('held', 'confirmed');

alter table pickup_slot_rule enable row level security;
alter table pickup_slot_rule force row level security;
alter table slot_hold enable row level security;
alter table slot_hold force row level security;

drop policy if exists tenant_isolation_select on pickup_slot_rule;
create policy tenant_isolation_select on pickup_slot_rule for select
  using (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_insert on pickup_slot_rule;
create policy tenant_isolation_insert on pickup_slot_rule for insert
  with check (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_update on pickup_slot_rule;
create policy tenant_isolation_update on pickup_slot_rule for update
  using (tenant_id in (select app_current_tenant_ids()))
  with check (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_delete on pickup_slot_rule;
create policy tenant_isolation_delete on pickup_slot_rule for delete
  using (tenant_id in (select app_current_tenant_ids()));

drop policy if exists tenant_isolation_select on slot_hold;
create policy tenant_isolation_select on slot_hold for select
  using (tenant_id in (select app_current_tenant_ids()));
drop policy if exists customer_select_own on slot_hold;
create policy customer_select_own on slot_hold for select
  using (customer_id = app_current_customer_id());
-- No write policies on slot_hold: only the definer functions below write it.

create or replace function guard_pickup_slot_rule() returns trigger
language plpgsql set search_path = public as $$
begin
  perform reject_without_permission('manage_fleet');
  return coalesce(new, old);
end;
$$;
drop trigger if exists pickup_slot_rule_permission_guard on pickup_slot_rule;
create trigger pickup_slot_rule_permission_guard
  before insert or update or delete on pickup_slot_rule
  for each row execute function guard_pickup_slot_rule();

-- ---- helpers ---------------------------------------------------------------

create or replace function slot_setting_int(p_tenant uuid, p_key text, p_default integer)
returns integer language sql stable set search_path = public as $$
  select coalesce(
    (select case when ts.value ~ '^[0-9]{1,6}$' then ts.value::integer end
       from tenant_setting ts where ts.tenant_id = p_tenant and ts.key = p_key),
    p_default)
$$;

create or replace function slot_setting_text(p_tenant uuid, p_key text)
returns text language sql stable set search_path = public as $$
  select ts.value from tenant_setting ts where ts.tenant_id = p_tenant and ts.key = p_key
$$;

-- Open slots at one location. Remaining = rule capacity minus pending holds
-- minus bookings already placed in that slot. The named rental's own hold and
-- booking never count against it (so re-picking the same slot works).
create or replace function _pickup_slots(p_tenant uuid, p_location uuid, p_from date, p_days integer, p_exclude_rental uuid)
returns table (starts_at timestamptz, ends_at timestamptz, spots_left integer)
language plpgsql stable set search_path = public as $$
declare
  v_tz text;
  v_earliest timestamptz;
  v_latest timestamptz;
begin
  select coalesce(nullif(l.timezone, ''), 'America/Chicago') into v_tz
    from location l where l.id = p_location and l.tenant_id = p_tenant and l.active;
  if not found then return; end if;

  v_earliest := now() + make_interval(mins => slot_setting_int(p_tenant, 'slot_min_lead_minutes', 120));
  v_latest := now() + make_interval(days => slot_setting_int(p_tenant, 'slot_horizon_days', 14));

  return query
  with cand as (
    select ((p_from + o.d)::timestamp + r.start_time + make_interval(mins => n.i * r.slot_minutes)) at time zone v_tz as s,
           r.slot_minutes as mins,
           r.capacity as cap
      from pickup_slot_rule r
      cross join generate_series(0, least(greatest(p_days, 1), 31) - 1) as o(d)
      cross join lateral generate_series(
        0,
        floor(extract(epoch from (r.end_time - r.start_time)) / 60 / r.slot_minutes)::integer - 1
      ) as n(i)
     where r.tenant_id = p_tenant and r.location_id = p_location and r.active
       and r.weekday = extract(dow from (p_from + o.d))::integer
  ), slots as (
    select c.s, c.s + make_interval(mins => max(c.mins)) as e, max(c.cap) as cap
      from cand c
     group by c.s
  )
  select sl.s, sl.e,
         (sl.cap
          - (select count(*) from slot_hold h
              where h.location_id = p_location and h.status = 'held' and h.expires_at > now()
                and h.slot_start = sl.s and h.rental_id is distinct from p_exclude_rental)
          - (select count(*) from booking b
              where b.tenant_id = p_tenant and b.pickup_location_id = p_location
                and b.pickup_at >= sl.s and b.pickup_at < sl.e
                and b.status not in ('cancelled', 'canceled', 'completed', 'no_show')
                and not exists (select 1 from rental rr where rr.booking_id = b.id and rr.id = p_exclude_rental))
         )::integer
    from slots sl
   where sl.s >= v_earliest and sl.s <= v_latest
   order by sl.s;
end;
$$;

-- ---- public (service-role) API ---------------------------------------------

create or replace function list_pickup_slots(p_rental_id uuid, p_customer_id uuid, p_location_id uuid, p_from date default null, p_days integer default 7)
returns table (starts_at timestamptz, ends_at timestamptz, spots_left integer)
language plpgsql security definer set search_path = public as $$
declare
  v_rental record;
  v_tz text;
  v_from date;
begin
  select r.tenant_id, r.customer_id, r.status into v_rental from rental r where r.id = p_rental_id;
  if not found or v_rental.customer_id is distinct from p_customer_id then raise exception 'rental_not_found'; end if;
  if slot_setting_text(v_rental.tenant_id, 'slot_picker_enabled') is distinct from 'on' then raise exception 'feature_disabled'; end if;
  if v_rental.status <> 'scheduled' then raise exception 'rental_not_schedulable'; end if;

  select coalesce(nullif(l.timezone, ''), 'America/Chicago') into v_tz
    from location l where l.id = p_location_id and l.tenant_id = v_rental.tenant_id and l.active;
  if not found then raise exception 'location_not_found'; end if;

  v_from := coalesce(p_from, (now() at time zone v_tz)::date);
  return query select * from _pickup_slots(v_rental.tenant_id, p_location_id, v_from, p_days, p_rental_id) s where s.spots_left > 0;
end;
$$;

create or replace function hold_pickup_slot(p_rental_id uuid, p_customer_id uuid, p_location_id uuid, p_slot_start timestamptz)
returns table (out_hold_id uuid, out_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_rental record;
  v_tz text;
  v_left integer;
  v_minutes integer;
  v_slot_end timestamptz;
  v_id uuid;
  v_exp timestamptz;
begin
  select r.tenant_id, r.customer_id, r.status, r.drop_off_manually_set into v_rental from rental r where r.id = p_rental_id;
  if not found or v_rental.customer_id is distinct from p_customer_id then raise exception 'rental_not_found'; end if;
  if slot_setting_text(v_rental.tenant_id, 'slot_picker_enabled') is distinct from 'on' then raise exception 'feature_disabled'; end if;
  if v_rental.status <> 'scheduled' then raise exception 'rental_not_schedulable'; end if;
  -- Staff set a custom drop-off date; changing pickup would silently alter it.
  if v_rental.drop_off_manually_set then raise exception 'needs_staff'; end if;

  select coalesce(nullif(l.timezone, ''), 'America/Chicago') into v_tz
    from location l where l.id = p_location_id and l.tenant_id = v_rental.tenant_id and l.active;
  if not found then raise exception 'location_not_found'; end if;

  v_minutes := least(greatest(slot_setting_int(v_rental.tenant_id, 'slot_hold_minutes', 30), 5), 240);

  -- Serialize everyone competing for this exact slot.
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text || '|' || p_slot_start::text, 0));

  update slot_hold set status = 'expired', updated_at = now()
   where location_id = p_location_id and status = 'held' and expires_at <= now();
  -- A renter has one pending pick at a time; a new pick replaces it.
  update slot_hold set status = 'released', released_reason = 'replaced', updated_at = now()
   where rental_id = p_rental_id and status = 'held';

  select s.spots_left, s.ends_at into v_left, v_slot_end
    from _pickup_slots(v_rental.tenant_id, p_location_id, (p_slot_start at time zone v_tz)::date, 1, p_rental_id) s
   where s.starts_at = p_slot_start;
  if not found or v_left <= 0 then raise exception 'slot_unavailable'; end if;

  v_exp := now() + make_interval(mins => v_minutes);
  insert into slot_hold (tenant_id, rental_id, customer_id, location_id, slot_start, slot_end, expires_at)
  values (v_rental.tenant_id, p_rental_id, p_customer_id, p_location_id, p_slot_start, v_slot_end, v_exp)
  returning id into v_id;

  out_hold_id := v_id;
  out_expires_at := v_exp;
  return next;
end;
$$;

-- Confirm a pending hold into the rental's booking. Returns a status word so
-- a caller can react without a rolled-back exception:
--   confirmed | already_confirmed | expired | not_active | payment_required
-- p_source: 'customer' (self-serve), 'payment' (Phase 3D webhook), 'staff'.
create or replace function confirm_pickup_slot(p_hold_id uuid, p_customer_id uuid default null, p_source text default 'customer')
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_hold slot_hold%rowtype;
  v_rental record;
  v_booking record;
  v_return timestamptz;
begin
  select * into v_hold from slot_hold h where h.id = p_hold_id for update;
  if not found then return 'not_active'; end if;
  if p_customer_id is not null and v_hold.customer_id is distinct from p_customer_id then return 'not_active'; end if;
  if v_hold.status = 'confirmed' then return 'already_confirmed'; end if;
  if v_hold.status <> 'held' then return 'not_active'; end if;
  if v_hold.expires_at <= now() then
    update slot_hold set status = 'expired', updated_at = now() where id = v_hold.id;
    return 'expired';
  end if;

  if p_source = 'customer' and slot_setting_text(v_hold.tenant_id, 'slot_require_payment') = 'on' then
    return 'payment_required';
  end if;

  select r.id, r.status, r.booking_id, r.drop_off_manually_set into v_rental
    from rental r where r.id = v_hold.rental_id for update;
  if not found or v_rental.status <> 'scheduled' or v_rental.booking_id is null then
    update slot_hold set status = 'released', released_reason = 'rental_not_schedulable', updated_at = now() where id = v_hold.id;
    return 'not_active';
  end if;
  if v_rental.drop_off_manually_set then
    update slot_hold set status = 'released', released_reason = 'needs_staff', updated_at = now() where id = v_hold.id;
    return 'not_active';
  end if;

  select b.id into v_booking from booking b where b.id = v_rental.booking_id for update;
  v_return := v_hold.slot_start + interval '7 days'; -- locked 7-day minimum = default drop-off

  -- The earlier confirmed slot (if any) is freed by the new one.
  update slot_hold set status = 'released', released_reason = 'rescheduled', updated_at = now()
   where rental_id = v_hold.rental_id and status = 'confirmed' and id <> v_hold.id;

  update booking set pickup_at = v_hold.slot_start, pickup_location_id = v_hold.location_id, return_at = v_return
   where id = v_booking.id;
  update rental set expected_return_at = v_return, drop_off_manually_set = false, pickup_confirmed_at = null
   where id = v_hold.rental_id;
  update slot_hold set status = 'confirmed', updated_at = now() where id = v_hold.id;
  return 'confirmed';
end;
$$;

-- Release a pending or confirmed hold. Releasing a confirmed one removes the
-- appointment (the location is cleared; the pickups list treats a booking with
-- no location as having no appointment).
create or replace function release_pickup_slot(p_hold_id uuid, p_reason text default 'released', p_customer_id uuid default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_hold slot_hold%rowtype;
  v_booking uuid;
begin
  select * into v_hold from slot_hold h where h.id = p_hold_id for update;
  if not found then return false; end if;
  if p_customer_id is not null and v_hold.customer_id is distinct from p_customer_id then return false; end if;
  if v_hold.status not in ('held', 'confirmed') then return false; end if;

  update slot_hold set status = 'released', released_reason = left(coalesce(p_reason, 'released'), 80), updated_at = now()
   where id = v_hold.id;

  if v_hold.status = 'confirmed' then
    select r.booking_id into v_booking from rental r where r.id = v_hold.rental_id;
    if v_booking is not null then
      update booking set pickup_location_id = null
       where id = v_booking and pickup_location_id = v_hold.location_id and pickup_at = v_hold.slot_start;
    end if;
    update rental set pickup_confirmed_at = null where id = v_hold.rental_id;
  end if;
  return true;
end;
$$;

-- Lapse old pending holds. Safe to call often (a cron / Phase 4 job).
create or replace function expire_slot_holds() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  update slot_hold set status = 'expired', updated_at = now()
   where status = 'held' and expires_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function slot_setting_int(uuid, text, integer) from public, anon, authenticated;
revoke all on function slot_setting_text(uuid, text) from public, anon, authenticated;
revoke all on function _pickup_slots(uuid, uuid, date, integer, uuid) from public, anon, authenticated;
revoke all on function list_pickup_slots(uuid, uuid, uuid, date, integer) from public, anon, authenticated;
revoke all on function hold_pickup_slot(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function confirm_pickup_slot(uuid, uuid, text) from public, anon, authenticated;
revoke all on function release_pickup_slot(uuid, text, uuid) from public, anon, authenticated;
revoke all on function expire_slot_holds() from public, anon, authenticated;

-- Staff: replace a location's weekly pickup hours in one atomic step.
-- SECURITY INVOKER on purpose: row-level security (tenant members only) and
-- the manage_fleet permission guard both apply to the caller.
-- p_rules: [{"weekday":1,"start_time":"10:00","end_time":"16:00","slot_minutes":30,"capacity":1}, ...]
create or replace function set_location_pickup_hours(p_location_id uuid, p_rules jsonb)
returns integer
language plpgsql set search_path = public as $$
declare
  v_tenant uuid;
  v_rule jsonb;
  v_n integer := 0;
begin
  select l.tenant_id into v_tenant from location l where l.id = p_location_id;
  if not found then raise exception 'location_not_found'; end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' then raise exception 'invalid_rules'; end if;

  delete from pickup_slot_rule where location_id = p_location_id;
  for v_rule in select e.value from jsonb_array_elements(p_rules) as e(value) loop
    insert into pickup_slot_rule (tenant_id, location_id, weekday, start_time, end_time, slot_minutes, capacity)
    values (
      v_tenant, p_location_id,
      (v_rule->>'weekday')::smallint, (v_rule->>'start_time')::time, (v_rule->>'end_time')::time,
      (v_rule->>'slot_minutes')::integer, (v_rule->>'capacity')::integer
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function set_location_pickup_hours(uuid, jsonb) from public, anon;
grant execute on function set_location_pickup_hours(uuid, jsonb) to authenticated;
