-- Fix: ledger_entry had no INSERT permission gate at all
--
-- Found while building the referral credit application feature: the
-- existing ledger_entry_no_mutation trigger correctly enforces append-
-- only behavior (blocks UPDATE/DELETE), but nothing at all gated who
-- could INSERT a new row. Any staff member with basic tenant membership
-- could have inserted arbitrary ledger entries -- fabricated charges,
-- fake credits, fake payments -- with zero permission check. More
-- serious than anything else found in the earlier audit pass, since
-- this is the canonical record of all financial movement in the system.
--
-- Reuses approve_charge (the most senior financial-approval permission
-- already established) rather than a narrower one, given ledger_entry
-- can represent many different kinds of financial events and deserves
-- the strongest existing gate available.
--
-- Verified live, 4 assertions: viewer blocked from inserting, admin
-- succeeds (confirms approveReferral()'s existing flow still works),
-- and -- critically -- both UPDATE and DELETE are still correctly
-- blocked by the pre-existing append-only guard, unaffected by this
-- change.

create or replace function guard_ledger_entry_insert() returns trigger as $$
begin
  perform reject_without_permission('approve_charge');
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists ledger_entry_insert_guard on ledger_entry;
create trigger ledger_entry_insert_guard
  before insert on ledger_entry
  for each row execute function guard_ledger_entry_insert();
