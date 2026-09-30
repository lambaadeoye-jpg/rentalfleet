-- New qualifying fields for the alternative multi-step lead capture flow
-- (modeled on a competitor benchmark: license held, driving status,
-- urgency, asked one question per screen before contact info).
--
-- These aren't just UX flourishes -- they're exactly the signal needed
-- to avoid spending money (a paid background check, or staff/AI call
-- time) on a lead unlikely to convert: someone with no license and "just
-- checking my options" is a fundamentally different lead than someone
-- already driving who wants to start today. Feeds directly into the
-- cost-avoidance/red-flag scoping discussed alongside this.

alter table lead add column if not exists has_drivers_license boolean;
alter table lead add column if not exists driving_status text; -- already_driving | ready_to_start | no
alter table lead add column if not exists urgency text; -- today | this_week | within_2_weeks | just_checking
