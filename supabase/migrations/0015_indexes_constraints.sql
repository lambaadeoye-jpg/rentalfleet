-- Indexes & Constraints
-- Generated from the consolidated schema.sql baseline, split to match the
-- Migration Order defined in Fleet_Rental_SaaS_Physical_Database_Implementation_Specification_v2.0.
-- Phase reference: BUILD_MASTER_SPECIFICATION_v2.0.md / Implementation Plan v2.0

create unique index if not exists uq_vehicle_tenant_vin on vehicle(tenant_id,vin) where vin is not null;
create unique index if not exists uq_booking_external on booking(tenant_id,channel_id,external_booking_id)
where external_booking_id is not null;
create unique index if not exists uq_provider_payment on payment(tenant_id,provider,provider_payment_id)
where provider_payment_id is not null;
create unique index if not exists uq_automation_idempotency
on automation_execution(tenant_id,idempotency_key)
where idempotency_key is not null;
create index if not exists idx_customer_tenant on customer(tenant_id);
create index if not exists idx_lead_pipeline on lead(tenant_id,stage,assigned_user_id);
create index if not exists idx_vehicle_availability on vehicle(tenant_id,status,location_id,category_id);
create index if not exists idx_rental_customer_status on rental(tenant_id,customer_id,status);
create index if not exists idx_rental_segment_vehicle_time on rental_segment(tenant_id,vehicle_id,starts_at,ends_at);
create index if not exists idx_payment_due on payment_schedule(tenant_id,status,next_due_at);
create index if not exists idx_telematics_vehicle_time on telematics_event(tenant_id,vehicle_id,occurred_at);
create index if not exists idx_recovery_status on recovery_case(tenant_id,status);
create index if not exists idx_audit_entity on audit_event(tenant_id,entity_type,entity_id,created_at);
