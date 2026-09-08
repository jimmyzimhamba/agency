-- ============================================================================
-- STUDIO X COMMAND, MIGRATION: Individual (per-agent) daily tasks
-- ============================================================================
-- What this does, in plain language:
--   - Today, every item on the "Today's Outreach Rhythm" checklist goes to
--     EVERYONE on the team. This adds the option to assign a task to just
--     one specific person instead, e.g. "Follow up with Bulawayo estate
--     leads" only shows up for the agent working that patch, not the whole
--     team.
--   - Tasks with no assignee keep working exactly as before (shared by all).
--   - Nothing existing changes or breaks, this only adds a new optional
--     field.
--
-- HOW TO RUN THIS:
--   1. Open your Supabase project -> SQL Editor -> New query.
--   2. Paste this ENTIRE file in.
--   3. Click "Run".
-- Safe to run even if you've already run it before.
-- ============================================================================

alter table public.daily_tasks
  add column if not exists assigned_to uuid references public.profiles (id) on delete cascade;

create index if not exists idx_daily_tasks_assigned_to on public.daily_tasks (assigned_to);
