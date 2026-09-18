-- Add Medical Courier Services to the gig platform list
-- Resolves a discrepancy found reviewing Greater_Nashville_Vehicle_Rental_Complete_Copy_v2_1.docx
-- against the earlier-built gig_platform list: the official marketing copy's
-- "Platforms & Work Types" section lists Medical Courier Services (and does
-- NOT list Instacart), while the database had Instacart but not Medical
-- Courier Services. Business decision: keep both.

insert into gig_platform (code, name, sort_order) values
  ('medical_courier', 'Medical Courier Services', 7)
on conflict (code) do nothing;

update gig_platform set sort_order = 8 where code = 'other';
