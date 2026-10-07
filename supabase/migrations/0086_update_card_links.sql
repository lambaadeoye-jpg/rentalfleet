-- 0086: Update-card links. A renter whose card failed (or who has no card yet) opens a private link, goes to
-- Stripe's hosted page, and saves a new card WITHOUT being charged. Weekly billing always charges the newest saved
-- card, so the next scheduled attempt uses it automatically.
--
--   * Link = token (raw token lives only in the link; the database keeps its SHA-256 hash), good for 72 hours,
--     one open link per renter (a new one replaces the old).
--   * Created by: staff (Billing screen), the renter themselves (portal button, through the server), or the text-notice
--     job when it sends a "card declined" text.
--   * Works only while the 'payments_enabled' switch is on (the same switch as card payments).
--   * Nothing is recorded from the browser: only the verified Stripe webhook calls complete_card_update.
-- Safe to run twice.

create table if not exists card_update_request (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  customer_id uuid not null references customer(id),
  token_hash text not null unique,
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  authorized_at timestamptz,
  authorized_ip text,
  stripe_session_id text unique,
  stripe_session_url text,
  stripe_session_expires_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists card_update_request_customer_idx on card_update_request (customer_id, created_at desc);

alter table card_update_request enable row level security;
alter table card_update_request force row level security;
drop policy if exists tenant_isolation_select on card_update_request;
create policy tenant_isolation_select on card_update_request for select using (tenant_id in (select app_current_tenant_ids()));
-- No write policies: only the functions below write this table.

-- Create (or replace) the open link for one renter. Callers: staff (checked below) or the server with the service role
-- (auth.uid() is null; the server has already verified who the renter is).
create or replace function create_card_update_request(p_customer_id uuid, p_token_hash text, p_hours integer default 72)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  select c.tenant_id into v_tenant from customer c where c.id = p_customer_id;
  if v_tenant is null then raise exception 'customer_not_found'; end if;
  if auth.uid() is not null then
    perform reject_without_permission('manage_pricing');
    if v_tenant not in (select app_current_tenant_ids()) then raise exception 'customer_not_found'; end if;
  end if;
  if not _setting_on(v_tenant, 'payments_enabled', false) then raise exception 'payments_disabled'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_token'; end if;

  update card_update_request set revoked_at = now(), status = 'cancelled'
   where customer_id = p_customer_id and status = 'open' and revoked_at is null;
  insert into card_update_request (tenant_id, customer_id, token_hash, expires_at, created_by)
  values (v_tenant, p_customer_id, p_token_hash,
          now() + make_interval(hours => least(greatest(coalesce(p_hours, 72), 1), 168)), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Service: look up a link (also answers for finished links so the page can say so).
create or replace function get_card_update_request(p_token_hash text)
returns table (request_id uuid, first_name text, status text, expires_at timestamptz, completed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, c.first_name, r.status, r.expires_at, r.completed_at
    from card_update_request r join customer c on c.id = r.customer_id
   where r.token_hash = p_token_hash and r.revoked_at is null and r.expires_at > now()
     and _setting_on(r.tenant_id, 'payments_enabled', false)
$$;

-- Service: the renter ticked the authorization box and tapped Save. Records that, and returns what Stripe needs.
-- existing_url is set when a still-valid Stripe page already exists (double taps reuse it).
create or replace function begin_card_update(p_token_hash text, p_ip text)
returns table (request_id uuid, tenant_id uuid, customer_id uuid, email text, stripe_customer_id text, existing_url text)
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  select r.*, c.email::text as cust_email into v from card_update_request r join customer c on c.id = r.customer_id
   where r.token_hash = p_token_hash for update of r;
  if not found or v.revoked_at is not null or v.expires_at <= now() or not _setting_on(v.tenant_id, 'payments_enabled', false) then
    raise exception 'link_invalid';
  end if;
  if v.status <> 'open' then raise exception 'not_open'; end if;
  update card_update_request set authorized_at = now(), authorized_ip = left(p_ip, 64) where id = v.id;
  request_id := v.id; tenant_id := v.tenant_id; customer_id := v.customer_id; email := v.cust_email;
  -- Reuse the renter's Stripe customer so every card stays under one customer in Stripe.
  select m.stripe_customer_id into stripe_customer_id from customer_payment_method m
   where m.tenant_id = v.tenant_id and m.customer_id = v.customer_id order by m.created_at desc limit 1;
  existing_url := case when v.stripe_session_url is not null and v.stripe_session_expires_at > now() + interval '2 minutes' then v.stripe_session_url end;
  return next;
end;
$$;

create or replace function attach_card_update_session(p_request_id uuid, p_session_id text, p_url text, p_expires_at timestamptz)
returns void language sql security definer set search_path = public as $$
  update card_update_request set stripe_session_id = p_session_id, stripe_session_url = p_url, stripe_session_expires_at = p_expires_at
   where id = p_request_id and status = 'open'
$$;

-- Service (verified webhook only): the card was saved. Idempotent. The newest saved card is the one billing uses, so a
-- card the renter re-adds is bumped to newest. Returns saved | duplicate | already_done | not_found.
create or replace function complete_card_update(
  p_event_id text, p_session_id text, p_request_id uuid, p_stripe_customer text, p_pm text,
  p_brand text, p_last4 text, p_exp_month integer, p_exp_year integer, p_billing_name text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  insert into stripe_event (id) values (p_event_id) on conflict do nothing;
  if not found then return 'duplicate'; end if;

  select * into v from card_update_request r where r.id = p_request_id and r.stripe_session_id = p_session_id for update;
  if not found then
    delete from stripe_event where id = p_event_id; -- let Stripe's retry succeed once the session is attached
    return 'not_found';
  end if;
  if v.status = 'completed' then return 'already_done'; end if;
  if p_pm is null or p_pm !~ '^pm_[A-Za-z0-9_]+$' or p_stripe_customer is null or p_stripe_customer !~ '^cus_[A-Za-z0-9_]+$' then
    delete from stripe_event where id = p_event_id;
    return 'not_found';
  end if;

  insert into customer_payment_method (tenant_id, customer_id, stripe_customer_id, stripe_payment_method_id, brand, last4, exp_month, exp_year, billing_name, created_at)
  values (v.tenant_id, v.customer_id, p_stripe_customer, p_pm, left(p_brand, 30), left(p_last4, 4), p_exp_month, p_exp_year, left(p_billing_name, 120), clock_timestamp())
  on conflict (tenant_id, stripe_payment_method_id) do update set created_at = clock_timestamp();

  update card_update_request set status = 'completed', completed_at = now() where id = v.id;
  insert into audit_event (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  values (v.tenant_id, null, 'card_updated', 'customer', v.customer_id,
          jsonb_build_object('last4', left(p_last4, 4), 'brand', left(p_brand, 30)), 'complete_card_update');
  return 'saved';
end;
$$;

-- Service: the Stripe page expired unsaved; let the renter start again. Safe to call for any session id.
create or replace function expire_card_update_session(p_session_id text)
returns void language sql security definer set search_path = public as $$
  update card_update_request set stripe_session_id = null, stripe_session_url = null, stripe_session_expires_at = null
   where stripe_session_id = p_session_id and status = 'open'
$$;

revoke all on function create_card_update_request(uuid, text, integer) from public, anon;
grant execute on function create_card_update_request(uuid, text, integer) to authenticated;
revoke all on function get_card_update_request(text) from public, anon, authenticated;
revoke all on function begin_card_update(text, text) from public, anon, authenticated;
revoke all on function attach_card_update_session(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function complete_card_update(text, text, uuid, text, text, text, text, integer, integer, text) from public, anon, authenticated;
revoke all on function expire_card_update_session(text) from public, anon, authenticated;
