-- 0098_renter_write_hardening.sql
--
-- Closes holes found in the full audit: row-level security let a signed-in
-- renter (including an anonymous applicant) write columns that only staff
-- should control, and let the public lead form be abused to trigger outbound
-- texts and calls. Everything here is additive and idempotent.
--
-- Who counts as a "renter session": a signed-in database user (auth.uid() is
-- not null) who has no staff membership. The service role (auth.uid() is
-- null) and staff are trusted and unchanged.

create or replace function app_is_renter_session() returns boolean as $$
  select auth.uid() is not null
     and not exists (select 1 from membership m where m.user_id = auth.uid());
$$ language sql stable security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 1. customer: a renter edits their profile, never status / tenant / owner
-- ---------------------------------------------------------------------------
create or replace function guard_customer_renter_write() returns trigger as $$
begin
  if not app_is_renter_session() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'applicant';
  else
    new.status := old.status;
    new.tenant_id := old.tenant_id;
    new.auth_user_id := old.auth_user_id;
    new.referral_code := old.referral_code;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists customer_renter_write_guard on customer;
create trigger customer_renter_write_guard
  before insert or update on customer
  for each row execute function guard_customer_renter_write();

-- ---------------------------------------------------------------------------
-- 2. application: starts as a draft; a renter can only move draft -> submitted
--    and never touches decision or call-outcome fields
-- ---------------------------------------------------------------------------
create or replace function guard_application_renter_write() returns trigger as $$
begin
  if not app_is_renter_session() then
    return new;
  end if;
  new.tenant_id := (select c.tenant_id from customer c where c.id = new.customer_id);
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.decision_at := null;
    new.decision_reason := null;
    return new;
  end if;
  new.tenant_id := old.tenant_id;
  new.customer_id := old.customer_id;
  new.decision_at := old.decision_at;
  new.decision_reason := old.decision_reason;
  new.last_call_outcome := old.last_call_outcome;
  new.last_call_at := old.last_call_at;
  new.last_call_summary := old.last_call_summary;
  new.last_call_committed_time := old.last_call_committed_time;
  new.last_call_blocker := old.last_call_blocker;
  new.needs_human_followup := old.needs_human_followup;
  new.abandonment_reminder_sent_at := old.abandonment_reminder_sent_at;
  if new.status is distinct from old.status
     and not (old.status = 'draft' and new.status = 'submitted') then
    new.status := old.status;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists application_renter_write_guard on application;
create trigger application_renter_write_guard
  before insert or update on application
  for each row execute function guard_application_renter_write();

-- ---------------------------------------------------------------------------
-- 3. Rows a renter creates for themselves can never arrive pre-verified
-- ---------------------------------------------------------------------------
create or replace function guard_insurance_renter_write() returns trigger as $$
begin
  if not app_is_renter_session() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.tenant_id := (select c.tenant_id from customer c where c.id = new.customer_id);
    new.verification_status := 'pending';
    new.policy_type := 'renter';
    new.vehicle_id := null;
    new.rental_id := null;
    new.evidence := '{}'::jsonb;
  else
    new.tenant_id := old.tenant_id;
    new.customer_id := old.customer_id;
    new.policy_type := old.policy_type;
    new.vehicle_id := old.vehicle_id;
    new.rental_id := old.rental_id;
    new.evidence := old.evidence;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists insurance_renter_write_guard on insurance_policy;
create trigger insurance_renter_write_guard
  before insert or update on insurance_policy
  for each row execute function guard_insurance_renter_write();

create or replace function guard_document_renter_write() returns trigger as $$
begin
  if not app_is_renter_session() then
    return new;
  end if;
  new.tenant_id := (select c.tenant_id from customer c where c.id = new.customer_id);
  new.review_status := 'pending';
  new.review_note := null;
  new.reviewed_at := null;
  new.reviewed_by := null;
  new.source := 'applicant';
  new.upload_request_id := null;
  -- The file must sit in the renter's own folder: {tenant}/{customer}/...
  if new.storage_key is null
     or new.storage_key not like (new.tenant_id::text || '/' || new.customer_id::text || '/%') then
    raise exception 'Document must be stored in your own folder';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists document_renter_write_guard on customer_document;
