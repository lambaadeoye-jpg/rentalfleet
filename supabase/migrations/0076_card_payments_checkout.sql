-- 0076: card payments through Stripe Checkout (Phase 3D).
--
-- A staff member (or the renter from the portal) creates a payment request for
-- a scheduled rental: first week's rent + the refundable deposit, computed by
-- the app. The renter opens a private link, reads the refund terms, ticks the
-- box, and is sent to Stripe's hosted card page (card only; the card is saved
-- for later charges). Stripe's webhook then records the payments, holds the
-- deposit, and confirms any pending pickup slot. Nothing is recorded from the
-- browser: only the verified webhook calls complete_pay_request.
--
-- tenant_setting 'payments_enabled' must be 'on' (default off) for links to work.
-- 'payments_require_signature' = 'off' lets a link be made before the agreement
-- is signed (default: the agreement must be signed first).

create table if not exists pay_request (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid not null references rental(id),
  customer_id uuid not null references customer(id),
  token_hash text not null unique,
  rent_cents integer not null check (rent_cents >= 0),
  deposit_cents integer not null check (deposit_cents >= 0),
  terms_lines jsonb not null,
  terms_hash text not null,
  status text not null default 'open' check (status in ('open', 'paid', 'review', 'cancelled')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  terms_accepted_at timestamptz,
  terms_accepted_ip text,
  stripe_session_id text unique,
  stripe_session_url text,
  stripe_session_expires_at timestamptz,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  card_name_matches boolean,
  review_note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint pay_request_total_check check (rent_cents + deposit_cents between 50 and 500000)
);
create index if not exists pay_request_rental_idx on pay_request (rental_id, created_at desc);

create table if not exists stripe_event (
  id text primary key,
  received_at timestamptz not null default now()
);

create table if not exists customer_payment_method (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  customer_id uuid not null references customer(id),
  stripe_customer_id text not null,
  stripe_payment_method_id text not null,
  brand text,
  last4 text,
  exp_month integer,
  exp_year integer,
  billing_name text,
  created_at timestamptz not null default now(),
  unique (tenant_id, stripe_payment_method_id)
);

alter table pay_request enable row level security;
alter table pay_request force row level security;
alter table stripe_event enable row level security;
alter table stripe_event force row level security;
alter table customer_payment_method enable row level security;
alter table customer_payment_method force row level security;

drop policy if exists tenant_isolation_select on pay_request;
create policy tenant_isolation_select on pay_request for select using (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_select on customer_payment_method;
create policy tenant_isolation_select on customer_payment_method for select using (tenant_id in (select app_current_tenant_ids()));
drop policy if exists customer_self_select on customer_payment_method;
create policy customer_self_select on customer_payment_method for select using (customer_id = app_current_customer_id());
-- stripe_event: no policies (service role only). No write policies anywhere here.

create or replace function _setting_on(p_tenant uuid, p_key text, p_default boolean)
returns boolean language sql stable set search_path = public as $$
  select coalesce(
    (select case lower(ts.value) when 'on' then true when 'off' then false end from tenant_setting ts where ts.tenant_id = p_tenant and ts.key = p_key),
    p_default)
$$;

-- Create a payment request (staff, or the service role for the renter portal).
create or replace function create_pay_request(
  p_rental_id uuid, p_token_hash text, p_rent_cents integer, p_deposit_cents integer, p_terms jsonb, p_terms_hash text, p_hours integer default 72
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_rental record;
  v_id uuid;
begin
  select r.id, r.tenant_id, r.customer_id, r.status into v_rental from rental r where r.id = p_rental_id;
  if not found then raise exception 'rental_not_found'; end if;
  if auth.uid() is not null and v_rental.tenant_id not in (select app_current_tenant_ids()) then raise exception 'rental_not_found'; end if;
  if not _setting_on(v_rental.tenant_id, 'payments_enabled', false) then raise exception 'payments_disabled'; end if;
  if v_rental.status not in ('approved', 'scheduled') then raise exception 'rental_not_payable'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_terms_hash is null or p_terms_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_token'; end if;
  if p_terms is null or jsonb_typeof(p_terms) <> 'array' or jsonb_array_length(p_terms) = 0 then raise exception 'terms_required'; end if;
  if coalesce(p_rent_cents, -1) < 0 or coalesce(p_deposit_cents, -1) < 0 or p_rent_cents + p_deposit_cents < 50 or p_rent_cents + p_deposit_cents > 500000 then
    raise exception 'invalid_amount';
  end if;
  if _setting_on(v_rental.tenant_id, 'payments_require_signature', true)
     and not exists (select 1 from signed_document s where s.rental_id = p_rental_id and s.sign_request_id is not null) then
    raise exception 'agreement_not_signed';
  end if;

  update pay_request set revoked_at = now(), status = 'cancelled' where rental_id = p_rental_id and status = 'open';
  insert into pay_request (tenant_id, rental_id, customer_id, token_hash, rent_cents, deposit_cents, terms_lines, terms_hash, expires_at, created_by)
  values (v_rental.tenant_id, p_rental_id, v_rental.customer_id, p_token_hash, p_rent_cents, p_deposit_cents, p_terms, p_terms_hash,
          now() + make_interval(hours => least(greatest(coalesce(p_hours, 72), 1), 168)), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Service: look up a payment link (also answers for paid links so the page can say so).
create or replace function get_pay_request(p_token_hash text)
returns table (request_id uuid, tenant_id uuid, rental_id uuid, customer_id uuid, first_name text, last_name text, email text,
               rent_cents integer, deposit_cents integer, terms_lines jsonb, status text, expires_at timestamptz,
               terms_accepted_at timestamptz, stripe_session_url text, stripe_session_expires_at timestamptz, paid_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.tenant_id, p.rental_id, p.customer_id, c.first_name, c.last_name, c.email::text,
         p.rent_cents, p.deposit_cents, p.terms_lines, p.status, p.expires_at, p.terms_accepted_at,
         p.stripe_session_url, p.stripe_session_expires_at, p.paid_at
    from pay_request p join customer c on c.id = p.customer_id
   where p.token_hash = p_token_hash and p.revoked_at is null and p.expires_at > now()
     and _setting_on(p.tenant_id, 'payments_enabled', false)
$$;

-- Service: the renter ticked the refund-terms box. Records that, and returns whether a fresh Stripe session is needed.
create or replace function begin_checkout(p_token_hash text, p_ip text)
returns table (request_id uuid, tenant_id uuid, rental_id uuid, customer_id uuid, email text, rent_cents integer, deposit_cents integer,
               existing_url text)
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  select p.*, c.email::text as cust_email into v from pay_request p join customer c on c.id = p.customer_id
   where p.token_hash = p_token_hash for update of p;
  if not found or v.revoked_at is not null or v.expires_at <= now() or not _setting_on(v.tenant_id, 'payments_enabled', false) then
    raise exception 'link_invalid';
  end if;
  if v.status <> 'open' then raise exception 'not_open'; end if;
  if _setting_on(v.tenant_id, 'payments_require_signature', true)
     and not exists (select 1 from signed_document s where s.rental_id = v.rental_id and s.sign_request_id is not null) then
    raise exception 'agreement_not_signed';
  end if;
  update pay_request set terms_accepted_at = now(), terms_accepted_ip = left(p_ip, 64) where id = v.id;
  request_id := v.id; tenant_id := v.tenant_id; rental_id := v.rental_id; customer_id := v.customer_id; email := v.cust_email;
  rent_cents := v.rent_cents; deposit_cents := v.deposit_cents;
  existing_url := case when v.stripe_session_url is not null and v.stripe_session_expires_at > now() + interval '2 minutes' then v.stripe_session_url end;
  return next;
end;
$$;

create or replace function attach_checkout_session(p_request_id uuid, p_session_id text, p_url text, p_expires_at timestamptz)
returns void language sql security definer set search_path = public as $$
  update pay_request set stripe_session_id = p_session_id, stripe_session_url = p_url, stripe_session_expires_at = p_expires_at
   where id = p_request_id and status = 'open'
$$;

-- Service (verified webhook only): payment succeeded. Idempotent. One Stripe
-- payment becomes a rent row and a deposit row, so provider_payment_id carries a
-- '#rent' / '#deposit' suffix (unique per row); metadata.payment_intent has the
-- real Stripe id for refunds. Returns
-- paid | duplicate | already_paid | amount_mismatch | not_found
create or replace function complete_pay_request(
  p_event_id text, p_session_id text, p_request_id uuid, p_payment_intent text, p_amount_total_cents integer, p_card_name_matches boolean
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_hold uuid;
  v_dep record;
begin
  insert into stripe_event (id) values (p_event_id) on conflict do nothing;
  if not found then return 'duplicate'; end if;

  select * into v from pay_request p where p.id = p_request_id and p.stripe_session_id = p_session_id for update;
  if not found then
    -- Not recorded as handled, so Stripe's retry can succeed once the session is attached.
    delete from stripe_event where id = p_event_id;
    return 'not_found';
  end if;
  if v.status = 'paid' then return 'already_paid'; end if;
  if p_amount_total_cents is distinct from (v.rent_cents + v.deposit_cents) then
    update pay_request set status = 'review', stripe_payment_intent_id = p_payment_intent,
           review_note = 'Stripe charged ' || coalesce(p_amount_total_cents::text, '?') || ' cents; expected ' || (v.rent_cents + v.deposit_cents)::text
     where id = v.id;
    return 'amount_mismatch';
  end if;

  if v.rent_cents > 0 then
    insert into payment (tenant_id, rental_id, customer_id, provider, provider_payment_id, method_type, amount, status, paid_at, kind, metadata)
    values (v.tenant_id, v.rental_id, v.customer_id, 'stripe', p_payment_intent || '#rent', 'card', v.rent_cents / 100.0, 'paid', now(), 'rent',
            jsonb_build_object('pay_request_id', v.id, 'payment_intent', p_payment_intent));
  end if;
  if v.deposit_cents > 0 then
    insert into payment (tenant_id, rental_id, customer_id, provider, provider_payment_id, method_type, amount, status, paid_at, kind, metadata)
    values (v.tenant_id, v.rental_id, v.customer_id, 'stripe', p_payment_intent || '#deposit', 'card', v.deposit_cents / 100.0, 'paid', now(), 'deposit',
            jsonb_build_object('pay_request_id', v.id, 'payment_intent', p_payment_intent));
    select d.id, d.amount_collected, d.refundable_amount into v_dep from deposit d where d.rental_id = v.rental_id and d.status = 'held';
    if found then
      update deposit set amount_collected = v_dep.amount_collected + v.deposit_cents / 100.0,
                         refundable_amount = coalesce(v_dep.refundable_amount, v_dep.amount_collected) + v.deposit_cents / 100.0
       where id = v_dep.id;
    else
      insert into deposit (tenant_id, rental_id, amount_collected, refundable_amount, status)
      values (v.tenant_id, v.rental_id, v.deposit_cents / 100.0, v.deposit_cents / 100.0, 'held');
    end if;
  end if;

  update pay_request set status = 'paid', paid_at = now(), stripe_payment_intent_id = p_payment_intent, card_name_matches = p_card_name_matches
   where id = v.id;

  -- A pickup time held "until payment" becomes firm now.
  select h.id into v_hold from slot_hold h where h.rental_id = v.rental_id and h.status = 'held' and h.expires_at > now() limit 1;
  if v_hold is not null then perform confirm_pickup_slot(v_hold, null, 'payment'); end if;
  return 'paid';
end;
$$;

-- Service: the Checkout session expired unpaid; let the renter start again.
create or replace function expire_checkout_session(p_event_id text, p_session_id text)
returns text language plpgsql security definer set search_path = public as $$
begin
  insert into stripe_event (id) values (p_event_id) on conflict do nothing;
  if not found then return 'duplicate'; end if;
  update pay_request set stripe_session_id = null, stripe_session_url = null, stripe_session_expires_at = null
   where stripe_session_id = p_session_id and status = 'open';
  return 'expired';
end;
$$;

create or replace function save_payment_method(
  p_request_id uuid, p_stripe_customer text, p_pm text, p_brand text, p_last4 text, p_exp_month integer, p_exp_year integer, p_billing_name text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  select p.tenant_id, p.customer_id into v from pay_request p where p.id = p_request_id;
  if not found or p_pm is null or p_stripe_customer is null then return; end if;
  insert into customer_payment_method (tenant_id, customer_id, stripe_customer_id, stripe_payment_method_id, brand, last4, exp_month, exp_year, billing_name)
  values (v.tenant_id, v.customer_id, p_stripe_customer, p_pm, left(p_brand, 30), left(p_last4, 4), p_exp_month, p_exp_year, left(p_billing_name, 120))
  on conflict (tenant_id, stripe_payment_method_id) do nothing;
end;
$$;

-- Service (webhook): the renter's name, to compare with the name on the card.
create or replace function get_pay_request_names(p_request_id uuid)
returns table (first_name text, last_name text)
language sql stable security definer set search_path = public as $$
  select c.first_name, c.last_name from pay_request p join customer c on c.id = p.customer_id where p.id = p_request_id
$$;

revoke all on function _setting_on(uuid, text, boolean) from public, anon, authenticated;
revoke all on function create_pay_request(uuid, text, integer, integer, jsonb, text, integer) from public, anon;
grant execute on function create_pay_request(uuid, text, integer, integer, jsonb, text, integer) to authenticated;
revoke all on function get_pay_request(text) from public, anon, authenticated;
revoke all on function begin_checkout(text, text) from public, anon, authenticated;
revoke all on function attach_checkout_session(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function complete_pay_request(text, text, uuid, text, integer, boolean) from public, anon, authenticated;
revoke all on function expire_checkout_session(text, text) from public, anon, authenticated;
revoke all on function save_payment_method(uuid, text, text, text, text, integer, integer, text) from public, anon, authenticated;
revoke all on function get_pay_request_names(uuid) from public, anon, authenticated;
