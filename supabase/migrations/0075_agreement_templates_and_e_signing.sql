-- 0075: rental agreement templates, e-sign links and signed records (Phase 3C).
--
-- Template: stored in document_version (type 'rental_agreement'). A version is
-- 'draft' (editable) until an admin approves it; approval locks it forever
-- (immutable). The newest approved version is the one used. Approval needs
-- 'manage_pricing_policy', and an explicit acknowledgement while any
-- [Counsel: ...] note is still in the text.
--
-- Signing: staff create a private expiring link for a rental. The agreement is
-- rendered (every blank filled) when the link is made and frozen on the
-- request, so what the renter sees is what gets signed. Signing records the
-- exact text, its hash, typed name, per-clause initials, e-sign consent, time,
-- IP and device. Signed records can never be changed or deleted.
--
-- tenant_setting 'agreement_signing_enabled' = 'off' is a kill switch.

alter table document_version add column if not exists title text;
alter table document_version add column if not exists clauses jsonb;
alter table document_version add column if not exists variables jsonb not null default '{}'::jsonb;
alter table document_version add column if not exists status text not null default 'draft';
alter table document_version add column if not exists approved_at timestamptz;
alter table document_version add column if not exists approved_by uuid;
alter table document_version add column if not exists notes_acknowledged boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'document_version_status_check') then
    alter table document_version add constraint document_version_status_check check (status in ('draft', 'approved'));
  end if;
end $$;
-- Rows that existed before this feature were never used for signing.
-- effective_from is required by the old schema; drafts get "now".

