-- Domain Integrity Test Suite
-- Replaces the comment-only stub. Runs entirely inside one transaction that
-- ROLLS BACK at the end, so it never leaves test data behind -- safe to run
-- against the real project repeatedly (e.g. from CI before every deploy).
-- Requires: 0018_integrity_and_immutability.sql and 0019_test_helpers.sql
-- to have been applied first (they're what these tests actually check).

begin;

-- Fixtures: a throwaway vehicle/customer/rental under the real pilot tenant.
-- Rolled back at the end -- does not pollute real tenant data.
do $$
declare
  v_tenant_id uuid;
  v_category_id uuid;
  v_vehicle_id uuid;
  v_customer_id uuid;
  v_rental_id uuid;
  v_segment1_id uuid;
  v_policy_id uuid;
  v_policy_mutable_id uuid;
  v_document_id uuid;
  v_recovery_case_id uuid;
  v_recovery_expense_id uuid;
begin
  select id into v_tenant_id from tenant where slug = 'fleet-rental-pilot';
  select id into v_category_id from vehicle_category where tenant_id = v_tenant_id limit 1;

  insert into vehicle (tenant_id, category_id, vin, make, model, year, status)
    values (v_tenant_id, v_category_id, 'TEST-VIN-0001', 'Toyota', 'Corolla', 2020, 'acquired')
    returning id into v_vehicle_id;

  insert into customer (tenant_id, first_name, last_name, email)
    values (v_tenant_id, 'Test', 'Renter', 'test.renter@example.com')
    returning id into v_customer_id;

  insert into rental (tenant_id, customer_id, status)
    values (v_tenant_id, v_customer_id, 'pending')
    returning id into v_rental_id;

  -- ===========================================================
  -- TEST 1: Two active rental segments cannot overlap on the
  -- same vehicle (rental_segment_no_overlap exclusion constraint)
  -- ===========================================================
  insert into rental_segment (tenant_id, rental_id, vehicle_id, starts_at, ends_at)
    values (v_tenant_id, v_rental_id, v_vehicle_id, now(), null)
    returning id into v_segment1_id;

  perform test.assert_raises(
    format('insert into rental_segment (tenant_id, rental_id, vehicle_id, starts_at, ends_at)
             values (%L, %L, %L, now() + interval ''1 hour'', null)',
           v_tenant_id, v_rental_id, v_vehicle_id),
    'Test 1: overlapping rental_segment on the same vehicle is rejected'
  );

  -- ===========================================================
  -- TEST 2: Rental history cannot be destructively overwritten
  -- (rental_segment DELETE is blocked; UPDATE to close it out is fine)
  -- ===========================================================
  perform test.assert_raises(
    format('delete from rental_segment where id = %L', v_segment1_id),
    'Test 2: deleting a rental_segment is rejected'
  );

  update rental_segment set ends_at = now() where id = v_segment1_id;
  perform test.assert(true, 'Test 2b: updating ends_at on a rental_segment (closing it out) is allowed');

  -- ===========================================================
  -- TEST 3: Ledger entries are append-only; corrections use
  -- reversal/adjustment, not edits or deletes
  -- ===========================================================
  insert into ledger_entry (tenant_id, rental_id, customer_id, entry_type, amount)
    values (v_tenant_id, v_rental_id, v_customer_id, 'charge', 100.00);

  perform test.assert_raises(
    format('update ledger_entry set amount = 999 where tenant_id = %L and rental_id = %L', v_tenant_id, v_rental_id),
    'Test 3a: updating a ledger_entry is rejected'
  );
  perform test.assert_raises(
    format('delete from ledger_entry where tenant_id = %L and rental_id = %L', v_tenant_id, v_rental_id),
    'Test 3b: deleting a ledger_entry is rejected'
  );

  insert into ledger_entry (tenant_id, rental_id, customer_id, entry_type, amount, reference_type)
    values (v_tenant_id, v_rental_id, v_customer_id, 'reversal', -100.00, 'correction');
  perform test.assert(true, 'Test 3c: correcting via a new reversal entry is allowed (the correct pattern)');

  -- ===========================================================
  -- TEST 4: Used (immutable) policy/document versions cannot
  -- be mutated; non-immutable drafts still can be
  -- ===========================================================
  insert into policy_version (tenant_id, policy_type, version, effective_from, immutable)
    values (v_tenant_id, 'test_policy', 999, now(), true)
    returning id into v_policy_id;

  perform test.assert_raises(
    format('update policy_version set rules = ''{"changed":true}''::jsonb where id = %L', v_policy_id),
    'Test 4a: updating an immutable policy_version is rejected'
  );
  perform test.assert_raises(
    format('delete from policy_version where id = %L', v_policy_id),
    'Test 4b: deleting an immutable policy_version is rejected'
  );

  insert into policy_version (tenant_id, policy_type, version, effective_from, immutable)
    values (v_tenant_id, 'test_policy_draft', 999, now(), false)
    returning id into v_policy_mutable_id;
  update policy_version set rules = '{"draft":true}'::jsonb where id = v_policy_mutable_id;
  perform test.assert(true, 'Test 4c: a non-immutable (draft) policy_version can still be edited');

  insert into document_version (tenant_id, document_type, version, effective_from, immutable)
    values (v_tenant_id, 'test_agreement', 999, now(), true)
    returning id into v_document_id;
  perform test.assert_raises(
    format('delete from document_version where id = %L', v_document_id),
    'Test 4d: deleting an immutable document_version is rejected'
  );

  -- ===========================================================
  -- TEST 5: Provider webhook duplicate is processed once
  -- (unique(provider, external_event_id) already existed in schema.sql;
  -- confirming it actually holds)
  -- ===========================================================
  insert into webhook_event (tenant_id, provider, external_event_id, event_type)
    values (v_tenant_id, 'test_provider', 'evt_test_0001', 'payment.succeeded');
  perform test.assert_raises(
    format('insert into webhook_event (tenant_id, provider, external_event_id, event_type)
             values (%L, ''test_provider'', ''evt_test_0001'', ''payment.succeeded'')', v_tenant_id),
    'Test 5: inserting a duplicate (provider, external_event_id) webhook is rejected'
  );

  -- ===========================================================
  -- TEST 6: Recovery expenses do not become renter charges
  -- without approval
  -- ===========================================================
  insert into recovery_case (tenant_id, rental_id, vehicle_id, customer_id)
    values (v_tenant_id, v_rental_id, v_vehicle_id, v_customer_id)
    returning id into v_recovery_case_id;

  insert into recovery_expense (tenant_id, recovery_case_id, expense_type, amount, approval_status)
    values (v_tenant_id, v_recovery_case_id, 'towing', 250.00, 'pending')
    returning id into v_recovery_expense_id;

  perform test.assert_raises(
    format('insert into charge (tenant_id, rental_id, customer_id, charge_type, amount, source_recovery_expense_id)
             values (%L, %L, %L, ''recovery_towing'', 250.00, %L)',
           v_tenant_id, v_rental_id, v_customer_id, v_recovery_expense_id),
    'Test 6a: charging a renter from an unapproved recovery_expense is rejected'
  );

  update recovery_expense set approval_status = 'approved', approved_at = now()
    where id = v_recovery_expense_id;

  insert into charge (tenant_id, rental_id, customer_id, charge_type, amount, source_recovery_expense_id)
    values (v_tenant_id, v_rental_id, v_customer_id, 'recovery_towing', 250.00, v_recovery_expense_id);
  perform test.assert(true, 'Test 6b: charging a renter from an APPROVED recovery_expense succeeds');

  -- ===========================================================
  -- TEST 7: Invalid state transitions are rejected by the
  -- database itself (not just application code)
  -- ===========================================================
  perform test.assert_raises(
    format('update rental set status = ''closed'' where id = %L', v_rental_id),
    'Test 7a: rental pending -> closed (skipping the entire lifecycle) is rejected'
  );

  update rental set status = 'approved' where id = v_rental_id;
  perform test.assert(true, 'Test 7b: rental pending -> approved (a real, allowed transition) succeeds');

  perform test.assert_raises(
    format('update vehicle set status = ''rented'' where id = %L', v_vehicle_id),
    'Test 7c: vehicle acquired -> rented (skipping inspection/ready/available) is rejected'
  );

  update vehicle set status = 'inspection' where id = v_vehicle_id;
  perform test.assert(true, 'Test 7d: vehicle acquired -> inspection (a real, allowed transition) succeeds');

  raise notice '=== ALL DOMAIN INTEGRITY TESTS PASSED ===';
end $$;

rollback;