create trigger document_renter_write_guard
  before insert on customer_document
  for each row execute function guard_document_renter_write();

create or replace function guard_platform_renter_write() returns trigger as $$
begin
  if not app_is_renter_session() then
    return new;
  end if;
  new.tenant_id := (select c.tenant_id from customer c where c.id = new.customer_id);
  new.verification_status := 'pending';
  new.verified_at := null;
  new.evidence := '{}'::jsonb;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists platform_renter_write_guard on platform_eligibility;
create trigger platform_renter_write_guard
  before insert on platform_eligibility
  for each row execute function guard_platform_renter_write();

create or replace function guard_driver_renter_write() returns trigger as $$
begin
  if not app_is_renter_session() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.tenant_id := (select c.tenant_id from customer c where c.id = new.customer_id);
    new.status := 'pending';
    new.verified_at := null;
    new.rental_id := null;
  else
    new.tenant_id := old.tenant_id;
    new.customer_id := old.customer_id;
    new.status := old.status;
    new.verified_at := old.verified_at;
    new.rental_id := old.rental_id;
    new.is_primary := old.is_primary;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists driver_renter_write_guard on authorized_driver;
create trigger driver_renter_write_guard
  before insert or update on authorized_driver
  for each row execute function guard_driver_renter_write();

-- A renter can remove an additional driver they listed (never their own
-- licence row). Without this, "save drivers" re-inserted duplicates and
-- "remove driver" in the portal silently did nothing.
drop policy if exists customer_self_delete on authorized_driver;
create policy customer_self_delete on authorized_driver for delete
  using (customer_id = app_current_customer_id() and is_primary = false);

-- ---------------------------------------------------------------------------
-- 4. support_ticket: renter chooses only the subject
-- ---------------------------------------------------------------------------
create or replace function guard_ticket_renter_write() returns trigger as $$
begin
  if not app_is_renter_session() then
    return new;
  end if;
  new.tenant_id := (select c.tenant_id from customer c where c.id = new.customer_id);
  new.status := 'open';
  new.priority := 'normal';
  if new.rental_id is not null
     and not exists (select 1 from rental r where r.id = new.rental_id and r.customer_id = new.customer_id) then
    new.rental_id := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists ticket_renter_write_guard on support_ticket;
create trigger ticket_renter_write_guard
  before insert on support_ticket
  for each row execute function guard_ticket_renter_write();

-- ---------------------------------------------------------------------------
-- 5. communication_event: renters only ever read their own history. A renter
--    could forge "auth_failed" rows to lock any phone out of voice
--    verification, or fake inbound replies to move leads between stages.
-- ---------------------------------------------------------------------------
drop policy if exists customer_self_insert on communication_event;

-- ---------------------------------------------------------------------------
-- 6. Public lead form: stop it being a free text/call cannon
-- ---------------------------------------------------------------------------
create or replace function guard_lead_public_insert() returns trigger as $$
declare
  v_phone text := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
  v_recent integer;
  v_flood integer;
