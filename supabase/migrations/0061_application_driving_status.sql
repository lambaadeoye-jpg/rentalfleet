-- Confirmed decision: re-ask driving status at application time rather
-- than inherit it from the original lead record, since this is the
-- answer that actually gates a real requirement (which proof document
-- to request) and someone's status can genuinely change between
-- submitting a lead and starting an application.
--
-- Reuses the same three values as lead.driving_status (already_driving
-- / ready_to_start / no) for consistency rather than inventing a
-- separate vocabulary for what is, at root, the same question asked a
-- second time at a more consequential point in the funnel.
--
-- Lives on application, matching has_own_insurance's placement: a
-- stated answer, not a verified record.

alter table application add column if not exists driving_status text;
