-- Confirmed decision: insurance is optional at application time (Zivo
-- can help an applicant without their own insurance get set up later --
-- the RentalCover/Bonzah plan discussed separately, not disclosed to
-- applicants at this stage). The application already functionally
-- allowed blank insurance fields with no validation, but had no
-- explicit yes/no answer -- someone could skip the fields without
-- realizing that was fine, rather than being asked directly.
--
-- Lives on application, not insurance_policy: this captures the
-- applicant's ANSWER to the question, independent of whether a real
-- policy record exists. Someone who says "no" has no policy to record
-- yet -- creating an empty insurance_policy row for them wouldn't mean
-- anything. Same pattern as lead.has_drivers_license: a stated answer,
-- separate from the verified record it may or may not produce later.

alter table application add column if not exists has_own_insurance boolean;
