-- ============================================================================
-- STUDIO X COMMAND — Migration: Copilot (AI chat assistant)
-- ============================================================================
-- Run this once in the Supabase SQL Editor to add what the new Copilot
-- feature needs: an invisible rate-limit log, same pattern as
-- research_requests and discovery_requests. See SETUP.md Step 144.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- COPILOT REQUESTS  (invisible rate-limit log for the AI chat assistant)
-- ----------------------------------------------------------------------------
-- One row per chat message sent to Claude. Not shown anywhere in the app —
-- the copilot-chat backend function reads this to make sure one teammate
-- chatting back-to-back can't accidentally rack up API costs. Same pattern
-- as research_requests / discovery_requests.
create table if not exists public.copilot_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_copilot_requests_by_user on public.copilot_requests (requested_by, created_at);

alter table public.copilot_requests enable row level security;
-- No select/insert policies for ordinary clients on purpose — only the
-- copilot-chat function ever touches this table.
