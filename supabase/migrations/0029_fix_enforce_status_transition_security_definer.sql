-- Fix enforce_status_transition() -- Missing security definer
-- Found while building the real booking/rental flow: this function's
-- internal lookup against allowed_status_transition was itself subject to
-- that table's own RLS policy (auth.role() = 'authenticated', which reads
-- the JWT's role CLAIM, not the actual Postgres role). Every other
-- trusted-lookup helper in this codebase (app_current_tenant_ids,
-- app_current_customer_id, app_current_vendor_ids, app_has_permission) is
-- security definer specifically so its internal queries aren't accidentally
-- gated by the caller's own RLS -- this one was a plain oversight when
-- written in migration 0018, inconsistent with the established pattern.
--
-- Real-world impact: a state transition that should be valid (e.g. rental
-- pending -> approved) could be incorrectly rejected depending on exact JWT
-- claim shape, since the trigger's own lookup could return zero rows even
-- when the allowed_status_transition row genuinely exists.

create or replace function enforce_status_transition() returns trigger as $$
begin
  if new.status is distinct from old.status then
    if not exists (
      select 1 from allowed_status_transition
      where table_name = tg_table_name
        and from_status = old.status
        and to_status = new.status
    ) then
      raise exception 'Invalid % transition: % -> % is not an allowed state transition', tg_table_name, old.status, new.status;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
