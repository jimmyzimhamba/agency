-- ============================================================================
-- STUDIO X COMMAND — Points & Leaderboard (gamification, phase 1)
-- ============================================================================
-- Turns everyday pipeline activity into points, and adds a leaderboard that
-- (unlike the existing owner-only, revenue-based "Team Leaderboard" in
-- Team & Settings) is visible to the whole team. The goal is to reward
-- SHOWING UP and doing the work — adding a prospect, following up, finishing
-- your daily tasks — not just whoever happens to close the one big deal
-- that month. Revenue/MRR numbers are NOT touched or exposed by this
-- migration; this is a separate, additive scoring system.
--
-- One new table (points_log — an append-only ledger, one row per point-
-- earning event) and one read-only view (points_totals — per-person sums,
-- so the app never has to add up potentially thousands of rows itself).
--
-- HOW POINTS ARE AWARDED — entirely server-side, via triggers on tables that
-- already exist (prospects, prospect_notes, daily_task_completions,
-- community_posts, contracts, invoices, projects). Nothing in the app's
-- JavaScript ever writes to points_log directly — points can only come from
-- an actual, real action already recorded elsewhere, so there's no separate
-- "claim my points" button to trust or a client-side number to fudge.
--
-- ANTI-FARMING: every point-earning event is tagged with exactly which row
-- caused it (source_table + source_id + event_type), and points_log has a
-- UNIQUE constraint on that triple. That means flipping a prospect's status
-- back and forth, or checking/unchecking the same daily task on the same
-- day, only ever pays out once — the second, third, etc. attempt is
-- silently ignored (ON CONFLICT DO NOTHING), not an error.
--
-- Current point values (tweak the numbers in the trigger functions below if
-- you ever want to rebalance — nothing else needs to change):
--   +5   added a prospect to the pipeline
--   +2   moved a prospect to "Sent"
--   +5   moved a prospect to "Replied"
--   +10  moved a prospect to "Meeting Booked"
--   +30  signed a prospect (the big one)
--   +2   left a note on a prospect
--   +3   completed a daily task
--   +3   posted in the Community Feed
--   +8   drafted a contract
--   +15  marked a contract as signed
--   +5   created an invoice
--   +15  marked an invoice as paid
--   +5   started a project
--   +10  marked a project as complete
--
-- Points always go to whoever DID the thing (auth.uid() at the moment it
-- happened) — e.g. whoever flips a deal to "Signed" gets those points, even
-- if a teammate originally added that prospect. Same "credit the actor"
-- rule the existing Activity Feed triggers already use.
--
-- PREREQUISITE: the base schema (schema.sql or the earlier phase migrations)
-- must already be applied — this uses public.my_org_id() and the prospects/
-- contracts/invoices/projects/community_posts tables, all defined there.
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- Safe to re-run — every statement is guarded (if not exists / or replace /
-- drop trigger if exists).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. POINTS_LOG — append-only ledger, one row per point-earning event
-- ----------------------------------------------------------------------------
create table if not exists public.points_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  points integer not null,
  reason text not null,
  source_table text not null,
  source_id uuid not null,
  event_type text not null,
  created_at timestamptz not null default now(),
  unique (source_table, source_id, event_type)
);

create index if not exists idx_points_log_org on public.points_log (org_id);
create index if not exists idx_points_log_profile on public.points_log (profile_id);
create index if not exists idx_points_log_created on public.points_log (created_at desc);

alter table public.points_log enable row level security;

-- Everyone on the team can see everyone's points (that's the point of a
-- leaderboard) — but nobody can insert/update/delete a row directly. Only
-- the security-definer trigger functions below ever write here.
drop policy if exists "points_log: read org" on public.points_log;
create policy "points_log: read org" on public.points_log
  for select using (org_id = public.my_org_id());

-- ----------------------------------------------------------------------------
-- 2. POINTS_TOTALS — a read-only view, one row per person, so the app never
--    has to sum a growing ledger itself. security_invoker means this view
--    checks the RLS of whoever's actually querying it (same as querying
--    points_log directly would), not the view owner's — so it can never leak
--    another organization's totals.
-- ----------------------------------------------------------------------------
create or replace view public.points_totals
  with (security_invoker = true) as
  select
    org_id,
    profile_id,
    coalesce(sum(points), 0)::integer as total_points,
    count(*)::integer as event_count,
    max(created_at) as last_earned_at
  from public.points_log
  group by org_id, profile_id;

