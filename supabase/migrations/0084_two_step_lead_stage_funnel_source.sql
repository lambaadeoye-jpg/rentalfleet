-- 0084: Two-step lead form, automatic lead stages, funnel by source.
--
--   1. Two-step form. Step 1 saves the lead (first name, mobile, email, platform, need-by date, consent) and returns
--      a one-time token. Step 2 (last name, vehicle, rental option, how soon, notes, "how did you hear about us")
--      is saved with complete_lead_details(), which only works with that token, once, within 7 days.
--      A lead who stops after step 1 is still a real lead (phone + email), so outreach starts at step 1.
--   2. Lead stage moves forward by itself when things happen (text/call attempted, reply, application started /
--      submitted / screening / approved, rental booked / picked up). It only ever moves FORWARD; staff can still set
--      any stage by hand. Every stage change is timestamped in lead_stage_history.
--   3. Funnel by source: view lead_funnel_flags + funnel_by_source(days, group), grouped by channel, campaign or
--      "how did you hear about us".
--
-- Safe to run twice. Old code keeps working: the previous single-step form still inserts a complete lead.

-- ---- 1. Two-step lead -------------------------------------------------------------------------------------------
alter table lead add column if not exists details_completed_at timestamptz;
alter table lead add column if not exists details_token_hash text;
alter table lead add column if not exists heard_about text;

alter table lead drop constraint if exists lead_heard_about_check;
alter table lead add constraint lead_heard_about_check
  check (heard_about is null or heard_about in ('facebook','google','friend','driver_group','flyer','other'));

-- Existing leads all have a last name: mark their details complete.
update lead set details_completed_at = created_at
 where details_completed_at is null and length(trim(last_name)) > 0;

-- Last name is required once details are complete (step 2). A step-1 lead has an empty last name until then.
alter table lead drop constraint if exists lead_fields_not_blank;
alter table lead add constraint lead_fields_not_blank check (
  length(trim(first_name)) > 0 and length(trim(phone)) > 0
  and (details_completed_at is null or length(trim(last_name)) > 0)
);

-- A lead inserted with a last name (the old one-step form, staff-created leads) is complete on arrival.
create or replace function lead_mark_details_complete() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.details_completed_at is null and length(trim(coalesce(new.last_name, ''))) > 0 then
    new.details_completed_at := now();
  end if;
  return new;
end;
$$;
revoke all on function lead_mark_details_complete() from public, anon, authenticated;
drop trigger if exists lead_details_complete on lead;
create trigger lead_details_complete before insert on lead
  for each row execute function lead_mark_details_complete();

-- Step 2. Anyone holding the token (the browser that did step 1) can complete the lead once.
create or replace function complete_lead_details(
  p_lead_id uuid,
  p_token_hash text,
  p_last_name text,
  p_category_id uuid,
  p_rental_option text,
  p_urgency text,
  p_other_platform text,
  p_notes text,
  p_heard_about text
) returns boolean
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_last text := left(btrim(coalesce(p_last_name, '')), 80);
  v_lead record;
  v_rf record;
  v_cat uuid;
begin
  if p_lead_id is null or p_token_hash is null or length(p_token_hash) < 32 or length(v_last) = 0 then
    return false;
  end if;

  update lead l set
    last_name = v_last,
    duration_unit = case when p_rental_option in ('daily', 'weekly') then p_rental_option else l.duration_unit end,
    urgency = case when p_urgency in ('today', 'this_week', 'within_2_weeks', 'just_checking') then p_urgency else l.urgency end,
    driving_for = coalesce(nullif(left(btrim(coalesce(p_other_platform, '')), 200), ''), l.driving_for),
    notes = coalesce(nullif(left(btrim(coalesce(p_notes, '')), 2000), ''), l.notes),
    heard_about = case when p_heard_about in ('facebook','google','friend','driver_group','flyer','other') then p_heard_about else l.heard_about end,
    details_completed_at = now(),
    details_token_hash = null
  where l.id = p_lead_id
    and l.details_token_hash = p_token_hash
    and l.details_completed_at is null
    and l.created_at > now() - interval '7 days'
  returning l.id, l.tenant_id, l.first_name, l.phone, l.email into v_lead;

  if not found then return false; end if;

  -- Vehicle category only if it belongs to this tenant.
  if p_category_id is not null then
    select vc.id into v_cat from vehicle_category vc where vc.id = p_category_id and vc.tenant_id = v_lead.tenant_id;
    if v_cat is not null then update lead set preferred_category_id = v_cat where id = v_lead.id; end if;
  end if;

  -- Re-check the watch list now that the full name is known. Only ever turns the flag ON.
  select * into v_rf from check_red_flag(v_lead.tenant_id, v_lead.phone, v_lead.email::text, v_lead.first_name, v_last);
  if v_rf.matched then
    update lead set red_flag_matched = true, red_flag_match_type = coalesce(red_flag_match_type, v_rf.match_type)
     where id = v_lead.id and red_flag_matched = false;
  end if;
  return true;
