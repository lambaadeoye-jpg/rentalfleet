-- Test Helper Functions
-- Reusable assertion helpers for the CI test suite (tests/domain_integrity_test.sql,
-- tests/rls_tenant_isolation_test.sql). Kept in a separate `test` schema so
-- they never get swept into the generic tenant-isolation RLS loop (0014),
-- which only scans the `public` schema.

create schema if not exists test;

create or replace function test.assert(cond boolean, msg text) returns void as $$
begin
  if not cond then
    raise exception 'ASSERTION FAILED: %', msg;
  else
    raise notice 'PASS: %', msg;
  end if;
end;
$$ language plpgsql;

create or replace function test.assert_raises(query text, msg text) returns void as $$
begin
  begin
    execute query;
    raise exception 'ASSERTION FAILED (expected rejection, none occurred): %', msg;
  exception
    when others then
      if sqlerrm like 'ASSERTION FAILED%' then
        raise;
      end if;
      raise notice 'PASS (correctly rejected): % [%]', msg, sqlerrm;
  end;
end;
$$ language plpgsql;

create or replace function test.assert_row_count(query text, expected int, msg text) returns void as $$
declare
  actual int;
begin
  execute 'select count(*) from (' || query || ') t' into actual;
  if actual is distinct from expected then
    raise exception 'ASSERTION FAILED: % (expected % rows, got %)', msg, expected, actual;
  else
    raise notice 'PASS: % (% rows)', msg, actual;
  end if;
end;
$$ language plpgsql;

-- Grant access to the `authenticated`/`anon` roles so these helpers still
-- work when a test impersonates a real user via SET LOCAL ROLE (which the
-- RLS isolation tests do). Without this, calling test.assert_raises() while
-- impersonating a user fails with "permission denied for schema test"
-- before it even gets to test the thing you actually care about.
grant usage on schema test to authenticated, anon;
grant execute on all functions in schema test to authenticated, anon;
alter default privileges in schema test grant execute on functions to authenticated, anon;
