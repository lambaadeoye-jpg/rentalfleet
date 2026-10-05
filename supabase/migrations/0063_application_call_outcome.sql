-- Call-outcome tracking for the Application Nudge assistant, mirroring
-- lead's existing last_call_* columns (0055/0056) for consistency.
-- Confirmed gap: checked first, nothing like this existed on
-- application before this.
--
-- last_call_blocker is new, specific to this assistant: what the
-- diagnosis actually found (missing document, confusion about a step,
-- reconsidering entirely, etc.) -- useful signal for staff and for
-- improving this prompt later, same reasoning as objectionsRaised on
-- the lead-side assistant.

alter table application add column if not exists last_call_outcome text;
alter table application add column if not exists last_call_at timestamptz;
alter table application add column if not exists last_call_summary text;
alter table application add column if not exists last_call_committed_time text;
alter table application add column if not exists last_call_blocker text;
alter table application add column if not exists needs_human_followup boolean not null default false;
