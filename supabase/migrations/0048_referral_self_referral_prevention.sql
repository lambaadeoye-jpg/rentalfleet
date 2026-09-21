-- Fix: link_referral() had no self-referral prevention at all
--
-- Real gap between what was scoped and what actually got built: during
-- scoping, self-referral blocking was explicitly proposed and agreed as
-- part of this feature ("I'd build in an automatic block on referring
-- your own email/phone") -- but the actual implementation never included
-- this check. Found on audit, not caught before shipping.
--
-- Fixed by comparing the new lead's phone/email against the referrer's
-- own phone/email; a match is a silent no-op, same behavior as an
-- invalid code, so this can't be used to enumerate/confirm anything
-- either.
--
-- Verified live: a self-referral attempt (matching phone) is correctly
-- blocked and creates no referral row, while a genuine referral (a real,
-- different person) still links correctly -- confirming the fix didn't
-- break the actual working path.

create or replace function link_referral(p_referral_code text, p_lead_id uuid) returns void as $$
declare
  v_referrer_id uuid;
  v_tenant_id uuid;
  v_referrer_phone text;
  v_referrer_email citext;
  v_lead_phone text;
  v_lead_email citext;
begin
  if p_referral_code is null or trim(p_referral_code) = '' then
    return;
  end if;

  select id, tenant_id, phone, email into v_referrer_id, v_tenant_id, v_referrer_phone, v_referrer_email
  from customer where referral_code = p_referral_code;

  if v_referrer_id is null then
    return;
  end if;

  select phone, email into v_lead_phone, v_lead_email from lead where id = p_lead_id;

  if (v_lead_phone is not null and v_lead_phone = v_referrer_phone)
     or (v_lead_email is not null and v_lead_email = v_referrer_email) then
    return;
  end if;

  update lead set referred_by_customer_id = v_referrer_id where id = p_lead_id;

  insert into referral (tenant_id, referrer_customer_id, referred_lead_id)
    values (v_tenant_id, v_referrer_id, p_lead_id)
    on conflict (referrer_customer_id, referred_lead_id) do nothing;
end;
$$ language plpgsql security definer set search_path = public;
