-- ============================================================================
-- STUDIO X COMMAND, MIGRATION: multi-tenant organizations
-- ============================================================================
-- What this does, in plain language:
--   Until now, every row in this database belonged to one single team
--   (Studio X). This migration turns "Agency Command" into something other
--   agencies can sign up and use too, fully walled off from each other:
--
--     1. Adds an `organizations` table, one row per agency.
--     2. Gives every existing table an `org_id` column, and backfills all
--        of Studio X's existing data into one "Studio X Marketing"
--        organization automatically, nothing is lost or reassigned by hand.
--     3. Rewrites every security rule (RLS policy) so a user can only ever
--        see/edit rows that belong to their own organization. An owner at
--        Agency A can never see Agency B's prospects, team, goals, etc.
--     4. Changes sign-up: a new user now either (a) creates a brand-new
--        agency and becomes its owner, or (b) joins an existing agency using
--        an invite code its owner shares with them. See the matching
--        frontend changes in app/js/auth.js and app/index.html.
--
-- This is safe to run on your existing live database, it does not delete
-- or move any of your current prospects, notes, activity, templates, etc.
-- Everything you already have becomes "Studio X Marketing" org data.
--
-- HOW TO RUN: Supabase dashboard → SQL Editor → New query → paste this
-- whole file → Run. Then also redeploy the manage-team-member Edge
-- Function (its code changed too, in this same update) and deploy the new
-- frontend via Netlify Drop as usual.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ORGANIZATIONS  (one row per agency using the app)
-- ----------------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Agency',
  -- Shared with teammates so they can join this exact organization at
  -- sign-up instead of accidentally creating a brand-new one.
  invite_code text not null unique default lower(substr(md5(gen_random_uuid()::text), 1, 8)),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;

-- ----------------------------------------------------------------------------
-- 2. BACKFILL  every existing table gets an org_id column, and every
--    existing row (all of it Studio X's data today) is assigned to one
--    "Studio X Marketing" organization created right here, once.
-- ----------------------------------------------------------------------------
do $$
declare
  default_org_id uuid;
begin
  if not exists (select 1 from public.organizations) then
    insert into public.organizations (name) values ('Studio X Marketing')
    returning id into default_org_id;
  else
    select id into default_org_id from public.organizations order by created_at asc limit 1;
  end if;

  alter table public.profiles add column if not exists org_id uuid references public.organizations (id) on delete cascade;
  update public.profiles set org_id = default_org_id where org_id is null;

  alter table public.niches add column if not exists org_id uuid references public.organizations (id) on delete cascade;
  update public.niches set org_id = default_org_id where org_id is null;

  alter table public.prospects add column if not exists org_id uuid references public.organizations (id) on delete cascade;
  update public.prospects set org_id = default_org_id where org_id is null;

  alter table public.status_history add column if not exists org_id uuid references public.organizations (id) on delete cascade;
  update public.status_history set org_id = default_org_id where org_id is null;

  alter table public.activity_log add column if not exists org_id uuid references public.organizations (id) on delete cascade;
  update public.activity_log set org_id = default_org_id where org_id is null;

  alter table public.message_templates add column if not exists org_id uuid references public.organizations (id) on delete cascade;
  update public.message_templates set org_id = default_org_id where org_id is null;

  alter table public.daily_tasks add column if not exists org_id uuid references public.organizations (id) on delete cascade;
  update public.daily_tasks set org_id = default_org_id where org_id is null;

  alter table public.daily_task_completions add column if not exists org_id uuid references public.organizations (id) on delete cascade;
  update public.daily_task_completions set org_id = default_org_id where org_id is null;

  alter table public.agent_targets add column if not exists org_id uuid references public.organizations (id) on delete cascade;
  update public.agent_targets set org_id = default_org_id where org_id is null;

  alter table public.monthly_goal add column if not exists org_id uuid references public.organizations (id) on delete cascade;
  update public.monthly_goal set org_id = default_org_id where org_id is null;

  -- research_requests is an invisible internal rate-limit log (see schema.sql)
  -- with no client-facing read policy either way, so it stays nullable,   -- not worth tightening today.
  alter table public.research_requests add column if not exists org_id uuid references public.organizations (id) on delete set null;
  update public.research_requests set org_id = default_org_id where org_id is null;
end $$;

-- Now that every row has a home, make org_id mandatory going forward.
alter table public.profiles alter column org_id set not null;
alter table public.niches alter column org_id set not null;
alter table public.prospects alter column org_id set not null;
alter table public.status_history alter column org_id set not null;
alter table public.activity_log alter column org_id set not null;
alter table public.message_templates alter column org_id set not null;
alter table public.daily_tasks alter column org_id set not null;
alter table public.daily_task_completions alter column org_id set not null;
alter table public.agent_targets alter column org_id set not null;
alter table public.monthly_goal alter column org_id set not null;

create index if not exists idx_profiles_org on public.profiles (org_id);
create index if not exists idx_niches_org on public.niches (org_id);
create index if not exists idx_prospects_org on public.prospects (org_id);
create index if not exists idx_status_history_org on public.status_history (org_id);
create index if not exists idx_activity_log_org on public.activity_log (org_id);
create index if not exists idx_message_templates_org on public.message_templates (org_id);
create index if not exists idx_daily_tasks_org on public.daily_tasks (org_id);
create index if not exists idx_daily_task_completions_org on public.daily_task_completions (org_id);
create index if not exists idx_agent_targets_org on public.agent_targets (org_id);
create index if not exists idx_monthly_goal_org on public.monthly_goal (org_id);

-- monthly_goal used to be "one row per calendar month, period." Now it's one
-- row per calendar month PER AGENCY, so the uniqueness has to include org_id
-- or two different agencies could never both set a goal for the same month.
alter table public.monthly_goal drop constraint if exists monthly_goal_month_key;
alter table public.monthly_goal add constraint monthly_goal_org_month_key unique (org_id, month);

-- ----------------------------------------------------------------------------
-- 3. HELPER  "what organization does the currently logged-in person belong
--    to?", security definer so it can read profiles without recursing
--    through the RLS policy that itself calls this function.
-- ----------------------------------------------------------------------------
create or replace function public.my_org_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select org_id from public.profiles where id = auth.uid();
$$;

-- Owner-only: rotates an agency's invite code (e.g. if it leaked, or an
-- old teammate who left still has it memorized). Returns the new code so
-- the Team screen can show/copy it immediately.
create or replace function public.regenerate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can regenerate the invite code';
  end if;
  new_code := lower(substr(md5(gen_random_uuid()::text), 1, 8));
  update public.organizations set invite_code = new_code where id = public.my_org_id();
  return new_code;
