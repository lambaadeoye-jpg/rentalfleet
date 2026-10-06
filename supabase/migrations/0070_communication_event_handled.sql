-- Lets staff clear an unanswered inbound message/callback request from the
-- Inbox badge without sending a reply (e.g. handled by phone).
-- Existing RLS update policy + write guard (engage_leads) already apply.
alter table public.communication_event
  add column if not exists handled_at timestamptz,
  add column if not exists handled_by uuid references auth.users(id);
