-- Staff Invite Flow
-- Real gap: adding a second staff member currently requires raw SQL.
-- Can't just create a "pending" user_profile row ahead of time -- its id
-- IS auth.users.id (not a separate nullable link column like customer
-- has), and every permission/tenant function in this build
-- (app_current_tenant_ids, app_has_permission, etc.) depends on that
-- invariant holding. Breaking it to support invites would be a much
-- bigger, riskier change than the invite feature itself is worth.
--
-- Design instead: a staff_invite table (tenant_id, email, role) that an
-- existing admin creates, and a validated self-provisioning function the
-- invited person calls after their first magic-link sign-in. Authorization
-- is "does a genuine pending invite exist matching your real,
-- server-verified email" -- not a weakened guard.

create table if not exists staff_invite (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  email citext not null,
  role_id uuid not null references role(id),
  invited_by uuid references user_profile(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

alter table staff_invite enable row level security;
alter table staff_invite force row level security;

-- Staff can see/manage invites for their own tenant, gated by the same
-- manage_users_roles permission as role/membership mutations -- inviting
-- someone IS a users/roles management action.
drop policy if exists tenant_isolation_select on staff_invite;
create policy tenant_isolation_select on staff_invite for select
  using (tenant_id in (select app_current_tenant_ids()));

drop policy if exists tenant_isolation_write on staff_invite;
create policy tenant_isolation_write on staff_invite for insert
  with check (tenant_id in (select app_current_tenant_ids()));

drop policy if exists tenant_isolation_delete on staff_invite;
create policy tenant_isolation_delete on staff_invite for delete
  using (tenant_id in (select app_current_tenant_ids()));

drop trigger if exists staff_invite_manage_users_roles_guard on staff_invite;
create trigger staff_invite_manage_users_roles_guard
  before insert or delete on staff_invite
  for each row execute function guard_manage_users_roles();

-- The invited person needs to be able to see their OWN pending invite
-- (by email) before they have any membership at all -- otherwise the
-- staff onboarding page can't even tell them an invite exists.
--
-- app_current_user_email() exists because a raw `select email from
-- auth.users where id = auth.uid()` INSIDE an RLS policy expression fails
-- with "permission denied for table users" -- the `authenticated` role
-- has no direct SELECT grant on auth.users (by design; the standard advice
-- is auth.uid()/auth.jwt(), not querying the table directly). Confirmed
-- this by testing the naive version first; it failed exactly as expected.
-- Every OTHER place in this build that reads auth.users does so inside a
-- security-definer function already (getOrCreateApplication,
-- accept_staff_invite itself below) -- this is the same fix, just needed
-- here too because RLS policy expressions aren't security-definer
-- contexts on their own.
create or replace function app_current_user_email() returns text as $$
  select email from auth.users where id = auth.uid();
$$ language sql security definer stable set search_path = public;

drop policy if exists invitee_self_select on staff_invite;
create policy invitee_self_select on staff_invite for select
  using (lower(email) = lower(app_current_user_email()));

-- Validated self-provisioning: the invited person calls this after their
-- first sign-in. Authorization is the invite match itself, checked against
-- their real auth.uid()-derived email BEFORE any trusted-context
-- shortcuts are used -- this is the actual security boundary, not
-- decoration around it.
create or replace function accept_staff_invite() returns void as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_invite record;
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'Could not resolve your account email.';
  end if;

  select * into v_invite from staff_invite
    where lower(email) = lower(v_email) and accepted_at is null
    order by created_at desc
    limit 1;

  if v_invite is null then
    raise exception 'No pending invite found for %.', v_email;
  end if;

  -- Trusted-context shortcut for the guarded inserts below -- legitimate
  -- here because the actual authorization check (a genuine pending invite
  -- matching this real, server-verified email) already happened above,
  -- using v_uid captured before this point. Same auth.uid()-is-null
  -- trusted-context convention every other migration in this build
  -- already relies on for seeds/setup.
  perform set_config('request.jwt.claims', '{}', true);

  insert into user_profile (id, tenant_id, email, full_name)
    values (v_uid, v_invite.tenant_id, v_email, v_email)
    on conflict (id) do nothing;

  insert into membership (tenant_id, user_id, role_id)
    values (v_invite.tenant_id, v_uid, v_invite.role_id)
    on conflict (tenant_id, user_id) do update set role_id = excluded.role_id;

  update staff_invite set accepted_at = now() where id = v_invite.id;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function accept_staff_invite() to authenticated;