end;
$$;

-- Auto-stamps org_id on insert for any table that has the column, so the
-- app's existing insert calls (which don't know about organizations at all)
-- don't all need to be rewritten, the database fills it in from whoever's
-- actually logged in.
create or replace function public.stamp_org_id()
returns trigger
language plpgsql
as $$
begin
  if new.org_id is null then
    new.org_id := public.my_org_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_niches_org on public.niches;
create trigger trg_niches_org before insert on public.niches
  for each row execute function public.stamp_org_id();

drop trigger if exists trg_prospects_org on public.prospects;
create trigger trg_prospects_org before insert on public.prospects
  for each row execute function public.stamp_org_id();

drop trigger if exists trg_message_templates_org on public.message_templates;
create trigger trg_message_templates_org before insert on public.message_templates
  for each row execute function public.stamp_org_id();

drop trigger if exists trg_daily_tasks_org on public.daily_tasks;
create trigger trg_daily_tasks_org before insert on public.daily_tasks
  for each row execute function public.stamp_org_id();

drop trigger if exists trg_daily_task_completions_org on public.daily_task_completions;
create trigger trg_daily_task_completions_org before insert on public.daily_task_completions
  for each row execute function public.stamp_org_id();

drop trigger if exists trg_agent_targets_org on public.agent_targets;
create trigger trg_agent_targets_org before insert on public.agent_targets
  for each row execute function public.stamp_org_id();

drop trigger if exists trg_monthly_goal_org on public.monthly_goal;
create trigger trg_monthly_goal_org before insert on public.monthly_goal
  for each row execute function public.stamp_org_id();

-- ----------------------------------------------------------------------------
-- 4. ORGANIZATIONS  RLS, you can only see/edit your own agency's row.
-- ----------------------------------------------------------------------------
drop policy if exists "organizations: read own org" on public.organizations;
create policy "organizations: read own org" on public.organizations
  for select using (id = public.my_org_id());