end;
$$;
revoke all on function complete_lead_details(uuid, text, text, uuid, text, text, text, text, text) from public;
grant execute on function complete_lead_details(uuid, text, text, uuid, text, text, text, text, text) to anon, authenticated;

-- ---- 2. Automatic lead stages -------------------------------------------------------------------------------------
create table if not exists lead_stage_history (
  lead_id uuid not null references lead(id) on delete cascade,
  tenant_id uuid not null references tenant(id),
  stage text not null,
  entered_at timestamptz not null default now(),
  primary key (lead_id, stage)
);
create index if not exists lead_stage_history_tenant_idx on lead_stage_history (tenant_id, stage, entered_at);
alter table lead_stage_history enable row level security;
alter table lead_stage_history force row level security;
drop policy if exists tenant_isolation_select on lead_stage_history;
create policy tenant_isolation_select on lead_stage_history for select using (tenant_id in (select app_current_tenant_ids()));
-- No write policies: only the trigger below writes this table.

create or replace function _lead_stage_rank(p_stage text) returns integer
language sql immutable set search_path = public as $$
  select array_position(array['new','attempting_contact','contacted','qualified','application_invited','application_started',
    'application_submitted','screening','approved','booking','converted'], p_stage)
$$;

-- Records every stage a lead enters (first time only), whether staff or automation moved it.
create or replace function trg_lead_stage_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into lead_stage_history (lead_id, tenant_id, stage, entered_at)
  values (new.id, new.tenant_id, new.stage, case when tg_op = 'INSERT' then new.created_at else now() end)
  on conflict (lead_id, stage) do nothing;
  return new;
end;
$$;
drop trigger if exists lead_stage_history_ins on lead;
create trigger lead_stage_history_ins after insert on lead for each row execute function trg_lead_stage_history();
drop trigger if exists lead_stage_history_upd on lead;
create trigger lead_stage_history_upd after update of stage on lead
  for each row when (old.stage is distinct from new.stage) execute function trg_lead_stage_history();

-- Backfill history for existing leads.
insert into lead_stage_history (lead_id, tenant_id, stage, entered_at)
select id, tenant_id, 'new', created_at from lead
on conflict do nothing;
insert into lead_stage_history (lead_id, tenant_id, stage, entered_at)
select id, tenant_id, stage, updated_at from lead where stage <> 'new'
on conflict do nothing;

