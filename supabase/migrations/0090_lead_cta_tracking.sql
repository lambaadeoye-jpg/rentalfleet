-- 0090: remember which website button a lead used, and report on it in the funnel.
-- first_cta is a short code like 'hero_primary' or 'mobile_bar'. NULL means the visitor scrolled to the form without using a button.

alter table lead add column if not exists first_cta text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lead_first_cta_format') then
    alter table lead add constraint lead_first_cta_format check (first_cta is null or first_cta ~ '^[a-z0-9_]{1,30}$');
  end if;
end $$;

-- Same view as 0084 plus one new column at the end (cta).
create or replace view lead_funnel_flags with (security_invoker = true) as
select
  l.id as lead_id,
  l.created_at,
  coalesce(nullif(btrim(l.source), ''), 'unknown') as source,
  nullif(btrim(l.utm_campaign), '') as campaign,
  l.heard_about,
  (l.details_completed_at is not null) as step2_done,
  (l.contact_consent_at is not null) as consented,
  (l.customer_id is not null) as has_customer,
  exists (select 1 from application a where a.customer_id = l.customer_id and a.submitted_at is not null) as applied,
  exists (select 1 from application a where a.customer_id = l.customer_id and a.status in ('approved', 'conditionally_approved')) as approved,
  exists (select 1 from sign_request s where s.customer_id = l.customer_id and s.signed_at is not null) as signed,
  exists (select 1 from pay_request p where p.customer_id = l.customer_id and p.status = 'paid') as paid,
  exists (select 1 from rental r where r.customer_id = l.customer_id and r.start_at is not null) as picked_up,
  nullif(btrim(l.first_cta), '') as cta
from lead l;
revoke all on lead_funnel_flags from public, anon;
grant select on lead_funnel_flags to authenticated;

-- Same function as 0084 with a fourth grouping: 'button'.
create or replace function funnel_by_source(p_days integer default 30, p_group text default 'source')
returns table (label text, leads_count bigint, step2_count bigint, applied_count bigint, approved_count bigint,
               signed_count bigint, paid_count bigint, picked_up_count bigint)
language sql stable security invoker set search_path = public as $$
  select
    case when p_group = 'campaign' then coalesce(f.campaign, '(no campaign)') || ' · ' || f.source
         when p_group = 'heard_about' then coalesce(f.heard_about, '(not answered)')
         when p_group = 'button' then coalesce(f.cta, '(scrolled, no button)')
         else f.source end as label,
    count(*),
    count(*) filter (where f.step2_done),
    count(*) filter (where f.applied),
    count(*) filter (where f.approved),
    count(*) filter (where f.signed),
    count(*) filter (where f.paid),
    count(*) filter (where f.picked_up)
  from lead_funnel_flags f
  where f.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
  group by 1
  order by count(*) desc, 1;
$$;
revoke all on function funnel_by_source(integer, text) from public, anon;
grant execute on function funnel_by_source(integer, text) to authenticated;
