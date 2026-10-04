-- Supporting indexes for the inbox's real access patterns
-- (getConversations: tenant-scoped, ordered by created_at desc;
-- getConversationMessages: filtered by customer_id or lead_id).
-- The existing inbox foundation (0057) deliberately deferred this --
-- "genuinely small data volume at this stage... no need for a
-- dedicated SQL grouping query" -- these indexes don't change that
-- query shape, just make it scale once real message volume exists.

create index if not exists idx_communication_event_tenant_time
  on communication_event(tenant_id, created_at desc);
create index if not exists idx_communication_event_lead
  on communication_event(lead_id) where lead_id is not null;
create index if not exists idx_communication_event_customer
  on communication_event(customer_id) where customer_id is not null;
