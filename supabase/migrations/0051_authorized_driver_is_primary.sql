-- Fix: authorized_driver had no way to distinguish the applicant's own
-- license record from a genuine additional/authorized driver.
--
-- Found while scoping additional-driver capture: the application flow
-- already writes to authorized_driver in saveLicenseStep() to store the
-- APPLICANT'S OWN license, always fetched with .limit(1).maybeSingle()
-- assuming exactly one row per customer. Adding real additional-driver
-- rows for the same customer_id would have silently broken that
-- assumption -- whichever row came back first from the unordered
-- .limit(1) would get treated as "the applicant's license" on the
-- license step, which could just as easily be a friend's record.
--
-- Fixed by adding is_primary, backfilling every existing row true
-- (every authorized_driver row created so far genuinely IS the
-- applicant's own license -- no additional-driver feature existed
-- before this), and the application code changes below filter on it
-- explicitly going forward.

alter table authorized_driver add column if not exists is_primary boolean not null default false;

update authorized_driver set is_primary = true where is_primary = false;
