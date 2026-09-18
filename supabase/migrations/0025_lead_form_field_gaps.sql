-- Lead Form Field Gaps
-- Found reviewing the homepage lead form against the schema: two fields the
-- Nashville copy's lead form asks for had nowhere correct to go.
--   - "What are you driving for?" was being written into `referral`, a
--     column meant for referral-source tracking -- a real semantic
--     collision that would corrupt future referral-source reporting.
--   - "Additional information (optional)" had no column at all and was
--     being silently discarded despite the user typing it into the form.
-- Adding two properly named columns instead of continuing to misuse or
-- drop this data.

alter table lead add column if not exists driving_for text;
alter table lead add column if not exists notes text;

comment on column lead.driving_for is 'Free-text answer to "What are you driving for?" on the public lead form. Distinct from lead_gig_platform (structured checkbox selections) and from referral (actual referral-source tracking).';
comment on column lead.notes is 'Free-text "Additional information (optional)" from the public lead form.';
