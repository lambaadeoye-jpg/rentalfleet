-- Drop-off date policy: every rental's drop-off defaults to pickup + 7
-- days AUTOMATICALLY, and staff can change it at any time.
--
-- This flag records whether staff have set a drop-off date of their own.
--   false (default) -> the date is automatic; it is recomputed from the
--                      real pickup moment when pickup is confirmed.
--   true            -> staff chose it; pickup confirmation leaves it alone.
-- Without it there is no way to tell an automatic date from a manual one,
-- and a later automatic recompute would silently overwrite a staff choice.

alter table rental add column if not exists drop_off_manually_set boolean not null default false;