drop policy if exists "organizations: owner updates" on public.organizations;
create policy "organizations: owner updates" on public.organizations
  for update using (id = public.my_org_id() and public.is_owner())
  with check (id = public.my_org_id() and public.is_owner());
-- No insert/delete policy for ordinary clients, new organizations are only
-- ever created by the handle_new_user trigger below (runs as security
-- definer, bypasses RLS).

-- ----------------------------------------------------------------------------
-- 5. PROFILES  RLS, add the organization boundary on top of the existing
--    rules (see schema.sql for the original policies these replace).
-- ----------------------------------------------------------------------------
drop policy if exists "profiles: read all" on public.profiles;
drop policy if exists "profiles: read org" on public.profiles;
create policy "profiles: read org" on public.profiles
  for select using (org_id = public.my_org_id());

drop policy if exists "profiles: update own or owner" on public.profiles;
create policy "profiles: update own or owner" on public.profiles
  for update
  using (org_id = public.my_org_id() and (id = auth.uid() or public.is_owner()))
  with check (org_id = public.my_org_id() and (id = auth.uid() or public.is_owner()));

-- ----------------------------------------------------------------------------
-- 6. NICHES  RLS
-- ----------------------------------------------------------------------------
drop policy if exists "niches: read all" on public.niches;
drop policy if exists "niches: read org" on public.niches;
create policy "niches: read org" on public.niches
  for select using (org_id = public.my_org_id());

drop policy if exists "niches: owner writes" on public.niches;
create policy "niches: owner writes" on public.niches
  for insert with check (org_id = public.my_org_id() and public.is_owner());

drop policy if exists "niches: owner updates" on public.niches;
create policy "niches: owner updates" on public.niches
  for update using (org_id = public.my_org_id() and public.is_owner());

drop policy if exists "niches: owner deletes" on public.niches;
create policy "niches: owner deletes" on public.niches
  for delete using (org_id = public.my_org_id() and public.is_owner());

-- ----------------------------------------------------------------------------
-- 7. PROSPECTS  RLS + claim_prospect()
-- ----------------------------------------------------------------------------
drop policy if exists "prospects: read all" on public.prospects;
drop policy if exists "prospects: read own or owner" on public.prospects;
create policy "prospects: read own or owner" on public.prospects
  for select using (
    org_id = public.my_org_id()
    and (public.is_owner() or assigned_to = auth.uid() or created_by = auth.uid())
  );

drop policy if exists "prospects: insert any team member" on public.prospects;
drop policy if exists "prospects: insert self-assign or owner" on public.prospects;
create policy "prospects: insert self-assign or owner" on public.prospects
  for insert with check (
    auth.role() = 'authenticated'
    and org_id = public.my_org_id()
    and (public.is_owner() or assigned_to is null or assigned_to = auth.uid())
  );

drop policy if exists "prospects: update any team member" on public.prospects;
drop policy if exists "prospects: update own or owner" on public.prospects;
create policy "prospects: update own or owner" on public.prospects
  for update
  using (org_id = public.my_org_id() and (public.is_owner() or assigned_to = auth.uid() or created_by = auth.uid()))
  with check (org_id = public.my_org_id() and (public.is_owner() or assigned_to is null or assigned_to = auth.uid()));

drop policy if exists "prospects: owner deletes" on public.prospects;
create policy "prospects: owner deletes" on public.prospects
  for delete using (org_id = public.my_org_id() and public.is_owner());