-- Create or update a DRAFT. p_template = {"intro": "...", "clauses": [...]}.
create or replace function save_agreement_draft(p_version_id uuid, p_title text, p_template jsonb, p_variables jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_id uuid;
  v_status text;
begin
  perform reject_without_permission('manage_pricing_policy');
  if p_template is null or jsonb_typeof(p_template) <> 'object'
     or jsonb_typeof(p_template->'clauses') <> 'array' or coalesce(nullif(btrim(p_template->>'intro'), ''), '') = '' then
    raise exception 'invalid_template';
  end if;
  if p_variables is null or jsonb_typeof(p_variables) <> 'object' then raise exception 'invalid_template'; end if;

  if p_version_id is null then
    select m.tenant_id into v_tenant from membership m where m.user_id = auth.uid() limit 1;
    if v_tenant is null then raise exception 'not_found'; end if;
    insert into document_version (tenant_id, document_type, version, title, clauses, variables, status, effective_from)
    values (v_tenant, 'rental_agreement',
            coalesce((select max(d.version) from document_version d where d.tenant_id = v_tenant and d.document_type = 'rental_agreement'), 0) + 1,
            left(coalesce(nullif(btrim(p_title), ''), 'Rental agreement'), 120), p_template, p_variables, 'draft', now())
    returning id into v_id;
    return v_id;
  end if;

  select d.tenant_id, d.status into v_tenant, v_status from document_version d
   where d.id = p_version_id and d.document_type = 'rental_agreement';
  if not found or v_tenant not in (select app_current_tenant_ids()) then raise exception 'not_found'; end if;
  if v_status <> 'draft' then raise exception 'not_a_draft'; end if;
  update document_version
     set title = left(coalesce(nullif(btrim(p_title), ''), title, 'Rental agreement'), 120), clauses = p_template, variables = p_variables
   where id = p_version_id;
  return p_version_id;
end;
$$;

create or replace function approve_agreement_version(p_version_id uuid, p_ack_notes boolean default false)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v record;
begin
  perform reject_without_permission('manage_pricing_policy');
  select d.* into v from document_version d where d.id = p_version_id and d.document_type = 'rental_agreement';
  if not found or v.tenant_id not in (select app_current_tenant_ids()) then raise exception 'not_found'; end if;
  if v.status <> 'draft' then raise exception 'not_a_draft'; end if;
  if v.clauses is null or jsonb_typeof(v.clauses->'clauses') <> 'array' or jsonb_array_length(v.clauses->'clauses') = 0 then
    raise exception 'invalid_template';
  end if;
  if v.clauses::text ~* '\[counsel' and not coalesce(p_ack_notes, false) then raise exception 'counsel_notes_open'; end if;
  update document_version
     set status = 'approved', approved_at = now(), approved_by = auth.uid(), notes_acknowledged = coalesce(p_ack_notes, false),
         effective_from = now(), immutable = true
   where id = p_version_id;
  return true;
end;
$$;

create table if not exists sign_request (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  rental_id uuid not null references rental(id),
  customer_id uuid not null references customer(id),
  document_version_id uuid not null references document_version(id),
  token_hash text not null unique,
  rendered jsonb not null,
  content_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  signed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists sign_request_rental_idx on sign_request (rental_id, created_at desc);
alter table sign_request enable row level security;
alter table sign_request force row level security;
drop policy if exists tenant_isolation_select on sign_request;
create policy tenant_isolation_select on sign_request for select using (tenant_id in (select app_current_tenant_ids()));

alter table signed_document add column if not exists rendered_agreement jsonb;
alter table signed_document add column if not exists content_hash text;
alter table signed_document add column if not exists signer_name text;
alter table signed_document add column if not exists initials jsonb;
alter table signed_document add column if not exists esign_consent boolean;
alter table signed_document add column if not exists signature_ip text;
alter table signed_document add column if not exists signature_user_agent text;
alter table signed_document add column if not exists sign_request_id uuid references sign_request(id);
create unique index if not exists signed_document_one_per_rental on signed_document (rental_id) where sign_request_id is not null;

-- A signature is evidence: never edited, never deleted.
drop trigger if exists signed_document_no_mutation on signed_document;
create trigger signed_document_no_mutation before update or delete on signed_document
  for each row execute function reject_mutation();

create or replace function create_sign_request(
  p_rental_id uuid, p_token_hash text, p_version_id uuid, p_rendered jsonb, p_content_hash text, p_hours integer default 72
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_rental record;
  v_ver record;
  v_id uuid;
begin
  select r.id, r.tenant_id, r.customer_id, r.status into v_rental from rental r where r.id = p_rental_id;
  if not found then raise exception 'rental_not_found'; end if;
  if auth.uid() is not null and v_rental.tenant_id not in (select app_current_tenant_ids()) then raise exception 'rental_not_found'; end if;
  if v_rental.status not in ('approved', 'scheduled') then raise exception 'rental_not_signable'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_token';
  end if;
  if p_rendered is null or jsonb_typeof(p_rendered->'clauses') <> 'array' then raise exception 'invalid_template'; end if;
  select d.id, d.tenant_id, d.status into v_ver from document_version d where d.id = p_version_id and d.document_type = 'rental_agreement';
  if not found or v_ver.tenant_id <> v_rental.tenant_id or v_ver.status <> 'approved' then raise exception 'version_not_approved'; end if;
  if exists (select 1 from signed_document s where s.rental_id = p_rental_id and s.sign_request_id is not null) then raise exception 'already_signed'; end if;

  update sign_request set revoked_at = now() where rental_id = p_rental_id and revoked_at is null and signed_at is null;
  insert into sign_request (tenant_id, rental_id, customer_id, document_version_id, token_hash, rendered, content_hash, expires_at, created_by)
  values (v_rental.tenant_id, p_rental_id, v_rental.customer_id, p_version_id, p_token_hash, p_rendered, p_content_hash,
          now() + make_interval(hours => least(greatest(coalesce(p_hours, 72), 1), 168)), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function get_sign_request(p_token_hash text)
returns table (request_id uuid, tenant_id uuid, rental_id uuid, customer_id uuid, first_name text, last_name text,
               document_version_id uuid, rendered jsonb, content_hash text, expires_at timestamptz, signed_at timestamptz, storage_key text)
language sql stable security definer set search_path = public as $$
  select s.id, s.tenant_id, s.rental_id, s.customer_id, c.first_name, c.last_name, s.document_version_id, s.rendered, s.content_hash,
         s.expires_at, s.signed_at,
         (select sd.storage_key from signed_document sd where sd.sign_request_id = s.id limit 1)
    from sign_request s join customer c on c.id = s.customer_id
   where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
     and coalesce((select ts.value from tenant_setting ts where ts.tenant_id = s.tenant_id and ts.key = 'agreement_signing_enabled'), 'on') <> 'off'
$$;

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
  v_words := regexp_split_to_array(lower(btrim(regexp_replace(coalesce(p_typed_name, ''), '[^A-Za-z\s''-]', ' ', 'g'))), '\s+');
  v_first := split_part(lower(btrim(coalesce(v_cust.first_name, ''))), ' ', 1);
  v_last := lower(btrim(coalesce(v_cust.last_name, '')));
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

revoke all on function save_agreement_draft(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function save_agreement_draft(uuid, text, jsonb, jsonb) to authenticated;
revoke all on function approve_agreement_version(uuid, boolean) from public, anon;
grant execute on function approve_agreement_version(uuid, boolean) to authenticated;
revoke all on function create_sign_request(uuid, text, uuid, jsonb, text, integer) from public, anon;
grant execute on function create_sign_request(uuid, text, uuid, jsonb, text, integer) to authenticated;
revoke all on function get_sign_request(text) from public, anon, authenticated;
revoke all on function complete_signing(text, text, jsonb, boolean, text, text, text) from public, anon, authenticated;
