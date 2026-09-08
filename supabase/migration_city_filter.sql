-- ============================================================================
-- STUDIO X COMMAND, MIGRATION: City field + filter for prospects
-- ============================================================================
-- What this does, in plain language:
--   - Adds a "City" field to every prospect (e.g. Harare, Bulawayo) so as
--     the team expands beyond Harare, any agent who logs on can filter the
--     pipeline down to just the city they're working, no more scrolling
--     past leads from the other city to find their own.
--   - Existing prospects are backfilled to "Harare" since that's been the
--     only market so far, nothing gets lost or reset.
--   - New prospects default to "Harare" too unless changed in the Add
--     Prospect form (or set explicitly via Bulk Import).
--
-- HOW TO RUN THIS:
--   1. Open your Supabase project -> SQL Editor -> New query.
--   2. Paste this ENTIRE file in.
--   3. Click "Run".
-- Safe to run even if you've already run it before.
-- ============================================================================

alter table public.prospects
  add column if not exists city text not null default 'Harare';

update public.prospects set city = 'Harare' where city is null or city = '';

create index if not exists idx_prospects_city on public.prospects (city);
