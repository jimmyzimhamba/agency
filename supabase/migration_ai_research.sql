-- ============================================================================
-- STUDIO X COMMAND, MIGRATION: AI auto-research + auto-generated outreach
-- ============================================================================
-- What this does, in plain language:
--   - Adds a "Website" field to prospects (one more research clue alongside
--     Instagram/WhatsApp/area/niche).
--   - Adds columns that track the AI research: a short "what we found"
--     summary, a status (pending/researching/done/failed), whether the
--     current outreach message was written by a person, generated from
--     real research, or is a safe fallback template that needs a review,
--     and when the research last ran.
--   - Adds a small research_requests log table. This is NOT visible
--     anywhere in the app, it's only used by the backend research
--     function to make sure one teammate adding a burst of prospects can't
--     accidentally rack up API costs or trip Anthropic's own rate limits.
--
-- HOW TO RUN THIS:
--   1. Open your Supabase project → SQL Editor → New query.
--   2. Paste this ENTIRE file in.
--   3. Click "Run".
-- Safe to run even if you've already added some of this, every statement
-- below is written to skip anything that already exists.
-- ============================================================================

alter table public.prospects add column if not exists website text not null default '';

alter table public.prospects add column if not exists research_summary text not null default '';

alter table public.prospects add column if not exists research_status text not null default 'pending';
alter table public.prospects drop constraint if exists prospects_research_status_check;
alter table public.prospects add constraint prospects_research_status_check
  check (research_status in ('pending', 'researching', 'done', 'failed'));

alter table public.prospects add column if not exists message_source text not null default 'manual';
alter table public.prospects drop constraint if exists prospects_message_source_check;
alter table public.prospects add constraint prospects_message_source_check
  check (message_source in ('manual', 'ai_generated', 'auto_template'));

alter table public.prospects add column if not exists researched_at timestamptz;

-- ----------------------------------------------------------------------------
-- RESEARCH REQUESTS  (invisible rate-limit log, one row per research run)
-- ----------------------------------------------------------------------------
create table if not exists public.research_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references public.profiles (id) on delete cascade,
  prospect_id uuid references public.prospects (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_research_requests_by_user on public.research_requests (requested_by, created_at);

alter table public.research_requests enable row level security;
-- No select/insert policies for ordinary clients on purpose, this table is
-- only ever written to by the research-prospect backend function, which
-- uses the secure service-role key and bypasses RLS entirely (the same
-- pattern already used for status_history).

-- ============================================================================
-- DONE. Next: deploy the "research-prospect" Edge Function (see SETUP.md,
-- "Turn on AI Research" section) so new prospects start getting researched.
-- ============================================================================
