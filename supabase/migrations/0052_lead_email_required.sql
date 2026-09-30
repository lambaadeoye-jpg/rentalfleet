-- Business decision change: email on the lead form is now required, not
-- just captured -- a deliberate deviation from the original V2.1 spec
-- (which listed email as "Capture", not "Required", unlike first name/
-- last name/phone). Enforced at the DB level to match the existing
-- discipline here (migration 0024 did the same for first_name/last_name/
-- phone) -- business rules don't live only in frontend controls.
--
-- One existing row (a leftover "test test" record with no email) would
-- have blocked this constraint -- confirmed it was genuine test data,
-- not a real lead, and removed it (plus its lead_gig_platform child row)
-- before applying.

alter table lead alter column email set not null;
