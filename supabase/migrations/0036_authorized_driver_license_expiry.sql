-- Add license_expiry to authorized_driver
-- Needed for the Driver's License Expiry Alert n8n workflow -- the column
-- didn't exist at all before, so nothing could ever have populated it.
-- Wired into the Application Workspace's License step in the same pass
-- (app/apply/actions.ts, app/apply/workspace.tsx) -- a column nothing
-- ever collects is exactly as useless as a column that doesn't exist.
--
-- Uses IF NOT EXISTS: this column was already applied directly to the
-- live database in an earlier session before this migration file was
-- written, so this closes the gap in tracked migration history without
-- erroring on a column that's already there.

alter table authorized_driver add column if not exists license_expiry date;