begin
  -- Staff, the service role and the app's own definer functions are unchanged.
  -- (current_user would be the function owner here, so read the request role.)
  if coalesce(current_setting('role', true), '') not in ('anon', 'authenticated') or (auth.uid() is not null and not app_is_renter_session()) then
    return new;
  end if;

  new.customer_id := null;
  new.assigned_user_id := null;
  new.stage := 'new';

  -- The same person can try again, but not repeatedly: 3 per day per phone/email.
  select count(*) into v_recent
    from lead l
   where l.tenant_id = new.tenant_id
     and l.created_at > now() - interval '24 hours'
     and ((v_phone <> '' and regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') = v_phone)
          or (new.email is not null and l.email = new.email));
  if v_recent >= 3 then
    raise exception 'Too many requests for this contact. Please try again tomorrow.';
  end if;

  -- Overall brake against scripted floods (each lead can queue texts and a call).
  select count(*) into v_flood
    from lead l
   where l.tenant_id = new.tenant_id
     and l.created_at > now() - interval '10 minutes';
  if v_flood >= 120 then
    raise exception 'We are receiving a lot of requests right now. Please try again shortly.';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists lead_public_insert_guard on lead;
create trigger lead_public_insert_guard
  before insert on lead
  for each row execute function guard_lead_public_insert();

create index if not exists idx_lead_tenant_created on lead (tenant_id, created_at desc);

-- link_referral: only a brand-new, still-unreferred lead can be linked, so a
-- referral code cannot be pointed at arbitrary existing leads.
create or replace function link_referral(p_referral_code text, p_lead_id uuid) returns void as $$
declare
  v_referrer_id uuid;
  v_tenant_id uuid;
  v_referrer_phone text;
  v_referrer_email citext;
  v_lead_phone text;
  v_lead_email citext;
begin
  if p_referral_code is null or trim(p_referral_code) = '' then
    return;
  end if;

  select id, tenant_id, phone, email into v_referrer_id, v_tenant_id, v_referrer_phone, v_referrer_email
  from customer where referral_code = p_referral_code;

  if v_referrer_id is null then
    return;
  end if;

  select phone, email into v_lead_phone, v_lead_email from lead where id = p_lead_id;

  -- Self-referral prevention (from 0048).
  if (v_lead_phone is not null and v_lead_phone = v_referrer_phone)
     or (v_lead_email is not null and v_lead_email = v_referrer_email) then
    return;
  end if;

  update lead set referred_by_customer_id = v_referrer_id
   where id = p_lead_id
     and tenant_id = v_tenant_id
     and referred_by_customer_id is null
     and created_at > now() - interval '15 minutes';
  if not found then
    return;
  end if;

  insert into referral (tenant_id, referrer_customer_id, referred_lead_id)
    values (v_tenant_id, v_referrer_id, p_lead_id)
    on conflict (referrer_customer_id, referred_lead_id) do nothing;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function link_referral(text, uuid) to anon;

-- The watch-list check is no longer a public oracle: only the server calls it.
revoke execute on function check_red_flag(uuid, text, text, text, text) from anon, public;
grant execute on function check_red_flag(uuid, text, text, text, text) to service_role;

-- A tenant's spend limit is not public either (signed-in staff keep it, since
-- the work-order trigger runs as the signed-in user).
revoke execute on function maintenance_approval_limit(uuid) from anon, public;
grant execute on function maintenance_approval_limit(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Storage: ID documents are visible to staff who review applications, not
--    to every tenant member; a renter can only write into their own tenant's
--    own folder.
-- ---------------------------------------------------------------------------
drop policy if exists applicant_own_documents_insert on storage.objects;
create policy applicant_own_documents_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'applicant-documents'
    and (storage.foldername(name))[2] = (select app_current_customer_id())::text
    and (storage.foldername(name))[1] in (
      select c.tenant_id::text from customer c where c.id = (select app_current_customer_id())
    )
  );

drop policy if exists staff_tenant_documents_select on storage.objects;
create policy staff_tenant_documents_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'applicant-documents'
    and (storage.foldername(name))[1] in (select app_current_tenant_ids()::text)
    and app_has_permission('approve_driver')
  );

update storage.buckets
   set file_size_limit = 15728640,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
 where id = 'applicant-documents';

-- ---------------------------------------------------------------------------
-- 8. Missing indexes on hot lookups (RLS and automation paths)
-- ---------------------------------------------------------------------------
create index if not exists idx_membership_user on membership (user_id);
create index if not exists idx_rental_customer on rental (customer_id);
create index if not exists idx_payment_rental on payment (rental_id);
create index if not exists idx_payment_customer on payment (customer_id);
create index if not exists idx_application_customer on application (customer_id);
create index if not exists idx_customer_document_customer on customer_document (customer_id);
create index if not exists idx_support_ticket_customer on support_ticket (customer_id);
create index if not exists idx_rental_segment_rental on rental_segment (rental_id);
create index if not exists idx_payment_schedule_rental on payment_schedule (rental_id);
create index if not exists idx_charge_rental on charge (rental_id);

-- One pickup inspection per rental, so two taps at once (or a retry after a
-- dropped signal) cannot split the photos across two records. Skipped when
-- old duplicates exist; the app reads the oldest one in that case.
do $$ begin
  create unique index if not exists uq_inspection_rental_pickup
    on inspection (rental_id) where inspection_type = 'pickup' and rental_id is not null;
