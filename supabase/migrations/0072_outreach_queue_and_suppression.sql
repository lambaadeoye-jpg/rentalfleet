-- 0072: automated lead outreach queue + opt-out (suppression) list.
-- Rules live in lib/outreach-rules.ts; this is storage + safe claiming only.

create table if not exists contact_suppression (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  phone_norm text,            -- last 10 digits (normalize_phone)
  email citext,
  reason text not null default 'stop_keyword',
  source text not null default 'sms_inbound',
  created_at timestamptz not null default now(),
  constraint contact_suppression_has_target check (phone_norm is not null or email is not null)
);
create unique index if not exists contact_suppression_phone_uq on contact_suppression (tenant_id, phone_norm) where phone_norm is not null;
create unique index if not exists contact_suppression_email_uq on contact_suppression (tenant_id, email) where email is not null;

create table if not exists outreach_message (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  lead_id uuid not null references lead(id) on delete cascade,
  step_key text not null,
  channel text not null check (channel in ('sms','call','email')),
  status text not null default 'queued' check (status in ('queued','sending','sent','skipped','failed','cancelled')),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  attempts integer not null default 0,
  skip_reason text,
  provider_message_id text,
  error text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lead_id, step_key)
);
create index if not exists outreach_message_due_idx on outreach_message (scheduled_for) where status = 'queued';

alter table contact_suppression enable row level security;
alter table contact_suppression force row level security;
alter table outreach_message enable row level security;
alter table outreach_message force row level security;

drop policy if exists tenant_isolation_select on contact_suppression;
create policy tenant_isolation_select on contact_suppression for select
  using (tenant_id in (select app_current_tenant_ids()));
drop policy if exists tenant_isolation_select on outreach_message;
create policy tenant_isolation_select on outreach_message for select
  using (tenant_id in (select app_current_tenant_ids()));
-- No insert/update policies: only the service role and the definer
-- functions below write these tables.

-- Plan: keep in sync with OUTREACH_PLAN in lib/outreach-rules.ts.
-- (step_key, channel, delay_minutes, needs_consent)
create or replace function enqueue_lead_outreach() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s record;
begin
  for s in
    select * from (values
      ('email_welcome', 'email', 0, false),
      ('sms_welcome',   'sms',   0, true),
      ('ai_call',       'call',  3, true),
      ('sms_nudge',     'sms',   1440, true),
      ('email_nudge',   'email', 2880, false),
      ('sms_checkin',   'sms',   5760, true),
      ('email_help',    'email', 10080, false),
      ('sms_last',      'sms',   20160, true)
    ) as t(step_key, channel, delay_minutes, needs_consent)
  loop
    insert into outreach_message (tenant_id, lead_id, step_key, channel, scheduled_for, status, skip_reason)
    values (
      new.tenant_id, new.id, s.step_key, s.channel,
      new.created_at + make_interval(mins => s.delay_minutes),
      case when s.needs_consent and new.contact_consent_at is null then 'skipped' else 'queued' end,
      case when s.needs_consent and new.contact_consent_at is null then 'no_consent' else null end
    )
    on conflict (lead_id, step_key) do nothing;
  end loop;
  return new;
end;
$$;

drop trigger if exists lead_enqueue_outreach on lead;
create trigger lead_enqueue_outreach after insert on lead
  for each row execute function enqueue_lead_outreach();

-- Claim due rows safely (no double sends if the dispatcher overlaps itself).
-- Rows stuck in 'sending' for over 10 minutes go back to the queue first.
drop function if exists claim_due_outreach(integer);
create or replace function claim_due_outreach(p_limit integer default 25)
returns table (
  id uuid, tenant_id uuid, lead_id uuid, step_key text, channel text, attempts integer, scheduled_for timestamptz,
  first_name text, last_name text, phone text, email text,
  has_consent boolean, red_flagged boolean, stage text, customer_id uuid,
  touches_sent bigint, has_inbound_reply boolean, suppressed boolean
)
language plpgsql security definer set search_path = public as $$
begin
  update outreach_message set status = 'queued', claimed_at = null
   where status = 'sending' and claimed_at < now() - interval '10 minutes';

  return query
  with picked as (
    select m.id from outreach_message m
     where m.status = 'queued' and m.scheduled_for <= now()
     order by m.scheduled_for
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  ), upd as (
    update outreach_message m
       set status = 'sending', claimed_at = now(), attempts = m.attempts + 1
      from picked where m.id = picked.id
    returning m.*
  )
  select u.id, u.tenant_id, u.lead_id, u.step_key, u.channel, u.attempts, u.scheduled_for,
         l.first_name, l.last_name, l.phone, l.email::text,
         (l.contact_consent_at is not null),
         coalesce(l.red_flag_matched, false), l.stage, l.customer_id,
         (select count(*) from outreach_message x where x.lead_id = u.lead_id and x.status = 'sent'),
         exists (select 1 from communication_event ce
                  where ce.lead_id = u.lead_id and ce.direction = 'inbound'),
         exists (select 1 from contact_suppression s
                  where s.tenant_id = u.tenant_id
                    and ((s.phone_norm is not null and s.phone_norm = normalize_phone(l.phone))
                      or (s.email is not null and s.email = l.email)))
    from upd u join lead l on l.id = u.lead_id;
end;
$$;

revoke all on function claim_due_outreach(integer) from public, anon, authenticated;
revoke all on function enqueue_lead_outreach() from public, anon, authenticated;

-- Opt-out: record it and cancel everything still queued for that number.
create or replace function record_opt_out(p_tenant_id uuid, p_phone text, p_source text default 'sms_inbound')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_norm text := normalize_phone(p_phone);
begin
  if v_norm is null then return; end if;
  insert into contact_suppression (tenant_id, phone_norm, source) values (p_tenant_id, v_norm, p_source)
    on conflict do nothing;
  update outreach_message m set status = 'cancelled', skip_reason = 'opted_out'
    from lead l
   where m.lead_id = l.id and m.tenant_id = p_tenant_id
     and m.status in ('queued','sending')
     and normalize_phone(l.phone) = v_norm;
end;
$$;
revoke all on function record_opt_out(uuid, text, text) from public, anon, authenticated;

create or replace function clear_opt_out(p_tenant_id uuid, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from contact_suppression
   where tenant_id = p_tenant_id and phone_norm = normalize_phone(p_phone);
end;
$$;
revoke all on function clear_opt_out(uuid, text) from public, anon, authenticated;