-- Move matching leads forward only. Never throws: a stage update must never break the real action.
create or replace function _advance_lead_stage(p_lead uuid, p_customer uuid, p_to text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_to is null or (p_lead is null and p_customer is null) then return; end if;
  update lead l set stage = p_to
   where ((p_lead is not null and l.id = p_lead) or (p_customer is not null and l.customer_id = p_customer))
     and _lead_stage_rank(l.stage) < _lead_stage_rank(p_to);
exception when others then
  raise warning 'lead stage not advanced: %', sqlerrm;
end;
$$;
revoke all on function _advance_lead_stage(uuid, uuid, text) from public, anon, authenticated;
revoke all on function _lead_stage_rank(text) from public, anon, authenticated;

-- Application: draft -> started, submitted -> submitted, screening/review -> screening, approved -> approved.
create or replace function trg_stage_from_application() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _advance_lead_stage(null, new.customer_id,
    case new.status
      when 'draft' then 'application_started'
      when 'submitted' then 'application_submitted'
      when 'screening' then 'screening'
      when 'review' then 'screening'
      when 'approved' then 'approved'
      when 'conditionally_approved' then 'approved'
      else null end);
  return new;
end;
$$;
drop trigger if exists stage_from_application on application;
create trigger stage_from_application after insert or update of status on application
  for each row execute function trg_stage_from_application();

-- Rental: created -> booking; started -> converted.
create or replace function trg_stage_from_rental() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _advance_lead_stage(null, new.customer_id,
    case
      when new.status = 'cancelled' then null
      when new.status in ('active','extended','return_pending','returned','closed','delinquent','suspended','terminated','recovery') then 'converted'
      when new.status in ('pending','approved','scheduled') then 'booking'
      else null end);
  return new;
end;
$$;
drop trigger if exists stage_from_rental on rental;
create trigger stage_from_rental after insert or update of status on rental
  for each row execute function trg_stage_from_rental();

-- Any inbound message from the person means contact was made.
create or replace function trg_stage_from_inbound() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'inbound' then
    perform _advance_lead_stage(new.lead_id, new.customer_id, 'contacted');
  end if;
  return new;
end;
$$;
drop trigger if exists stage_from_inbound on communication_event;
create trigger stage_from_inbound after insert on communication_event
  for each row execute function trg_stage_from_inbound();

-- A text or call attempt went out.
create or replace function trg_stage_from_outreach() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sent' and old.status is distinct from 'sent' and new.channel in ('sms', 'call') then
    perform _advance_lead_stage(new.lead_id, null, 'attempting_contact');
  end if;
  return new;
end;
$$;
drop trigger if exists stage_from_outreach on outreach_message;
create trigger stage_from_outreach after update of status on outreach_message
  for each row execute function trg_stage_from_outreach();

revoke all on function trg_stage_from_application() from public, anon, authenticated;
revoke all on function trg_stage_from_rental() from public, anon, authenticated;
revoke all on function trg_stage_from_inbound() from public, anon, authenticated;
revoke all on function trg_stage_from_outreach() from public, anon, authenticated;
revoke all on function trg_lead_stage_history() from public, anon, authenticated;

-- ---- 3. Funnel by source ------------------------------------------------------------------------------------------
-- One row per lead with a true/false for every step. security_invoker: row-level security limits it to your tenant.
create or replace view lead_funnel_flags with (security_invoker = true) as
select
  l.id as lead_id,
  l.created_at,
  coalesce(nullif(btrim(l.source), ''), 'unknown') as source,
  nullif(btrim(l.utm_campaign), '') as campaign,
  l.heard_about,
  (l.details_completed_at is not null) as step2_done,
  (l.contact_consent_at is not null) as consented,
  (l.customer_id is not null) as has_customer,
  exists (select 1 from application a where a.customer_id = l.customer_id and a.submitted_at is not null) as applied,
  exists (select 1 from application a where a.customer_id = l.customer_id and a.status in ('approved', 'conditionally_approved')) as approved,
  exists (select 1 from sign_request s where s.customer_id = l.customer_id and s.signed_at is not null) as signed,
  exists (select 1 from pay_request p where p.customer_id = l.customer_id and p.status = 'paid') as paid,
  exists (select 1 from rental r where r.customer_id = l.customer_id and r.start_at is not null) as picked_up
from lead l;
revoke all on lead_funnel_flags from public, anon;
grant select on lead_funnel_flags to authenticated;

drop function if exists funnel_by_source(integer, text);
create or replace function funnel_by_source(p_days integer default 30, p_group text default 'source')
returns table (label text, leads_count bigint, step2_count bigint, applied_count bigint, approved_count bigint,
               signed_count bigint, paid_count bigint, picked_up_count bigint)
language sql stable security invoker set search_path = public as $$
  select
    case when p_group = 'campaign' then coalesce(f.campaign, '(no campaign)') || ' · ' || f.source
         when p_group = 'heard_about' then coalesce(f.heard_about, '(not answered)')
         else f.source end as label,
    count(*),
    count(*) filter (where f.step2_done),
    count(*) filter (where f.applied),
    count(*) filter (where f.approved),
    count(*) filter (where f.signed),
    count(*) filter (where f.paid),
    count(*) filter (where f.picked_up)
  from lead_funnel_flags f
  where f.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
  group by 1
  order by count(*) desc, 1;
$$;
revoke all on function funnel_by_source(integer, text) from public, anon;
grant execute on function funnel_by_source(integer, text) to authenticated;

-- ---- 4. Small fix from the security check: pin normalize_phone's search path --------------------------------------
alter function normalize_phone(text) set search_path = public;