-- ----------------------------------------------------------------------------
-- 3. Shared helper — every trigger below just calls this. p_profile_id can
--    be null (e.g. a row with no assigned actor) — in that case we simply
--    don't award anything rather than erroring.
-- ----------------------------------------------------------------------------
create or replace function public.award_points(
  p_org_id uuid,
  p_profile_id uuid,
  p_points integer,
  p_reason text,
  p_source_table text,
  p_source_id uuid,
  p_event_type text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_profile_id is null or p_org_id is null then
    return;
  end if;

  insert into public.points_log (org_id, profile_id, points, reason, source_table, source_id, event_type)
  values (p_org_id, p_profile_id, p_points, p_reason, p_source_table, p_source_id, p_event_type)
  on conflict (source_table, source_id, event_type) do nothing;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. PROSPECTS — added to pipeline, and forward-moving status changes.
--    ('dead' and 'not_contacted' intentionally earn nothing.)
-- ----------------------------------------------------------------------------
create or replace function public.award_points_for_prospect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.award_points(new.org_id, auth.uid(), 5, 'Added ' || new.business_name || ' to the pipeline', 'prospects', new.id, 'added');
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    case new.status
      when 'sent' then
        perform public.award_points(new.org_id, auth.uid(), 2, 'Sent an opener to ' || new.business_name, 'prospects', new.id, 'status:sent');
      when 'replied' then
        perform public.award_points(new.org_id, auth.uid(), 5, new.business_name || ' replied', 'prospects', new.id, 'status:replied');
      when 'meeting_booked' then
        perform public.award_points(new.org_id, auth.uid(), 10, 'Booked a meeting with ' || new.business_name, 'prospects', new.id, 'status:meeting_booked');
      when 'signed' then
        perform public.award_points(new.org_id, auth.uid(), 30, 'Signed ' || new.business_name, 'prospects', new.id, 'status:signed');
      else
        -- 'dead' or anything else: no points either way.
        null;
    end case;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prospects_points on public.prospects;
create trigger trg_prospects_points after insert or update on public.prospects
  for each row execute function public.award_points_for_prospect();

-- ----------------------------------------------------------------------------
-- 5. PROSPECT_NOTES — no org_id column on this table, so it's looked up via
--    the prospect the note belongs to (same trick log_new_note() already
--    uses for the Activity Feed).
-- ----------------------------------------------------------------------------
create or replace function public.award_points_for_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.prospects where id = new.prospect_id;
  perform public.award_points(v_org_id, auth.uid(), 2, 'Left a note', 'prospect_notes', new.id, 'note');
  return new;
end;
$$;

drop trigger if exists trg_notes_points on public.prospect_notes;
create trigger trg_notes_points after insert on public.prospect_notes
  for each row execute function public.award_points_for_note();

-- ----------------------------------------------------------------------------
-- 6. DAILY_TASK_COMPLETIONS — the app upserts the SAME row (unique on
--    task_id/agent_id/work_date) when someone checks/unchecks a daily task,
--    so "completed becomes true" can fire more than once a day if someone
--    toggles it off and back on — the unique constraint on points_log
--    (source_table, source_id, event_type) means only the first one that day
--    actually pays out. Points go to the row's agent_id (whoever the task
--    belongs to), not necessarily auth.uid(), though in practice they're
--    always the same person today.
-- ----------------------------------------------------------------------------
create or replace function public.award_points_for_task_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.completed is true and (tg_op = 'INSERT' or old.completed is distinct from true) then
    perform public.award_points(new.org_id, new.agent_id, 3, 'Completed a daily task', 'daily_task_completions', new.id, 'completed');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_completions_points on public.daily_task_completions;
create trigger trg_task_completions_points after insert or update on public.daily_task_completions
  for each row execute function public.award_points_for_task_completion();

-- ----------------------------------------------------------------------------
-- 7. COMMUNITY_POSTS
-- ----------------------------------------------------------------------------
create or replace function public.award_points_for_community_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_points(new.org_id, auth.uid(), 3, 'Posted in the Community Feed', 'community_posts', new.id, 'posted');
  return new;
end;
$$;

drop trigger if exists trg_community_posts_points on public.community_posts;
create trigger trg_community_posts_points after insert on public.community_posts
  for each row execute function public.award_points_for_community_post();

-- ----------------------------------------------------------------------------
-- 8. CONTRACTS — drafted, and marked as signed.
-- ----------------------------------------------------------------------------
create or replace function public.award_points_for_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.award_points(new.org_id, auth.uid(), 8, 'Drafted a contract — ' || new.title, 'contracts', new.id, 'drafted');
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'signed' then
    perform public.award_points(new.org_id, auth.uid(), 15, 'Contract signed — ' || new.title, 'contracts', new.id, 'status:signed');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_contracts_points on public.contracts;
create trigger trg_contracts_points after insert or update on public.contracts
  for each row execute function public.award_points_for_contract();

-- ----------------------------------------------------------------------------
-- 9. INVOICES — created, and marked as paid.
-- ----------------------------------------------------------------------------
create or replace function public.award_points_for_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  label text;
begin
  label := coalesce(nullif(new.invoice_number, ''), 'an invoice');

  if tg_op = 'INSERT' then
    perform public.award_points(new.org_id, auth.uid(), 5, 'Created ' || label, 'invoices', new.id, 'created');
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'paid' then
    perform public.award_points(new.org_id, auth.uid(), 15, label || ' got paid', 'invoices', new.id, 'status:paid');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_invoices_points on public.invoices;
create trigger trg_invoices_points after insert or update on public.invoices
  for each row execute function public.award_points_for_invoice();

-- ----------------------------------------------------------------------------
-- 10. PROJECTS — started, and marked as complete.
-- ----------------------------------------------------------------------------
create or replace function public.award_points_for_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.award_points(new.org_id, auth.uid(), 5, 'Started a project — ' || new.name, 'projects', new.id, 'started');
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'complete' then
    perform public.award_points(new.org_id, auth.uid(), 10, 'Finished the project — ' || new.name, 'projects', new.id, 'status:complete');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_projects_points on public.projects;
create trigger trg_projects_points after insert or update on public.projects
  for each row execute function public.award_points_for_project();

-- ----------------------------------------------------------------------------
-- 11. REALTIME — so a point you just earned (or a teammate just earned)
--     shows up on the leaderboard live, no refresh needed. Guarded so this
--     is safe to re-run even if points_log is already in the publication.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'points_log'
  ) then
    alter publication supabase_realtime add table public.points_log;
  end if;
end $$;
