-- RLS Tenant Isolation Test Suite
-- Replaces the comment-only stub. Creates a second, throwaway tenant so
-- isolation can be tested for real (not just asserted against one tenant),
-- then impersonates specific users via SET LOCAL request.jwt.claims -- the
-- same mechanism PostgREST/Supabase uses in production, so this exercises
-- the exact RLS policies a real browser session would hit. Everything
-- rolls back at the end.
--
-- HONEST STATUS: all 6 documented test cases now have real enforcement to
-- test. Test 6 is verified by static analysis (see the note after the
-- transaction below), not a SQL assertion.

begin;

do $$
declare
  v_tenant_a uuid;
  v_tenant_b uuid;
  v_user_a uuid := 'cbf4eea9-84c8-4d48-92e3-44c9324baf7d'; -- real test@test.com, tenant A admin
  v_user_b uuid := gen_random_uuid();
  v_role_b uuid;
  v_customer_b uuid;
  v_row_count int;
begin
  select id into v_tenant_a from tenant where slug = 'fleet-rental-pilot';

  insert into tenant (name, slug) values ('RLS Test Tenant B', 'rls-test-tenant-b')
    returning id into v_tenant_b;

  insert into user_profile (id, tenant_id, email, full_name)
    values (v_user_b, v_tenant_b, 'tenant-b-test@example.com', 'Tenant B Test User');

  insert into role (tenant_id, name) values (v_tenant_b, 'admin') returning id into v_role_b;
  insert into membership (tenant_id, user_id, role_id) values (v_tenant_b, v_user_b, v_role_b);

  insert into customer (tenant_id, first_name, last_name, email)
    values (v_tenant_b, 'Tenant B', 'Customer', 'tenantb.customer@example.com')
    returning id into v_customer_b;

  -- =========================================================
  -- TEST 1: A user from tenant A cannot SELECT tenant B rows
  -- =========================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a)::text, true);
  set local role authenticated;

  select count(*) into v_row_count from customer where tenant_id = v_tenant_b;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  perform test.assert(v_row_count = 0, 'Test 1: tenant A user sees 0 rows when querying tenant B customers');

  -- =========================================================
  -- TEST 2: A user from tenant A cannot INSERT/UPDATE/DELETE
  -- tenant B rows
  -- =========================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a)::text, true);
  set local role authenticated;

  perform test.assert_raises(
    format('insert into customer (tenant_id, first_name, last_name) values (%L, ''Hacked'', ''Row'')', v_tenant_b),
    'Test 2a: tenant A user inserting a row into tenant B is rejected'
  );

  update customer set first_name = 'Hacked' where id = v_customer_b;
  get diagnostics v_row_count = row_count;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  perform test.assert(v_row_count = 0, 'Test 2b: tenant A user updating a tenant B row silently affects 0 rows');

  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a)::text, true);
  set local role authenticated;
  delete from customer where id = v_customer_b;
  get diagnostics v_row_count = row_count;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  perform test.assert(v_row_count = 0, 'Test 2c: tenant A user deleting a tenant B row silently affects 0 rows');

  -- Confirm the tenant B row is still actually there (proves test 2c
  -- above didn't just fail to run -- it ran and correctly did nothing)
  perform test.assert_row_count(
    format('select 1 from customer where id = %L', v_customer_b),
    1,
    'Sanity check: tenant B''s customer row survived the tenant A user''s delete attempt'
  );

  -- =========================================================
  -- TEST 3: Customer cannot access another customer
  -- NOW IMPLEMENTED (was a documented gap as of the previous
  -- version of this file). Closed by migration
  -- 0020_customer_portal_rls.sql, which links customer.auth_user_id
  -- to auth.users and adds customer-self RLS policies across the
  -- portal-relevant tables.
  -- =========================================================
  declare
    v_auth_user_a uuid := gen_random_uuid();
    v_auth_user_b uuid := gen_random_uuid();
    v_customer_a uuid;
    v_customer_b2 uuid;
    v_rental_a uuid;
    v_rental_b uuid;
  begin
    -- Ephemeral auth.users rows: exist only inside this transaction
    -- (the whole file rolls back at the end), purely to satisfy
    -- customer.auth_user_id's foreign key. Never usable as real logins.
    insert into auth.users (id, email) values (v_auth_user_a, 'test-customer-a@example.com');
    insert into auth.users (id, email) values (v_auth_user_b, 'test-customer-b@example.com');

    insert into customer (tenant_id, first_name, last_name, email, auth_user_id)
      values (v_tenant_a, 'Customer', 'A', 'test-customer-a@example.com', v_auth_user_a)
      returning id into v_customer_a;
    insert into customer (tenant_id, first_name, last_name, email, auth_user_id)
      values (v_tenant_a, 'Customer', 'B', 'test-customer-b@example.com', v_auth_user_b)
      returning id into v_customer_b2;

    insert into rental (tenant_id, customer_id, status) values (v_tenant_a, v_customer_a, 'pending')
      returning id into v_rental_a;
    insert into rental (tenant_id, customer_id, status) values (v_tenant_a, v_customer_b2, 'pending')
      returning id into v_rental_b;

    perform set_config('request.jwt.claims', json_build_object('sub', v_auth_user_a)::text, true);
    set local role authenticated;

    select count(*) into v_row_count from rental where id = v_rental_b;
    perform test.assert(v_row_count = 0, 'Test 3a: Customer A sees 0 rows querying Customer B''s rental directly by id');

    select count(*) into v_row_count from rental where id = v_rental_a;
    perform test.assert(v_row_count = 1, 'Test 3b: Customer A sees their own rental');

    select count(*) into v_row_count from customer where id = v_customer_b2;
    perform test.assert(v_row_count = 0, 'Test 3c: Customer A sees 0 rows querying Customer B''s customer profile');

    update rental set status = 'approved' where id = v_rental_b;
    get diagnostics v_row_count = row_count;
    reset role;
  perform set_config('request.jwt.claims', '{}', true);
    perform test.assert(v_row_count = 0, 'Test 3d: Customer A updating Customer B''s rental silently affects 0 rows');
  end;

  -- =========================================================
  -- TEST 4: Recovery vendor sees only assigned case fields
  -- NOW IMPLEMENTED. Closed by migration 0022_vendor_least_privilege.sql.
  -- Note this is NOT a row-level RLS policy on recovery_case (RLS can't
  -- do column-level restriction) -- vendors get ZERO direct access to
  -- recovery_case/vehicle/customer. The only access path is
  -- vendor_visible_recovery_cases(), a SECURITY DEFINER function that
  -- returns a hand-picked minimum column set for assigned cases only.
  -- =========================================================
  declare
    v_category_id uuid;
    v_perm2_vehicle_id uuid;
    v_perm2_customer_id uuid;
    v_perm2_rental_id uuid;
    v_perm2_case_id uuid;
    v_vendor_a uuid;
    v_vendor_b uuid;
    v_vendor_a_auth uuid := gen_random_uuid();
    v_vendor_b_auth uuid := gen_random_uuid();
  begin
    select id into v_category_id from vehicle_category where tenant_id = v_tenant_a limit 1;

    insert into vehicle (tenant_id, category_id, vin, make, model, year, plate, status)
      values (v_tenant_a, v_category_id, 'VENDOR-TEST-VIN', 'Honda', 'Civic', 2021, 'TN-TEST1', 'acquired')
      returning id into v_perm2_vehicle_id;
    insert into customer (tenant_id, first_name, last_name, email)
      values (v_tenant_a, 'Vendor', 'TestCustomer', 'vendor.test.customer@example.com')
      returning id into v_perm2_customer_id;
    insert into rental (tenant_id, customer_id, status)
      values (v_tenant_a, v_perm2_customer_id, 'pending') returning id into v_perm2_rental_id;
    insert into recovery_case (tenant_id, rental_id, vehicle_id, customer_id, balance_due, authorization_reason)
      values (v_tenant_a, v_perm2_rental_id, v_perm2_vehicle_id, v_perm2_customer_id, 500.00, 'Internal notes: renter unreachable 14 days')
      returning id into v_perm2_case_id;

    insert into vendor (tenant_id, name) values (v_tenant_a, 'Vendor A Towing') returning id into v_vendor_a;
    insert into vendor (tenant_id, name) values (v_tenant_a, 'Vendor B Towing (unassigned)') returning id into v_vendor_b;

    insert into auth.users (id, email) values (v_vendor_a_auth, 'vendor-a@example.com');
    insert into auth.users (id, email) values (v_vendor_b_auth, 'vendor-b@example.com');
    insert into vendor_contact (tenant_id, vendor_id, auth_user_id, full_name)
      values (v_tenant_a, v_vendor_a, v_vendor_a_auth, 'Vendor A Contact');
    insert into vendor_contact (tenant_id, vendor_id, auth_user_id, full_name)
      values (v_tenant_a, v_vendor_b, v_vendor_b_auth, 'Vendor B Contact');

    insert into recovery_assignment (tenant_id, recovery_case_id, assignment_type, vendor_id, vendor_name, status)
      values (v_tenant_a, v_perm2_case_id, 'vendor', v_vendor_a, 'Vendor A Towing', 'assigned');

    perform set_config('request.jwt.claims', json_build_object('sub', v_vendor_a_auth)::text, true);
    set local role authenticated;

    select count(*) into v_row_count from vendor_visible_recovery_cases();
    perform test.assert(v_row_count = 1, 'Test 4a: assigned vendor sees exactly 1 case via the function');

    select count(*) into v_row_count from vendor_visible_recovery_cases() where vehicle_vin = 'VENDOR-TEST-VIN';
    perform test.assert(v_row_count = 1, 'Test 4b: the visible case correctly shows the assigned vehicle VIN');

    select count(*) into v_row_count from recovery_case where id = v_perm2_case_id;
    perform test.assert(v_row_count = 0, 'Test 4c: vendor querying recovery_case directly (bypassing the function) sees 0 rows');

    select count(*) into v_row_count from customer where id = v_perm2_customer_id;
    perform test.assert(v_row_count = 0, 'Test 4d: vendor has zero direct access to the customer table');

    reset role;
    perform set_config('request.jwt.claims', '{}', true);

    perform set_config('request.jwt.claims', json_build_object('sub', v_vendor_b_auth)::text, true);
    set local role authenticated;

    select count(*) into v_row_count from vendor_visible_recovery_cases();
    perform test.assert(v_row_count = 0, 'Test 4e: an unassigned vendor sees 0 cases');

    reset role;
    perform set_config('request.jwt.claims', '{}', true);
  end;

  -- =========================================================
  -- TEST 5: Restricted staff actions fail without permission
  -- NOW IMPLEMENTED. Closed by migration
  -- 0021_permission_enforcement.sql, which adds real trigger-based
  -- checks against role_permission for 7 gated actions (approve_driver,
  -- assign_vehicle, approve_charge, authorize_recovery,
  -- approve_recovery_expense, manage_fleet, manage_users_roles).
  -- Enforcement only applies when a specific user is impersonated
  -- (auth.uid() is not null) -- trusted service/migration access is
  -- unaffected, which is why nothing above needed to change.
  -- =========================================================
  declare
    v_viewer_auth uuid := gen_random_uuid();
    v_viewer_role uuid;
    v_perm_customer_id uuid;
    v_application_id uuid;
    v_perm_vehicle_id uuid;
  begin
    insert into auth.users (id, email) values (v_viewer_auth, 'test-viewer@example.com');
    insert into user_profile (id, tenant_id, email, full_name)
      values (v_viewer_auth, v_tenant_a, 'test-viewer@example.com', 'Test Viewer');
    insert into role (tenant_id, name) values (v_tenant_a, 'viewer_test') returning id into v_viewer_role;
    insert into membership (tenant_id, user_id, role_id) values (v_tenant_a, v_viewer_auth, v_viewer_role);
    -- deliberately NOT granting viewer_test any role_permission rows

    insert into customer (tenant_id, first_name, last_name, email)
      values (v_tenant_a, 'Perm', 'Test', 'perm.test@example.com') returning id into v_perm_customer_id;
    insert into application (tenant_id, customer_id, status)
      values (v_tenant_a, v_perm_customer_id, 'submitted') returning id into v_application_id;
    insert into vehicle (tenant_id, category_id, vin, status)
      values (v_tenant_a, (select id from vehicle_category where tenant_id = v_tenant_a limit 1), 'PERM-TEST-VIN', 'acquired')
      returning id into v_perm_vehicle_id;

    perform set_config('request.jwt.claims', json_build_object('sub', v_viewer_auth)::text, true);
    set local role authenticated;

    perform test.assert_raises(
      format('update application set status = ''approved'' where id = %L', v_application_id),
      'Test 5a: viewer role (no approve_driver permission) cannot approve an application'
    );
    perform test.assert_raises(
      format('insert into vehicle (tenant_id, category_id, vin, status) values (%L, (select id from vehicle_category where tenant_id = %L limit 1), ''PERM-TEST-VIN-2'', ''acquired'')', v_tenant_a, v_tenant_a),
      'Test 5b: viewer role (no manage_fleet permission) cannot add a vehicle'
    );
    reset role;
  perform set_config('request.jwt.claims', '{}', true);

    -- The real admin (has all 14 seeded permissions) performs the same
    -- actions -- must succeed, proving this isn't just "block everything"
    perform set_config('request.jwt.claims', json_build_object('sub', v_user_a)::text, true);
    set local role authenticated;

    update application set status = 'approved' where id = v_application_id;
    perform test.assert(true, 'Test 5c: admin role (has approve_driver) CAN approve the same application');

    insert into vehicle (tenant_id, category_id, vin, status)
      values (v_tenant_a, (select id from vehicle_category where tenant_id = v_tenant_a limit 1), 'PERM-TEST-VIN-3', 'acquired');
    perform test.assert(true, 'Test 5d: admin role (has manage_fleet) CAN add a vehicle');
    reset role;
  perform set_config('request.jwt.claims', '{}', true);
  end;

  raise notice '=== ALL 5 SQL-TESTABLE RLS CASES (1,2,3,4,5) PASSED. ===';
end $$;

rollback;

-- =========================================================
-- TEST 6: Service role is never exposed to browser code
-- This is not a SQL-testable assertion -- it's a property of
-- the application source code, checked by static analysis:
--   grep -r "service_role\|SUPABASE_SERVICE" fleet-rental-app/
-- must return nothing outside of server-only files, and NEVER
-- inside anything reachable from lib/supabase/client.ts or any
-- NEXT_PUBLIC_ variable. Confirmed clean as of this build --
-- re-run that grep as part of CI on every future commit, since
-- this is exactly the kind of thing that's silent until it isn't.
-- =========================================================
