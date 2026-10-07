-- 0089: weekly voice-call review (analysis of Vapi calls to suggest prompt and FAQ improvements).
-- Stores a REDACTED transcript (phone numbers, emails, links masked before saving), the automatic rule checks,
-- the AI tags, and each weekly report. Written only by the service role (the app's automation route); no policies
-- for signed-in users, so staff screens can be added later with an explicit policy. Safe to run twice.

create table if not exists call_review (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  vapi_call_id text not null,
  assistant_key text not null check (assistant_key in ('front_desk', 'new_lead', 'nudge', 'pickup')),
  started_at timestamptz,
  ended_at timestamptz,
  duration_s integer,
  ended_reason text,
  transcript text not null default '',
  lead_id uuid references lead(id) on delete set null,
  customer_id uuid references customer(id) on delete set null,
  metrics jsonb not null default '{}'::jsonb,
  checks jsonb not null default '[]'::jsonb,
  tags jsonb,
  tagged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, vapi_call_id)
);
create index if not exists call_review_started_idx on call_review (tenant_id, started_at desc);
create index if not exists call_review_untagged_idx on call_review (tenant_id, created_at) where tags is null;

create table if not exists call_review_report (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id),
  period_start timestamptz not null,
  period_end timestamptz not null,
  metrics jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, period_start)
);

alter table call_review enable row level security;
alter table call_review force row level security;
alter table call_review_report enable row level security;
alter table call_review_report force row level security;
-- Intentionally no policies: only the service role reads or writes these tables.
revoke all on call_review from anon, authenticated;
revoke all on call_review_report from anon, authenticated;
