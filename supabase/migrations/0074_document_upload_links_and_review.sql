-- 0074: tokenized mobile document-upload links + document review status (Phase 3B).
--
-- Staff create a private, expiring link for a renter; the renter opens it on
-- their phone with no login and uploads the requested documents. Only a hash
-- of the link token is stored. Each uploaded document carries a review status
-- staff set (pending / accepted / rejected + a note the renter can read).
--
-- tenant_setting 'upload_links_enabled' = 'off' is a kill switch (links stop
-- working); anything else (including unset) means on, because links are only
-- ever created by a staff member's deliberate action.

alter table customer_document add column if not exists review_status text not null default 'pending';
alter table customer_document add column if not exists review_note text;
alter table customer_document add column if not exists reviewed_at timestamptz;
alter table customer_document add column if not exists reviewed_by uuid;
alter table customer_document add column if not exists source text not null default 'applicant';
alter table customer_document add column if not exists upload_request_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'customer_document_review_status_check') then
    alter table customer_document add constraint customer_document_review_status_check
      check (review_status in ('pending', 'accepted', 'rejected'));
  end if;
end $$;

-- Documents of people already approved / renting were effectively reviewed.
update customer_document d set review_status = 'accepted'
 where d.review_status = 'pending'
   and exists (select 1 from application a where a.customer_id = d.customer_id and a.status in ('approved', 'conditionally_approved'));

create table if not exists upload_request (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  customer_id uuid not null references customer(id),
  application_id uuid references application(id),
  token_hash text not null unique,
  document_types text[] not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  uploads_used integer not null default 0,
  last_used_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists upload_request_customer_idx on upload_request (customer_id, created_at desc);

alter table upload_request enable row level security;
alter table upload_request force row level security;
drop policy if exists tenant_isolation_select on upload_request;
create policy tenant_isolation_select on upload_request for select
  using (tenant_id in (select app_current_tenant_ids()));
-- No write policies: definer functions below only.

-- Staff (any member of the customer's tenant) or the service role creates a
-- link. Older unrevoked links for the same customer are revoked so only the
-- newest works.
create or replace function create_upload_request(
  p_customer_id uuid, p_token_hash text, p_types text[], p_hours integer default 72, p_application_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  select c.tenant_id into v_tenant from customer c where c.id = p_customer_id;
  if not found then raise exception 'customer_not_found'; end if;
  if auth.uid() is not null and v_tenant not in (select app_current_tenant_ids()) then
    raise exception 'customer_not_found';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_token'; end if;
  if p_types is null or coalesce(array_length(p_types, 1), 0) = 0
     or not (p_types <@ array['drivers_license', 'proof_of_residence', 'insurance_card']) then
    raise exception 'invalid_types';
  end if;
  if p_application_id is not null
     and not exists (select 1 from application a where a.id = p_application_id and a.customer_id = p_customer_id) then
    raise exception 'invalid_application';
  end if;

  update upload_request set revoked_at = now() where customer_id = p_customer_id and revoked_at is null;
  insert into upload_request (tenant_id, customer_id, application_id, token_hash, document_types, expires_at, created_by)
  values (v_tenant, p_customer_id, p_application_id, p_token_hash, (select array_agg(distinct t) from unnest(p_types) t),
          now() + make_interval(hours => least(greatest(coalesce(p_hours, 72), 1), 168)), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Service role: look up a link. Returns nothing if unknown, expired, revoked or switched off.
create or replace function get_upload_request(p_token_hash text)
returns table (request_id uuid, tenant_id uuid, customer_id uuid, first_name text, document_types text[], expires_at timestamptz, uploads_used integer)
language sql stable security definer set search_path = public as $$
  select u.id, u.tenant_id, u.customer_id, c.first_name, u.document_types, u.expires_at, u.uploads_used
    from upload_request u join customer c on c.id = u.customer_id
   where u.token_hash = p_token_hash
     and u.revoked_at is null and u.expires_at > now()
     and coalesce((select ts.value from tenant_setting ts where ts.tenant_id = u.tenant_id and ts.key = 'upload_links_enabled'), 'on') <> 'off'
$$;

-- Service role: record a file that was just stored. Enforces link validity,
-- the document type the link asked for, and a per-link cap on uploads.
create or replace function record_upload_via_token(p_token_hash text, p_type text, p_storage_key text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
  v_doc uuid;
begin
  select * into v_req from upload_request u where u.token_hash = p_token_hash for update;
  if not found or v_req.revoked_at is not null or v_req.expires_at <= now()
     or coalesce((select ts.value from tenant_setting ts where ts.tenant_id = v_req.tenant_id and ts.key = 'upload_links_enabled'), 'on') = 'off' then
    raise exception 'link_invalid';
  end if;
  if not (p_type = any (v_req.document_types)) then raise exception 'type_not_allowed'; end if;
  if v_req.uploads_used >= 30 then raise exception 'upload_limit'; end if;
  if p_storage_key is null or p_storage_key not like v_req.tenant_id::text || '/' || v_req.customer_id::text || '/%' then
    raise exception 'invalid_storage_key';
  end if;

  insert into customer_document (tenant_id, customer_id, document_type, storage_key, status, source, upload_request_id)
  values (v_req.tenant_id, v_req.customer_id, p_type, p_storage_key, 'active', 'upload_link', v_req.id)
  returning id into v_doc;
  update upload_request set uploads_used = uploads_used + 1, last_used_at = now() where id = v_req.id;
  return v_doc;
end;
$$;

-- Staff review of one document. Needs approve_driver and the document's tenant.
create or replace function review_customer_document(p_doc_id uuid, p_status text, p_note text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
begin
  perform reject_without_permission('approve_driver');
  if p_status not in ('accepted', 'rejected') then raise exception 'invalid_status'; end if;
  if p_status = 'rejected' and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'note_required'; end if;
  select d.tenant_id into v_tenant from customer_document d where d.id = p_doc_id;
  if not found or v_tenant not in (select app_current_tenant_ids()) then raise exception 'document_not_found'; end if;
  update customer_document
     set review_status = p_status, review_note = left(nullif(btrim(coalesce(p_note, '')), ''), 500),
         reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_doc_id;
  return true;
end;
$$;

revoke all on function create_upload_request(uuid, text, text[], integer, uuid) from public, anon;
grant execute on function create_upload_request(uuid, text, text[], integer, uuid) to authenticated;
revoke all on function get_upload_request(text) from public, anon, authenticated;
revoke all on function record_upload_via_token(text, text, text) from public, anon, authenticated;
revoke all on function review_customer_document(uuid, text, text) from public, anon;
grant execute on function review_customer_document(uuid, text, text) to authenticated;
