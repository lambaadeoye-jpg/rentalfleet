-- Fix enforce_status_transition() -- properly this time
--
-- Two issues, found in sequence while auditing this function:
--
-- 1. Same fragile-column-access bug already found and fixed in
--    guard_manage_fleet(): direct old.status/new.status dot notation
--    requires the column to structurally exist on whatever table the
--    trigger is attached to. This function is explicitly generic
--    (looks up allowed_status_transition by tg_table_name), so it's
--    designed to be reused -- fixed with to_jsonb(...)->>'status' for
--    safe access, same pattern as the earlier fix.
--
-- 2. A real regression I introduced myself while making fix #1: this
--    function originally had SECURITY DEFINER, added all the way back
--    in migration 0029 specifically because allowed_status_transition
--    has RLS enabled but not FORCED, and calling it as a non-owner role
--    (authenticated) without SECURITY DEFINER meant the internal lookup
--    could be silently blocked by RLS, causing valid transitions to be
--    incorrectly rejected. My rewrite for fix #1 only focused on the new
--    bug and dropped this previously-fixed attribute in the process.
--
-- Caught by the regression test itself: a genuinely valid transition
-- (pending -> approved) was incorrectly rejected after fix #1 alone.
-- Traced to prosecdef=false (confirmed directly against pg_proc, not
-- assumed) before writing this corrected version. Re-verified as
-- authenticated (the exact failure scenario) and via a full pickup ->
-- payment -> dropoff end-to-end flow exercising both this function and
-- guard_manage_fleet together, since both were touched this pass.

create or replace function enforce_status_transition() returns trigger as $$
declare
  v_old_status text;
  v_new_status text;
begin
  v_old_status := to_jsonb(old) ->> 'status';
  v_new_status := to_jsonb(new) ->> 'status';

  if v_new_status is distinct from v_old_status then
    if not exists (
      select 1 from allowed_status_transition
      where table_name = tg_table_name
        and from_status = v_old_status
        and to_status = v_new_status
    ) then
      raise exception 'Invalid % transition: % -> % is not an allowed state transition', tg_table_name, v_old_status, v_new_status;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
