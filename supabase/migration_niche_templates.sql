-- ============================================================================
-- STUDIO X COMMAND — MIGRATION: Auto-personalized, niche-specific opener messages
-- ============================================================================
-- What this does, in plain language:
--   - Adds a "which niche is this template for?" field to the Message Kit.
--   - Seeds one ready-to-use opener message per niche (Real Estate, Car
--     Dealerships, Solar, etc.) that automatically fills in each prospect's
--     business name, area, and the specific gap you noted about them —
--     so instead of a generic template, every agent's first message reads
--     like it was written for that exact business.
--   - A human on your team still reviews and taps Send inside WhatsApp —
--     nothing sends itself. This just removes the blank-page problem so
--     personalizing 150+ messages doesn't mean typing 150+ messages by hand.
--
-- HOW TO RUN THIS:
--   1. Open your Supabase project → SQL Editor → New query.
--   2. Paste this ENTIRE file in.
--   3. Click "Run".
-- Safe to run even if you already have templates — this only adds new ones
-- and won't touch or duplicate anything that already exists.
-- ============================================================================

alter table public.message_templates add column if not exists niche_id uuid references public.niches (id) on delete set null;
create index if not exists idx_templates_niche on public.message_templates (niche_id);

-- Niche-specific opener templates. These use {{business_name}}, {{area_clause}},
-- {{gap_clause}}, and {{agent_name}} tokens the app fills in automatically per
-- prospect — unlike your existing generic templates, which use manual
-- [Name]/[Business] placeholders meant for copy-paste. The app auto-picks the
-- matching niche template the first time an agent taps "Send WhatsApp" on a
-- prospect that doesn't have a message written yet.
insert into public.message_templates (title, category, body, niche_id, sort_order)
select v.title, 'opener', v.body, n.id, v.sort_order
from (values
  ('Real Estate Opener', 'Hi! I came across {{business_name}}{{area_clause}} while looking at real estate agencies around Harare — {{gap_clause}}. I work with agencies on getting more listing enquiries through social media and WhatsApp marketing. Worth a quick chat? — {{agent_name}}, Studio X Marketing', 'Real Estate Agencies', 10),
  ('Car Dealership Opener', 'Hi! I spotted {{business_name}}{{area_clause}} while looking at car dealerships in Harare — {{gap_clause}}. We help dealerships turn browsers into buyers with better social content and ads. Open to a quick chat? — {{agent_name}}, Studio X Marketing', 'Car Dealerships', 11),
  ('Professional Services Opener', 'Hi! I came across {{business_name}}{{area_clause}} — {{gap_clause}}. We help professional firms build trust online and bring in more client enquiries through content and a stronger digital presence. Would you be open to a short chat? — {{agent_name}}, Studio X Marketing', 'Professional Services (law, accounting, consulting)', 12),
  ('Solar Installer Opener', 'Hi! I noticed {{business_name}}{{area_clause}} — {{gap_clause}}. With load-shedding, demand for solar is huge right now, and we help installers like you capture more of those enquiries online. Quick chat? — {{agent_name}}, Studio X Marketing', 'Solar Installers', 13),
  ('Hotels & Lodges Opener', 'Hi! I came across {{business_name}}{{area_clause}} — {{gap_clause}}. We help hotels and lodges fill more rooms through better social media and booking-focused marketing. Open to a quick chat about it? — {{agent_name}}, Studio X Marketing', 'Hotels & Lodges', 14),
  ('Events & Wedding Opener', 'Hi! I spotted {{business_name}}{{area_clause}} — {{gap_clause}}. Wedding season enquiries move fast on Instagram and WhatsApp, and we help vendors like you stay visible and book more events. Worth a quick chat? — {{agent_name}}, Studio X Marketing', 'Events & Wedding Vendors', 15),
  ('Restaurants & Cafes Opener', 'Hi! I came across {{business_name}}{{area_clause}} — {{gap_clause}}. We help restaurants and cafes get more foot traffic through consistent, mouth-watering social content. Open to a quick chat? — {{agent_name}}, Studio X Marketing', 'Restaurants & Cafes', 16),
  ('Fashion & Boutiques Opener', 'Hi! I spotted {{business_name}}{{area_clause}} — {{gap_clause}}. We help boutiques turn their catalogue into consistent sales through social media and WhatsApp marketing. Quick chat sometime this week? — {{agent_name}}, Studio X Marketing', 'Fashion & Boutiques', 17),
  ('Fitness & Gyms Opener', 'Hi! I came across {{business_name}}{{area_clause}} — {{gap_clause}}. We help gyms and fitness studios fill more classes and memberships through better online marketing. Open to a quick chat? — {{agent_name}}, Studio X Marketing', 'Fitness & Gyms', 18),
  ('Healthcare & Clinics Opener', 'Hi! I noticed {{business_name}}{{area_clause}} — {{gap_clause}}. We help clinics build trust and bring in more patient enquiries through a stronger, more professional online presence. Would you be open to a quick chat? — {{agent_name}}, Studio X Marketing', 'Private Healthcare & Clinics', 19)
) as v(title, body, niche_name, sort_order)
join public.niches n on n.name = v.niche_name
where not exists (select 1 from public.message_templates mt where mt.title = v.title);

-- One niche-agnostic fallback, for the rare prospect with no niche set.
insert into public.message_templates (title, category, body, niche_id, sort_order)
select 'General Opener', 'opener', 'Hi! I came across {{business_name}}{{area_clause}} — {{gap_clause}}. We help local Harare businesses grow through social media and WhatsApp marketing. Would you be open to a quick chat? — {{agent_name}}, Studio X Marketing', null, 20
where not exists (select 1 from public.message_templates where title = 'General Opener');
