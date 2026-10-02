-- Extends 0055 -- that migration covered outcome/timestamp/followup-flag;
-- this adds the two further fields the end-of-call report actually
-- carries: a plain-language summary (what a staff member reads in five
-- seconds) and, when the lead committed to a specific time to continue,
-- what that time was. Both genuinely useful, both easy to drop or
-- rename later if real SOPs want this shaped differently.

alter table lead add column if not exists last_call_summary text;
alter table lead add column if not exists last_call_committed_time text;
