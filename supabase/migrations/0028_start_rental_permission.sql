-- start_rental Permission Gate
-- Migration 0021's own header comment explicitly flagged this as deferred:
-- "Left for later (flagged, not silently skipped): collect_payment,
-- issue_refund..., start_rental/close_rental/swap_vehicle as their own
-- distinct gates." Building the actual booking/rental creation flow now,
-- so closing this gap at the same time rather than deferring it again --
-- without it, ANY staff member (even a hypothetical zero-permission
-- "viewer" role) could activate a rental, since neither `rental` nor
-- `booking` nor `customer` had a permission-gate trigger at all.

insert into permission (code, description) values
  ('start_rental', 'Activate a rental (move it into active status, physically hand over a vehicle)')
on conflict (code) do nothing;

insert into role_permission (tenant_id, role_id, permission_id)
select r.tenant_id, r.id, p.id
from role r
cross join permission p
where r.name = 'admin' and p.code = 'start_rental'
on conflict do nothing;

create or replace function guard_rental_start() returns trigger as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform reject_without_permission('start_rental');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists rental_start_permission_guard on rental;
create trigger rental_start_permission_guard
  before insert or update on rental
  for each row execute function guard_rental_start();