-- claim_prospect() runs as security definer (bypasses RLS on purpose, so the
-- "never worked twice" race-condition check is atomic), which means it has
-- to enforce the organization boundary itself in the WHERE clause, or an
-- agent could theoretically pass another agency's prospect id straight
-- through to it.
create or replace function public.claim_prospect(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_rows int;
begin
  update public.prospects
  set assigned_to = auth.uid()
  where id = p_id
    and org_id = public.my_org_id()
    and (
      public.is_owner()
      or assigned_to = auth.uid()
      or (assigned_to is null and created_by = auth.uid())
    );
  get diagnostics updated_rows = row_count;
  return updated_rows > 0;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. STATUS HISTORY + ACTIVITY LOG  RLS, and the trigger that writes them
--    (log_prospect_changes) now stamps org_id straight from the prospect
--    row being changed, since it writes as security definer.
-- ----------------------------------------------------------------------------
drop policy if exists "status_history: read all" on public.status_history;
drop policy if exists "status_history: read org" on public.status_history;
create policy "status_history: read org" on public.status_history
  for select using (org_id = public.my_org_id());

drop policy if exists "activity_log: read all" on public.activity_log;
drop policy if exists "activity_log: read visible prospects" on public.activity_log;
create policy "activity_log: read visible prospects" on public.activity_log
  for select using (
    org_id = public.my_org_id()
    and (
      prospect_id is null
      or exists (select 1 from public.prospects p where p.id = activity_log.prospect_id)
    )
  );

create or replace function public.log_prospect_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
begin
  select coalesce(full_name, email) into actor_name from public.profiles where id = auth.uid();
  actor_name := coalesce(actor_name, 'Someone');

  if tg_op = 'INSERT' then
    insert into public.activity_log (actor_id, prospect_id, message, org_id)
    values (auth.uid(), new.id, actor_name || ' added ' || new.business_name || ' to the pipeline', new.org_id);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.status_history (prospect_id, old_status, new_status, changed_by, org_id)
      values (new.id, old.status, new.status, auth.uid(), new.org_id);

      insert into public.activity_log (actor_id, prospect_id, message, org_id)
      values (auth.uid(), new.id, actor_name || ' marked ' || new.business_name || ' as ' ||
        replace(initcap(replace(new.status, '_', ' ')), ' ', ' '), new.org_id);
    end if;

    if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
      insert into public.activity_log (actor_id, prospect_id, message, org_id)
      values (auth.uid(), new.id, actor_name || ' took ' || new.business_name, new.org_id);
    end if;

    return new;
  end if;

  return new;
end;
$$;

-- log_new_note() also writes to activity_log as security definer, same
-- treatment, org_id copied from the prospect the note belongs to.
create or replace function public.log_new_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  biz text;
  prospect_org_id uuid;
begin
  select coalesce(full_name, email) into actor_name from public.profiles where id = new.author_id;
  select business_name, org_id into biz, prospect_org_id from public.prospects where id = new.prospect_id;
  insert into public.activity_log (actor_id, prospect_id, message, org_id)
  values (new.author_id, new.prospect_id, coalesce(actor_name, 'Someone') || ' left a note on ' || coalesce(biz, 'a prospect'), prospect_org_id);
  return new;
end;
$$;

-- prospect_notes itself doesn't need an org_id column or policy change, -- its existing "notes: read visible prospects" policy already checks
-- `exists (select 1 from prospects p where p.id = prospect_notes.prospect_id)`,
-- and that subquery runs through prospects' own (now org-scoped) RLS, so
-- visibility is already correctly restricted to your organization.

-- ----------------------------------------------------------------------------
-- 9. MESSAGE TEMPLATES  RLS
-- ----------------------------------------------------------------------------
drop policy if exists "templates: read all" on public.message_templates;
drop policy if exists "templates: read org" on public.message_templates;
create policy "templates: read org" on public.message_templates
  for select using (org_id = public.my_org_id());

drop policy if exists "templates: team writes" on public.message_templates;
create policy "templates: team writes" on public.message_templates
  for insert with check (auth.role() = 'authenticated' and org_id = public.my_org_id());

drop policy if exists "templates: team updates" on public.message_templates;
create policy "templates: team updates" on public.message_templates
  for update using (org_id = public.my_org_id());

drop policy if exists "templates: owner deletes" on public.message_templates;
create policy "templates: owner deletes" on public.message_templates
  for delete using (org_id = public.my_org_id() and public.is_owner());

-- ----------------------------------------------------------------------------
-- 10. DAILY TASKS + COMPLETIONS + AGENT TARGETS  RLS
-- ----------------------------------------------------------------------------
drop policy if exists "daily_tasks: read all" on public.daily_tasks;
drop policy if exists "daily_tasks: read org" on public.daily_tasks;
create policy "daily_tasks: read org" on public.daily_tasks
  for select using (org_id = public.my_org_id());

drop policy if exists "daily_tasks: owner writes" on public.daily_tasks;
create policy "daily_tasks: owner writes" on public.daily_tasks
  for insert with check (org_id = public.my_org_id() and public.is_owner());

drop policy if exists "daily_tasks: owner updates" on public.daily_tasks;
create policy "daily_tasks: owner updates" on public.daily_tasks
  for update using (org_id = public.my_org_id() and public.is_owner());

drop policy if exists "daily_tasks: owner deletes" on public.daily_tasks;
create policy "daily_tasks: owner deletes" on public.daily_tasks
  for delete using (org_id = public.my_org_id() and public.is_owner());

drop policy if exists "completions: read all" on public.daily_task_completions;
drop policy if exists "completions: read org" on public.daily_task_completions;
create policy "completions: read org" on public.daily_task_completions
  for select using (org_id = public.my_org_id());

drop policy if exists "completions: upsert own" on public.daily_task_completions;
create policy "completions: upsert own" on public.daily_task_completions
  for insert with check (agent_id = auth.uid() and org_id = public.my_org_id());

drop policy if exists "completions: update own" on public.daily_task_completions;
create policy "completions: update own" on public.daily_task_completions
  for update using (agent_id = auth.uid() and org_id = public.my_org_id());

drop policy if exists "targets: read all" on public.agent_targets;
drop policy if exists "targets: read org" on public.agent_targets;
create policy "targets: read org" on public.agent_targets
  for select using (org_id = public.my_org_id());

drop policy if exists "targets: owner writes" on public.agent_targets;
create policy "targets: owner writes" on public.agent_targets
  for insert with check (org_id = public.my_org_id() and public.is_owner());

drop policy if exists "targets: owner updates" on public.agent_targets;
create policy "targets: owner updates" on public.agent_targets
  for update using (org_id = public.my_org_id() and public.is_owner());

-- ----------------------------------------------------------------------------
-- 11. MONTHLY GOAL  RLS
-- ----------------------------------------------------------------------------
drop policy if exists "goal: read all" on public.monthly_goal;
drop policy if exists "goal: read org" on public.monthly_goal;
create policy "goal: read org" on public.monthly_goal
  for select using (org_id = public.my_org_id());

drop policy if exists "goal: owner writes" on public.monthly_goal;
create policy "goal: owner writes" on public.monthly_goal
  for insert with check (org_id = public.my_org_id() and public.is_owner());

drop policy if exists "goal: owner updates" on public.monthly_goal;
create policy "goal: owner updates" on public.monthly_goal
  for update using (org_id = public.my_org_id() and public.is_owner());

-- ----------------------------------------------------------------------------
-- 12. SIGN-UP  a new user either starts a brand-new agency (becomes its
--     owner) or joins an existing one via an invite code its owner shared
--     with them. See app/js/auth.js for the matching frontend UI that
--     collects agency_mode / agency_name / invite_code at sign-up.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_agency_name text;
  v_invite_code text;
  v_org_id uuid;
  v_role text;
begin
  v_mode := lower(coalesce(new.raw_user_meta_data ->> 'agency_mode', 'join'));
  v_agency_name := new.raw_user_meta_data ->> 'agency_name';
  v_invite_code := lower(trim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')));

  if v_mode = 'create' then
    insert into public.organizations (name, created_by)
    values (coalesce(nullif(trim(v_agency_name), ''), 'My Agency'), new.id)
    returning id into v_org_id;
    v_role := 'owner';
  else
    if v_invite_code = '' then
      raise exception 'An invite code is required to join an existing agency';
    end if;
    select id into v_org_id from public.organizations where invite_code = v_invite_code;
    if v_org_id is null then
      raise exception 'That invite code doesn''t match any agency';
    end if;
    v_role := 'agent';
  end if;

  insert into public.profiles (id, full_name, email, role, org_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    v_role,
    v_org_id
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ============================================================================
-- DONE. Next steps:
--   1. Re-deploy the manage-team-member Edge Function, its code now also
--      checks that the person being removed/restored belongs to the same
--      organization as the owner calling it.
--   2. Deploy the updated app/ folder (Netlify Drop, as usual).
--   3. Everyone currently on your team keeps working exactly as before, --      they're all in "Studio X Marketing" now. Any brand-new sign-up from
--      here on picks "Create a new agency" or "Join with an invite code".
--   4. Studio X's own invite code is visible on the Team & Settings screen
--      (owner view), share that with any new teammate who should join
--      YOUR agency, so they don't accidentally create their own.
-- ============================================================================
