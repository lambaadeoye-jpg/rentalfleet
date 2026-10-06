-- 0071: lead consent record, first-touch attribution, and lead <-> customer linking.
--
-- 1) Consent: optional, unchecked-by-default permission to text/call. Stores
--    exactly what the person agreed to (wording + version), when, and from
--    where. NULL contact_consent_at = no consent (email + human follow-up only).
-- 2) Attribution: where the lead came from (UTM, click ids, landing page).
-- 3) Linking: lead.customer_id was never written, so referral qualification
--    (detect_qualified_referrals joins lead.customer_id) could never fire.
--    Match on normalized phone / email, ONLY when exactly one customer matches.

alter table lead add column if not exists contact_consent_at timestamptz;
alter table lead add column if not exists contact_consent_text text;
alter table lead add column if not exists contact_consent_version text;
alter table lead add column if not exists consent_ip text;
alter table lead add column if not exists consent_user_agent text;
alter table lead add column if not exists utm_content text;
alter table lead add column if not exists utm_term text;
alter table lead add column if not exists click_id text;
alter table lead add column if not exists landing_path text;
alter table lead add column if not exists referrer text;

-- Last 10 digits of a US number; NULL if it isn't a plausible one.
create or replace function normalize_phone(p text) returns text
language sql immutable as $$
  select case
    when length(d) = 10 then d
    when length(d) = 11 and left(d, 1) = '1' then right(d, 10)
    else null
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s
$$;

create index if not exists lead_customer_link_idx on lead (tenant_id) where customer_id is null;

create or replace function link_lead_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
begin
  if new.customer_id is not null then
    return new;
  end if;
  select array_agg(distinct c.id) into v_ids
  from customer c
  where c.tenant_id = new.tenant_id
    and (
      (nullif(btrim(new.email::text), '') is not null and c.email = new.email)
      or (normalize_phone(new.phone) is not null and normalize_phone(c.phone) = normalize_phone(new.phone))
    );
  if v_ids is not null and array_length(v_ids, 1) = 1 then
    new.customer_id := v_ids[1];
  end if;
  return new;
end;
$$;

drop trigger if exists lead_link_customer on lead;
create trigger lead_link_customer before insert on lead
  for each row execute function link_lead_before_insert();

create or replace function link_leads_after_customer_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update lead l
     set customer_id = new.id
   where l.tenant_id = new.tenant_id
     and l.customer_id is null
     and (
       (nullif(btrim(new.email::text), '') is not null and l.email = new.email)
       or (normalize_phone(new.phone) is not null and normalize_phone(l.phone) = normalize_phone(new.phone))
     )
     and (
       select count(distinct c.id) from customer c
       where c.tenant_id = l.tenant_id
         and (
           (nullif(btrim(l.email::text), '') is not null and c.email = l.email)
           or (normalize_phone(l.phone) is not null and normalize_phone(c.phone) = normalize_phone(l.phone))
         )
     ) = 1;
  return null;
end;
$$;

drop trigger if exists customer_link_leads on customer;
create trigger customer_link_leads after insert or update of email, phone on customer
  for each row execute function link_leads_after_customer_change();

-- Backfill existing unlinked leads (unambiguous matches only).
update lead l
   set customer_id = m.cid
  from (
    select l2.id as lid, min(c.id::text)::uuid as cid, count(distinct c.id) as n
      from lead l2
      join customer c on c.tenant_id = l2.tenant_id
       and (
         (nullif(btrim(l2.email::text), '') is not null and c.email = l2.email)
         or (normalize_phone(l2.phone) is not null and normalize_phone(c.phone) = normalize_phone(l2.phone))
       )
     where l2.customer_id is null
     group by l2.id
  ) m
 where l.id = m.lid and m.n = 1;
