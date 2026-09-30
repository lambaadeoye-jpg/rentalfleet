-- Internal red flag database -- deliberately internal-only, not shared
-- with or sourced from other businesses. Cross-business reputation data
-- ("has this person burned another rental company") is exactly what a
-- real, compliant background-check provider already aggregates -- that
-- belongs to the deferred screening-provider integration, not a DIY
-- blacklist built without legal review. This table only ever holds
-- entries tied to this business's own documented incidents.
--
-- Matching flags for STAFF REVIEW, never auto-rejects -- a false
-- positive is possible (shared phone number, common name), and a human
-- should make the actual call, matching the same "money/consequential
-- decisions need a human" principle already governing charges,
-- referrals, and everything else in this build with real stakes.

create table if not exists red_flag (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  first_name text,
  last_name text,
  phone text,
  email citext,
  license_number_ref text,
  reason text not null,
  status text not null default 'active', -- active | resolved
  added_by uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolved_note text
);

alter table red_flag enable row level security;
alter table red_flag force row level security;

-- Staff-only, tenant-scoped. No customer-facing access of any kind --
-- this table never appears in the customer or applicant's own view of
-- their own data, by design.
drop policy if exists tenant_isolation_select on red_flag;
create policy tenant_isolation_select on red_flag for select
  using (tenant_id in (select app_current_tenant_ids()));

drop policy if exists tenant_isolation_insert on red_flag;
create policy tenant_isolation_insert on red_flag for insert
  with check (tenant_id in (select app_current_tenant_ids()));

drop policy if exists tenant_isolation_update on red_flag;
create policy tenant_isolation_update on red_flag for update
  using (tenant_id in (select app_current_tenant_ids()))
  with check (tenant_id in (select app_current_tenant_ids()));

-- Reuses approve_driver (the existing trust/screening-domain permission)
-- rather than inventing a new code -- adding someone to this list is
-- the same kind of trust decision as approving a driver, just the
-- inverse direction.
create or replace function guard_red_flag_write() returns trigger as $$
begin
  perform reject_without_permission('approve_driver');
  return coalesce(new, old);
end;
$$ language plpgsql set search_path = public;

drop trigger if exists red_flag_write_guard on red_flag;
create trigger red_flag_write_guard
  before insert or update on red_flag
  for each row execute function guard_red_flag_write();

-- Narrow, safe, security-definer check -- callable by anon (the public
-- lead form runs as anon), same pattern as link_referral(). Returns
-- ONLY whether a match occurred and what matched, never the reason or
-- any other red_flag row detail -- a public-facing check must never
-- leak why someone might be flagged, only that staff should look.
-- Phone/email are treated as strong signals (exact match on a real
-- identifier); a name-only match is real but weaker (common names
-- collide), flagged separately so staff can weigh it accordingly rather
-- than treating every match the same.
create or replace function check_red_flag(
  p_tenant_id uuid,
  p_phone text,
  p_email text,
  p_first_name text,
  p_last_name text
) returns table(matched boolean, match_type text) as $$
declare
  v_phone_match boolean;
  v_email_match boolean;
  v_name_match boolean;
begin
  select exists (
    select 1 from red_flag
    where tenant_id = p_tenant_id and status = 'active'
      and phone is not null and p_phone is not null and phone = p_phone
  ) into v_phone_match;

  select exists (
    select 1 from red_flag
    where tenant_id = p_tenant_id and status = 'active'
      and email is not null and p_email is not null and email = p_email::citext
  ) into v_email_match;

  select exists (
    select 1 from red_flag
    where tenant_id = p_tenant_id and status = 'active'
      and first_name is not null and last_name is not null
      and p_first_name is not null and p_last_name is not null
      and lower(first_name) = lower(p_first_name) and lower(last_name) = lower(p_last_name)
  ) into v_name_match;

  if v_phone_match or v_email_match then
    return query select true, case when v_phone_match and v_email_match then 'phone_and_email'
                                    when v_phone_match then 'phone'
                                    else 'email' end;
  elsif v_name_match then
    return query select true, 'name_only';
  else
    return query select false, null::text;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function check_red_flag(uuid, text, text, text, text) to anon;

-- Result of the check gets stored directly on the lead row so staff can
-- see it at a glance in the leads list/review queue without a separate
-- lookup -- staff with real table access can still open red_flag
-- itself for the actual reason.
alter table lead add column if not exists red_flag_matched boolean not null default false;
alter table lead add column if not exists red_flag_match_type text;
