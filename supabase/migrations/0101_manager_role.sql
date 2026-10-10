-- Manager / VA role ("manager").
--
-- A day-to-day office role for a virtual assistant or ops manager. It can do the daily work (leads, inbox,
-- applications, scheduling, pickups, customers, insurance checks, fleet and maintenance, recording payments)
-- but NOT the things that move money out, change prices or policy, or change who has access:
--   withheld: manage_users_roles, manage_pricing, manage_pricing_policy, manage_marketing_settings,
--             issue_refund, approve_charge, approve_recovery_expense, authorize_recovery
-- Every other permission that exists when this runs is granted. The database enforces this on its own
-- (the guards from 0021/0032/0038/0039/0078 check the permission, not the role name), so a manager cannot
-- get around it through the data API either.
--
-- Run AFTER 0094 and 0095 so the field-report and maintenance permissions exist and are included.
-- Safe to run more than once. To change what a manager can do, edit the list below and run it again,
-- or add/remove rows in role_permission.

insert into role (tenant_id, name)
select t.id, 'manager' from tenant t
on conflict (tenant_id, name) do nothing;

insert into role_permission (tenant_id, role_id, permission_id)
select r.tenant_id, r.id, p.id
from role r cross join permission p
where r.name = 'manager'
  and p.code not in (
    'manage_users_roles', 'manage_pricing', 'manage_pricing_policy', 'manage_marketing_settings',
    'issue_refund', 'approve_charge', 'approve_recovery_expense', 'authorize_recovery'
  )
on conflict do nothing;

-- If the list above is ever tightened, take away anything a manager already holds that is now withheld.
delete from role_permission rp
using role r, permission p
where rp.role_id = r.id and rp.permission_id = p.id
  and r.name = 'manager'
  and p.code in (
    'manage_users_roles', 'manage_pricing', 'manage_pricing_policy', 'manage_marketing_settings',
    'issue_refund', 'approve_charge', 'approve_recovery_expense', 'authorize_recovery'
  );
