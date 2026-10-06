-- 0079: Funnel analytics. Read-only. Counts leads created in the window that reached each step.
-- security invoker: row-level security limits the counts to the caller's own tenant.

create or replace function funnel_summary(p_days integer default 30)
returns table (stage_order integer, stage text, leads_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with cohort as (
    select l.id, l.customer_id
      from lead l
     where l.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
  ),
  flags as (
    select c.id,
      c.customer_id is not null as has_customer,
      exists (select 1 from application a where a.customer_id = c.customer_id and a.submitted_at is not null) as applied,
      exists (select 1 from application a where a.customer_id = c.customer_id and a.status in ('approved', 'conditionally_approved')) as approved,
      exists (select 1 from sign_request s where s.customer_id = c.customer_id and s.signed_at is not null) as signed,
      exists (select 1 from pay_request p where p.customer_id = c.customer_id and p.status = 'paid') as paid,
      exists (select 1 from slot_hold h where h.customer_id = c.customer_id and h.status = 'confirmed') as slot_booked,
      exists (select 1 from rental r where r.customer_id = c.customer_id and r.start_at is not null) as picked_up
    from cohort c
  )
  select 1, 'Lead captured', count(*) from flags
  union all select 2, 'Application submitted', count(*) filter (where applied) from flags
  union all select 3, 'Approved', count(*) filter (where approved) from flags
  union all select 4, 'Agreement signed', count(*) filter (where signed) from flags
  union all select 5, 'Payment received', count(*) filter (where paid) from flags
  union all select 6, 'Pickup time booked', count(*) filter (where slot_booked) from flags
  union all select 7, 'Picked up', count(*) filter (where picked_up) from flags
  order by 1;
$$;

revoke all on function funnel_summary(integer) from public, anon;
grant execute on function funnel_summary(integer) to authenticated;