exception when unique_violation then
  raise notice 'Duplicate pickup inspections exist; unique index not created.';
end $$;

-- ---------------------------------------------------------------------------
-- 9. Signing: names with accents (José, Zoë, Renée) could never match, because
--    the database stripped accented letters from what was typed. Both sides are
--    now folded to plain lowercase letters before comparing. Everything else in
--    complete_signing is unchanged from 0075.
-- ---------------------------------------------------------------------------
create or replace function fold_name(p text) returns text as $$
  select translate(lower(coalesce(p, '')),
    'áàâäãåāăąćčçďéèêëēěęğíìîïīıłñńňóòôöõøōőřśšşťúùûüūůűýÿźžż',
    'aaaaaaaaaccc' || 'd' || 'eeeeeeeg' || 'iiiiiil' || 'nnn' || 'oooooooo' || 'r' || 'sss' || 't' || 'uuuuuuu' || 'yy' || 'zzz');
$$ language sql immutable;

create or replace function complete_signing(
  p_token_hash text, p_typed_name text, p_initials jsonb, p_esign_consent boolean, p_ip text, p_ua text, p_storage_key text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
  v_cust record;
  v_clause jsonb;
  v_kept jsonb := '{}'::jsonb;
  v_val text;
  v_words text[];
  v_id uuid;
  v_first text;
  v_last text;
begin
  select s.* into v_req from sign_request s where s.token_hash = p_token_hash for update;
  if not found or v_req.revoked_at is not null or v_req.expires_at <= now()
     or coalesce((select ts.value from tenant_setting ts where ts.tenant_id = v_req.tenant_id and ts.key = 'agreement_signing_enabled'), 'on') = 'off' then
    raise exception 'link_invalid';
  end if;
  if v_req.signed_at is not null then raise exception 'already_signed'; end if;
  if not coalesce(p_esign_consent, false) then raise exception 'consent_required'; end if;

  select c.first_name, c.last_name into v_cust from customer c where c.id = v_req.customer_id;
  v_words := regexp_split_to_array(btrim(regexp_replace(fold_name(coalesce(p_typed_name, '')), '[^a-z\s''-]', ' ', 'g')), '\s+');
  v_first := split_part(btrim(fold_name(coalesce(v_cust.first_name, ''))), ' ', 1);
  v_last := btrim(fold_name(coalesce(v_cust.last_name, '')));
  v_last := (regexp_split_to_array(v_last, '\s+'))[array_length(regexp_split_to_array(v_last, '\s+'), 1)];
  if array_length(v_words, 1) is null or array_length(v_words, 1) < 2
     or v_words[1] <> v_first or v_words[array_length(v_words, 1)] <> v_last then
    raise exception 'name_mismatch';
  end if;

  for v_clause in select e.value from jsonb_array_elements(v_req.rendered->'clauses') as e(value) loop
    if coalesce((v_clause->>'initial')::boolean, false) then
      v_val := btrim(coalesce(p_initials->>(v_clause->>'number'), ''));
      if v_val !~ '^[A-Za-z]{2,4}$' then raise exception 'initials_required'; end if;
      v_kept := v_kept || jsonb_build_object(v_clause->>'number', upper(v_val));
    end if;
  end loop;

  if p_storage_key is null or p_storage_key not like v_req.tenant_id::text || '/' || v_req.customer_id::text || '/%' then
    raise exception 'invalid_storage_key';
  end if;

  insert into signed_document (tenant_id, rental_id, document_version_id, storage_key, signed_at, signer_customer_id,
                               rendered_agreement, content_hash, signer_name, initials, esign_consent, signature_ip, signature_user_agent, sign_request_id)
  values (v_req.tenant_id, v_req.rental_id, v_req.document_version_id, p_storage_key, now(), v_req.customer_id,
          v_req.rendered, v_req.content_hash, left(btrim(p_typed_name), 120), v_kept, true, left(p_ip, 64), left(p_ua, 300), v_req.id)
  returning id into v_id;
  update sign_request set signed_at = now() where id = v_req.id;
  return v_id;
end;
$$;


revoke all on function complete_signing(text, text, jsonb, boolean, text, text, text) from public, anon, authenticated;
