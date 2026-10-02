-- Tracks the outcome of the AI voice qualification call, separate from
-- the free-text `notes` column -- kept queryable (e.g. "show me every
-- lead that needs human follow-up from a call") rather than buried in
-- unstructured text. Lightweight and additive, same pattern as
-- red_flag_matched -- easy to adjust once real SOPs are finalized.

alter table lead add column if not exists last_call_outcome text;
alter table lead add column if not exists last_call_at timestamptz;
alter table lead add column if not exists needs_human_followup boolean not null default false;
