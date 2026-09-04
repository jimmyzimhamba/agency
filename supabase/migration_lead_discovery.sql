-- ============================================================================
-- STUDIO X COMMAND — MIGRATION: Lead Discovery
-- ============================================================================
-- What this does, in plain language:
--   - Lets the app search Google Maps/Places for real businesses in a given
--     niche + area (e.g. "Solar Installers in Borrowdale") right from the
--     Discovery tab, instead of only adding prospects one-by-one or via a
--     manual paste.
--   - Remembers which Google listing (google_place_id) became which
--     prospect, so searching the same area twice won't offer you the same
--     business again once it's already in your pipeline.
--   - Optionally lets you fine-tune the exact search phrase Google should
--     use for a niche (e.g. "gym" instead of "Fitness & Gyms") — leave it
--     blank and the niche's name is used as-is.
--   - Adds an invisible rate-limit log (same idea as AI research) so a
--     burst of searches can't run up your Google API bill by accident.
--
-- HOW TO RUN THIS:
--   1. Open your Supabase project → SQL Editor → New query.
--   2. Paste this ENTIRE file in.
--   3. Click "Run".
-- Safe to run even if you've already applied it — every statement below
-- only adds something if it isn't already there.
-- ============================================================================

alter table public.prospects add column if not exists google_place_id text;

-- Stops the same Google listing being added twice within one organization,
-- and doubles as the lookup Discovery uses to grey out "already in your
-- pipeline" results. Prospects added by hand (no google_place_id) are
-- untouched — the "where" clause only applies the rule once a place id
-- exists.
create unique index if not exists idx_prospects_org_place
  on public.prospects (org_id, google_place_id)
  where google_place_id is not null;

alter table public.niches add column if not exists search_query text not null default '';

-- ----------------------------------------------------------------------------
-- DISCOVERY REQUESTS  (invisible rate-limit log for Google Places search)
-- ----------------------------------------------------------------------------
-- Same pattern as research_requests: one row per search, never shown in the
-- app, read only by the discover-places backend function (via the
-- service-role key, which bypasses RLS) to cap how many searches one
-- teammate can run per hour.
create table if not exists public.discovery_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_discovery_requests_by_user on public.discovery_requests (requested_by, created_at);

alter table public.discovery_requests enable row level security;
-- No select/insert policies for ordinary clients on purpose — only the
-- discover-places function ever touches this table.
