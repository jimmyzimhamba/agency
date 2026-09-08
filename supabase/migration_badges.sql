-- ============================================================================
-- STUDIO X COMMAND, Badges & Achievements (gamification, phase 2)
-- ============================================================================
-- Builds on migration_points.sql (run that one first if you haven't). Badges
-- are unlocked automatically by counting up what's already in points_log, -- there's no new "did the thing" tracking to maintain, and no way for the
-- app's JavaScript to hand out a badge that wasn't actually earned, because
-- the counting happens entirely server-side, in the same moment a point-
-- earning trigger already fires.
--
-- One new table (badges_earned, who has which badge, and when), plus a
-- helper (award_badge) and a checker (check_and_award_badges) that the
-- existing points triggers now call at the end of their work. Visible to the
-- whole team, same as the points leaderboard, achievements aren't sensitive
-- like revenue numbers are.
--
-- THE BADGE CATALOG (14 badges, keep this list in sync with the matching
-- catalog in app/js/badges.js, which owns the label/description/icon for
-- display; this file only owns the unlock KEY and threshold):
--   first_prospect, add 1 prospect
--   prospector, add 25 prospects
--   first_deal, sign 1 deal
--   closer, sign 5 deals
--   rainmaker, sign 10 deals
--   paperwork, draft 1 contract
--   ink_master, get 5 contracts signed
--   getting_paid, get 5 invoices paid
--   note_taker, leave 10 notes
--   team_player, post 10 times in Community Feed
--   consistent, complete 30 daily tasks
--   century_club, reach 100 total points
--   high_roller, reach 500 total points
--   legend, reach 1000 total points
--
-- HOW UNLOCKS ARE DETECTED, each of the 7 point-earning trigger functions
-- from migration_points.sql is re-declared here (CREATE OR REPLACE, same
-- function, same trigger, nothing new to attach) with one extra line at the
-- end: a call to check_and_award_badges(org_id, profile_id), which recounts
-- that person's points_log rows and awards any badge whose threshold is now
-- met. Re-checking on every event is cheap (points_log is indexed on
-- profile_id) and means a badge unlocks the instant it's earned, not on some
-- delayed batch job.
--
-- ANTI-DUPLICATE CELEBRATION: award_badge() uses the same ON CONFLICT DO
-- NOTHING + GET DIAGNOSTICS pattern as award_points(), a badge can only be
-- unlocked once per person (unique constraint), and the celebratory Activity
-- Feed post ("X earned the 'Closer' badge!") only fires the moment it's
-- actually newly inserted, never on a re-check that finds it already there.
--
-- PREREQUISITE: migration_points.sql must already be applied (this reads
-- from points_log and points_totals, both defined there).
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- Safe to re-run, every statement is guarded (if not exists / or replace /
-- drop trigger if exists).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. BADGES_EARNED, one row per person per badge, ever.
-- ----------------------------------------------------------------------------
create table if not exists public.badges_earned (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  badge_key text not null,
  earned_at timestamptz not null default now(),
  unique (profile_id, badge_key)
);

create index if not exists idx_badges_earned_org on public.badges_earned (org_id);
create index if not exists idx_badges_earned_profile on public.badges_earned (profile_id);

alter table public.badges_earned enable row level security;

-- Everyone on the team can see everyone's badges, nobody can insert/update/
-- delete a row directly. Only the security-definer functions below write here.
drop policy if exists "badges_earned: read org" on public.badges_earned;
create policy "badges_earned: read org" on public.badges_earned
  for select using (org_id = public.my_org_id());

-- ----------------------------------------------------------------------------
-- 2. AWARD_BADGE, shared helper. Inserts once (unique constraint), and only
--    when this is a genuinely NEW unlock (not a re-check that already has
--    it), posts a celebratory line to the Activity Feed so the whole team
--    sees it.
-- ----------------------------------------------------------------------------
create or replace function public.award_badge(
  p_org_id uuid,
  p_profile_id uuid,
  p_badge_key text,
  p_badge_label text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
  actor_name text;
begin
  if p_profile_id is null or p_org_id is null then
    return;
  end if;

  insert into public.badges_earned (org_id, profile_id, badge_key)
  values (p_org_id, p_profile_id, p_badge_key)
  on conflict (profile_id, badge_key) do nothing;

  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    select coalesce(full_name, email) into actor_name from public.profiles where id = p_profile_id;
    actor_name := coalesce(actor_name, 'Someone');

    insert into public.activity_log (actor_id, prospect_id, message, org_id)
    values (p_profile_id, null, actor_name || ' earned the "' || p_badge_label || '" badge 🏅', p_org_id);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. CHECK_AND_AWARD_BADGES, recomputes this person's counts from points_log
--    and awards every badge whose threshold is now met. Cheap to call on
--    every point-earning event; already-earned badges are just a no-op via
--    the unique constraint above.
-- ----------------------------------------------------------------------------
create or replace function public.check_and_award_badges(
  p_org_id uuid,
  p_profile_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prospects_added integer;
  v_deals_signed integer;
  v_contracts_drafted integer;
  v_contracts_signed integer;
  v_invoices_paid integer;
  v_notes integer;
  v_community_posts integer;
  v_tasks_completed integer;
  v_total_points integer;
begin
  if p_profile_id is null or p_org_id is null then
    return;
  end if;

  select count(*) into v_prospects_added from public.points_log
    where profile_id = p_profile_id and source_table = 'prospects' and event_type = 'added';
  select count(*) into v_deals_signed from public.points_log
    where profile_id = p_profile_id and source_table = 'prospects' and event_type = 'status:signed';
  select count(*) into v_contracts_drafted from public.points_log
    where profile_id = p_profile_id and source_table = 'contracts' and event_type = 'drafted';
  select count(*) into v_contracts_signed from public.points_log
    where profile_id = p_profile_id and source_table = 'contracts' and event_type = 'status:signed';
  select count(*) into v_invoices_paid from public.points_log
    where profile_id = p_profile_id and source_table = 'invoices' and event_type = 'status:paid';
  select count(*) into v_notes from public.points_log
    where profile_id = p_profile_id and source_table = 'prospect_notes' and event_type = 'note';
  select count(*) into v_community_posts from public.points_log
    where profile_id = p_profile_id and source_table = 'community_posts' and event_type = 'posted';
  select count(*) into v_tasks_completed from public.points_log
    where profile_id = p_profile_id and source_table = 'daily_task_completions' and event_type = 'completed';
  select coalesce(sum(points), 0) into v_total_points from public.points_log
    where profile_id = p_profile_id;

  if v_prospects_added >= 1 then perform public.award_badge(p_org_id, p_profile_id, 'first_prospect', 'First Prospect'); end if;
  if v_prospects_added >= 25 then perform public.award_badge(p_org_id, p_profile_id, 'prospector', 'Prospector'); end if;

  if v_deals_signed >= 1 then perform public.award_badge(p_org_id, p_profile_id, 'first_deal', 'First Deal'); end if;
  if v_deals_signed >= 5 then perform public.award_badge(p_org_id, p_profile_id, 'closer', 'Closer'); end if;
  if v_deals_signed >= 10 then perform public.award_badge(p_org_id, p_profile_id, 'rainmaker', 'Rainmaker'); end if;

  if v_contracts_drafted >= 1 then perform public.award_badge(p_org_id, p_profile_id, 'paperwork', 'Paperwork'); end if;
  if v_contracts_signed >= 5 then perform public.award_badge(p_org_id, p_profile_id, 'ink_master', 'Ink Master'); end if;

  if v_invoices_paid >= 5 then perform public.award_badge(p_org_id, p_profile_id, 'getting_paid', 'Getting Paid'); end if;

  if v_notes >= 10 then perform public.award_badge(p_org_id, p_profile_id, 'note_taker', 'Note Taker'); end if;
  if v_community_posts >= 10 then perform public.award_badge(p_org_id, p_profile_id, 'team_player', 'Team Player'); end if;
  if v_tasks_completed >= 30 then perform public.award_badge(p_org_id, p_profile_id, 'consistent', 'Consistent'); end if;

  if v_total_points >= 100 then perform public.award_badge(p_org_id, p_profile_id, 'century_club', 'Century Club'); end if;
  if v_total_points >= 500 then perform public.award_badge(p_org_id, p_profile_id, 'high_roller', 'High Roller'); end if;
  if v_total_points >= 1000 then perform public.award_badge(p_org_id, p_profile_id, 'legend', 'Legend'); end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Re-declare the 7 points triggers from migration_points.sql, each with
--    one extra line at the end calling check_and_award_badges(). Same
--    functions, same triggers already attached, nothing new to create here,
--    CREATE OR REPLACE just swaps in the new function body.
-- ----------------------------------------------------------------------------

-- PROSPECTS
create or replace function public.award_points_for_prospect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.award_points(new.org_id, auth.uid(), 5, 'Added ' || new.business_name || ' to the pipeline', 'prospects', new.id, 'added');
    perform public.check_and_award_badges(new.org_id, auth.uid());
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
    perform public.check_and_award_badges(new.org_id, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prospects_points on public.prospects;
create trigger trg_prospects_points after insert or update on public.prospects
  for each row execute function public.award_points_for_prospect();

-- PROSPECT_NOTES
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
  perform public.check_and_award_badges(v_org_id, auth.uid());
  return new;
end;
$$;

drop trigger if exists trg_notes_points on public.prospect_notes;
create trigger trg_notes_points after insert on public.prospect_notes
  for each row execute function public.award_points_for_note();

-- DAILY_TASK_COMPLETIONS
create or replace function public.award_points_for_task_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.completed is true and (tg_op = 'INSERT' or old.completed is distinct from true) then
    perform public.award_points(new.org_id, new.agent_id, 3, 'Completed a daily task', 'daily_task_completions', new.id, 'completed');
    perform public.check_and_award_badges(new.org_id, new.agent_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_completions_points on public.daily_task_completions;
create trigger trg_task_completions_points after insert or update on public.daily_task_completions
  for each row execute function public.award_points_for_task_completion();

-- COMMUNITY_POSTS
create or replace function public.award_points_for_community_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_points(new.org_id, auth.uid(), 3, 'Posted in the Community Feed', 'community_posts', new.id, 'posted');
  perform public.check_and_award_badges(new.org_id, auth.uid());
  return new;
end;
$$;

drop trigger if exists trg_community_posts_points on public.community_posts;
create trigger trg_community_posts_points after insert on public.community_posts
  for each row execute function public.award_points_for_community_post();

-- CONTRACTS
create or replace function public.award_points_for_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.award_points(new.org_id, auth.uid(), 8, 'Drafted a contract: ' || new.title, 'contracts', new.id, 'drafted');
    perform public.check_and_award_badges(new.org_id, auth.uid());
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'signed' then
    perform public.award_points(new.org_id, auth.uid(), 15, 'Contract signed: ' || new.title, 'contracts', new.id, 'status:signed');
    perform public.check_and_award_badges(new.org_id, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_contracts_points on public.contracts;
create trigger trg_contracts_points after insert or update on public.contracts
  for each row execute function public.award_points_for_contract();

-- INVOICES
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
    perform public.check_and_award_badges(new.org_id, auth.uid());
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'paid' then
    perform public.award_points(new.org_id, auth.uid(), 15, label || ' got paid', 'invoices', new.id, 'status:paid');
    perform public.check_and_award_badges(new.org_id, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_invoices_points on public.invoices;
create trigger trg_invoices_points after insert or update on public.invoices
  for each row execute function public.award_points_for_invoice();

-- PROJECTS
create or replace function public.award_points_for_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.award_points(new.org_id, auth.uid(), 5, 'Started a project: ' || new.name, 'projects', new.id, 'started');
    perform public.check_and_award_badges(new.org_id, auth.uid());
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'complete' then
    perform public.award_points(new.org_id, auth.uid(), 10, 'Finished the project: ' || new.name, 'projects', new.id, 'status:complete');
    perform public.check_and_award_badges(new.org_id, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_projects_points on public.projects;
create trigger trg_projects_points after insert or update on public.projects
  for each row execute function public.award_points_for_project();

-- ----------------------------------------------------------------------------
-- 5. REALTIME, so a badge unlocked (yours or a teammate's) shows up live,
--    no refresh needed. Guarded so this is safe to re-run.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'badges_earned'
  ) then
    alter publication supabase_realtime add table public.badges_earned;
  end if;
end $$;
