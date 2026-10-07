-- 0083: Security hardening flagged by the Supabase security advisor (2026-10-06). No behavior change.
--
--  1. Trigger functions and cron-only jobs should not be callable through the public API (/rest/v1/rpc/...).
--     Revoking EXECUTE does not stop triggers from firing, and pg_cron runs as the database owner, so nothing breaks.
--     The signed-in-user and public-form functions the app really calls (check_red_flag, link_referral,
--     app_current_*, app_has_permission, the staff action functions) are deliberately left alone.
--  2. _settle_pre_pickup (0078) gets a fixed search_path like every other function.

revoke all on function trg_notice_billing_update() from public, anon, authenticated;
revoke all on function trg_notice_pay_request_update() from public, anon, authenticated;
revoke all on function trg_notice_refund_insert() from public, anon, authenticated;
revoke all on function trg_notice_refund_update() from public, anon, authenticated;
revoke all on function advance_weekly_due_date() from public, anon, authenticated;
revoke all on function sync_payment_schedule_for_rental() from public, anon, authenticated;
revoke all on function enforce_status_transition() from public, anon, authenticated;
revoke all on function guard_rental_requires_insurance() from public, anon, authenticated;
revoke all on function link_lead_before_insert() from public, anon, authenticated;
revoke all on function link_leads_after_customer_change() from public, anon, authenticated;
-- Scheduled jobs (pg_cron): nobody should be able to trigger these from the public API.
revoke all on function apply_late_fees() from public, anon, authenticated;
revoke all on function detect_qualified_referrals() from public, anon, authenticated;

alter function _settle_pre_pickup(text, numeric, integer, integer, integer, numeric, numeric, integer, integer) set search_path = public;
