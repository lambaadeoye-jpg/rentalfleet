-- Call-outcome tracking for the Pickup Reminder assistant, mirroring the
-- last_call_* pattern on lead (0055/0056) and application (0063).
--
-- The pickup appointment itself (time + location) already has a home on
-- booking (pickup_at, pickup_location_id); nothing in the app was setting
-- them to a real appointment (scheduleRental used "now" and no location),
-- which is fixed in app code alongside this migration.
--
-- pickup_confirmed_at: the renter confirmed this appointment on a call.
-- Cleared whenever staff change the appointment, so it never claims
-- confirmation of a time the renter hasn't actually heard.

alter table rental add column if not exists pickup_confirmed_at timestamptz;
alter table rental add column if not exists last_call_outcome text;
alter table rental add column if not exists last_call_at timestamptz;
alter table rental add column if not exists last_call_summary text;
alter table rental add column if not exists last_call_committed_time text;
alter table rental add column if not exists needs_human_followup boolean not null default false;
