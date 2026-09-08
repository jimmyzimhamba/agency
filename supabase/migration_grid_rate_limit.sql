-- ============================================================================
-- Agency Command, Grid Plan Review, Part 3: rate-limit table
-- ============================================================================
-- The public client review page has no login, so anything that stops a
-- share_token from being hammered (a brute-force guessing attempt, or just a
-- buggy client stuck in a retry loop) has to live somewhere the client can't
-- bypass by simply not sending a header. This table is that "somewhere", -- it's only ever read/written by the review-* Edge Functions using the
-- service-role key (see supabase/functions/review-load, review-update,
-- review-reorder, review-complete). Deliberately NO RLS policies at all, -- not even for `authenticated`, so nobody, including a signed-in teammate,
-- can read or tamper with it directly; only the service-role key (which
-- bypasses RLS entirely) can touch it.
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- Safe to re-run.
-- ============================================================================

create table if not exists public.grid_rate_limit (
  id bigint generated always as identity primary key,
  -- e.g. "load:<share_token>" or "update:<share_token>", namespaced per
  -- action so a burst of review-load calls doesn't eat into the separate
  -- budget for review-update calls on the same plan.
  bucket text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_grid_rate_limit_bucket_time on public.grid_rate_limit (bucket, created_at desc);

alter table public.grid_rate_limit enable row level security;
-- No policies, see note above. This is intentional, not an oversight.

-- ============================================================================
-- DONE. Changes nothing visible yet, the review-* Edge Functions that read
-- and write this table are deployed separately (see SETUP.md).
-- ============================================================================
