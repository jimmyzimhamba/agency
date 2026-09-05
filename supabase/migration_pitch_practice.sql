-- ============================================================================
-- STUDIO X COMMAND — Migration: Pitch Practice (the team practice game)
-- ============================================================================
-- Run this once in the Supabase SQL Editor to add what the new Pitch Practice
-- feature needs. Safe to run on a live database: it only ADDS new tables and
-- never touches your existing prospects, contracts, invoices or anything else.
-- See SETUP.md Step 158.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PITCH SCENARIOS  (the deck of cards the team builds)
-- ----------------------------------------------------------------------------
-- One row per practice card. Anyone on the team can write one: a real
-- objection or awkward question a prospect actually threw at them. Everyone
-- in the same agency sees the same deck.
create table if not exists public.pitch_scenarios (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  prompt_text text not null,
  niche text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_pitch_scenarios_org on public.pitch_scenarios (org_id, created_at desc);

alter table public.pitch_scenarios enable row level security;

-- Everyone on the team can read the deck and add cards to it. Deliberately
-- not owner-only: the whole point is that the people taking real calls are
-- the ones who know which objections actually come up.
create policy "pitch_scenarios: read org" on public.pitch_scenarios
  for select using (org_id = public.my_org_id());
create policy "pitch_scenarios: team inserts" on public.pitch_scenarios
  for insert with check (org_id = public.my_org_id());
-- You can edit or retire your own card; owners can tidy up anyone's.
create policy "pitch_scenarios: author or owner updates" on public.pitch_scenarios
  for update using (org_id = public.my_org_id() and (created_by = auth.uid() or public.is_owner()));
create policy "pitch_scenarios: author or owner deletes" on public.pitch_scenarios
  for delete using (org_id = public.my_org_id() and (created_by = auth.uid() or public.is_owner()));

create trigger trg_pitch_scenarios_org before insert on public.pitch_scenarios
  for each row execute function public.stamp_org_id();

-- ----------------------------------------------------------------------------
-- PITCH ATTEMPTS  (one row each time someone practices a card)
-- ----------------------------------------------------------------------------
-- Stores what the person answered and the coaching note that came back, so
-- they can look over their own past attempts and see themselves improving.
--
-- Note what is deliberately NOT here: no score column, no points, no ranking.
-- A number would immediately turn practice into a scoreboard, and a scoreboard
-- would push people to farm easy cards instead of trying the hard ones. The
-- feedback is words, on purpose.
create table if not exists public.pitch_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  scenario_id uuid not null references public.pitch_scenarios (id) on delete cascade,
  agent_id uuid references public.profiles (id) on delete cascade,
  response_text text not null,
  coach_note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pitch_attempts_agent on public.pitch_attempts (agent_id, created_at desc);
create index if not exists idx_pitch_attempts_scenario on public.pitch_attempts (scenario_id, created_at desc);

alter table public.pitch_attempts enable row level security;

-- Your practice attempts are YOURS. Nobody else on the team can read them,
-- not even the owner. Practising badly in private is the entire point of
-- practice, and people won't try the hard cards if the boss can read every
-- fumbled answer.
create policy "pitch_attempts: read own" on public.pitch_attempts
  for select using (org_id = public.my_org_id() and agent_id = auth.uid());
create policy "pitch_attempts: insert own" on public.pitch_attempts
  for insert with check (org_id = public.my_org_id() and agent_id = auth.uid());
create policy "pitch_attempts: delete own" on public.pitch_attempts
  for delete using (org_id = public.my_org_id() and agent_id = auth.uid());

create trigger trg_pitch_attempts_org before insert on public.pitch_attempts
  for each row execute function public.stamp_org_id();

-- ----------------------------------------------------------------------------
-- PITCH COACH REQUESTS  (invisible rate-limit log)
-- ----------------------------------------------------------------------------
-- One row per coaching request sent to Claude. Not shown anywhere in the app.
-- The pitch-coach backend function reads this so that nobody can accidentally
-- rack up API costs by hammering the practice button. Same pattern as
-- copilot_requests / research_requests.
create table if not exists public.pitch_coach_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_pitch_coach_requests_by_user on public.pitch_coach_requests (requested_by, created_at);

alter table public.pitch_coach_requests enable row level security;
-- No policies on purpose — only the pitch-coach function touches this table.
