-- Phone numbers are stored in inconsistent formats ("6211228569",
-- "+1622322566", ...), so exact-match lookups from an inbound call or text
-- silently miss people. This matches on the last 10 digits instead.
--
-- Service-role only: callers are the Front Desk voice API and the SMS
-- inbound route, never a browser. Returns identity-level data only.
create or replace function match_caller_by_phone(p_tenant_id uuid, p_phone text)
returns table(kind text, id uuid, first_name text, customer_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with digits as (
    select right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10) as d
  )
  select m.kind, m.id, m.first_name, m.customer_id from (
    select 'customer'::text as kind, c.id, c.first_name, c.id as customer_id, 1 as rank, c.created_at
      from customer c, digits
     where c.tenant_id = p_tenant_id
       and length(digits.d) = 10
       and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = digits.d
    union all
    select 'lead'::text, l.id, l.first_name, l.customer_id, 2, l.created_at
      from lead l, digits
     where l.tenant_id = p_tenant_id
       and length(digits.d) = 10
       and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = digits.d
  ) m
  order by m.rank, m.created_at desc
  limit 2;
$$;

revoke all on function match_caller_by_phone(uuid, text) from public, anon, authenticated;
grant execute on function match_caller_by_phone(uuid, text) to service_role;
