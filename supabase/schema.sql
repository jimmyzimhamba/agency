-- ============================================================================
-- STUDIO X COMMAND, DATABASE SCHEMA  (multi-tenant baseline)
-- ============================================================================
-- What this file does, in plain language:
-- It builds every "filing cabinet" (table) the app needs, and it sets up
-- security rules so that:
--   - The app can host any number of agencies ("organizations") on one
--     shared database, each one completely walled off from the others, --     an owner at Agency A can never see Agency B's prospects, team,
--     templates, or goals.
--   - Only people invited into YOUR organization (by invite code, or via
--     sign-up under it) can log in and see anything belonging to it.
--   - Everyone on a team can see their own agency's shared prospect list live.
--   - Only the OWNER of an organization can add/remove niches, delete
--     prospects, set targets, or manage the invite code for that org.
--   - Two agents can never "claim" (start working) the same prospect at once.
--
-- IMPORTANT, if you already have a live Studio X Command database:
-- Do NOT re-run this whole file against it. Use
-- supabase/migration_organizations.sql instead, it upgrades an existing
-- single-tenant database in place without touching any of your real data.
-- This file (schema.sql) is for standing up a brand-new, empty database
-- from scratch (e.g. local dev, a disaster-recovery copy, or a completely
-- separate deployment), it is NOT how new agencies join the live product.
-- New agencies join by signing up at the existing app URL and choosing
-- "New agency" or "Join a team", see app/js/auth.js.
--
-- HOW TO USE THIS FILE (fresh database only):
--   1. Open your Supabase project.
--   2. Click "SQL Editor" in the left sidebar.
--   3. Click "New query".
--   4. Paste this ENTIRE file in.
--   5. Click "Run".
-- That's it, every table, rule, function, and starter data (niches,
-- message templates, daily tasks, all seeded into one starter organization)
-- gets created at once. See SETUP.md Step 6 for how to join that starter
-- organization as its Owner.
-- ============================================================================

-- Needed for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. ORGANIZATIONS  (one row per agency using the app, the multi-tenant
--    boundary everything else below is scoped to)
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

-- One starter organization so this file has somewhere to seed the starter
-- niches/templates/tasks below (section 12). Safe to re-run, only inserts
-- if no organization exists yet at all.
insert into public.organizations (name)
select 'Studio X Marketing'
where not exists (select 1 from public.organizations);

-- ----------------------------------------------------------------------------
-- 2. PROFILES  (one row per team member, linked to their login and to the
--    one organization they belong to)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null default '',
  email text not null,
  role text not null default 'agent' check (role in ('owner', 'agent')),
  color text not null default '#7b2ff7',
  -- Public URL of an uploaded profile picture (storage bucket "avatars",
  -- see Section 12b below). Null = app falls back to the colored-initials
  -- circle it's always drawn from full_name/email.
  avatar_url text,
  -- Owner can revoke a teammate's access without deleting their history
  -- (past prospects/notes/activity stay intact). See the manage-team-member
  -- Edge Function, it also bans the underlying auth.users login when this
  -- flips to false, so a removed teammate is actually locked out, not just
  -- hidden in the UI.
  active boolean not null default true,
  -- Lets each teammate opt out of email notifications from their own Team
  -- screen, separate from (and on by default alongside) pop-up notifications.
  email_notifications_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_org on public.profiles (org_id);

alter table public.profiles enable row level security;

-- Helper function: "is the currently logged-in person the owner?"
-- security definer = runs with full access so it can safely check the
-- profiles table without getting stuck in a permissions loop.
create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'owner'
  );
$$;

-- Helper function: "what organization does the currently logged-in person
-- belong to?", security definer for the same reason as is_owner() above.
-- Every other org-scoped policy/function in this file calls this.
create or replace function public.my_org_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select org_id from public.profiles where id = auth.uid();
$$;

-- Generic trigger: auto-fills org_id on insert from whoever's logged in, so
-- the app's existing insert calls (written long before organizations
-- existed) don't all need to be rewritten to pass org_id by hand. Attached
-- to every org-scoped table below.
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

-- Everyone in an organization can see everyone else's name/role in that
-- same organization (so we can show "assigned to").
create policy "profiles: read org" on public.profiles
  for select using (org_id = public.my_org_id());

-- You can update your own display name/color. Owner can update anyone in
-- their own org (e.g. to promote/demote roles).
create policy "profiles: update own or owner" on public.profiles
  for update
  using (org_id = public.my_org_id() and (id = auth.uid() or public.is_owner()))
  with check (org_id = public.my_org_id() and (id = auth.uid() or public.is_owner()));

-- New profile rows are created automatically by the trigger below, not by
-- hand, this policy is just a backstop.
create policy "profiles: insert self" on public.profiles
  for insert with check (id = auth.uid());

-- Organizations: you can only see your own; only the owner can rename it.
-- No insert/delete policy for ordinary clients, new organizations are only
-- ever created by the handle_new_user trigger below (runs as security
-- definer, bypasses RLS).
create policy "organizations: read own org" on public.organizations
  for select using (id = public.my_org_id());

create policy "organizations: owner updates" on public.organizations
  for update using (id = public.my_org_id() and public.is_owner())
  with check (id = public.my_org_id() and public.is_owner());

-- Owner-only: rotates an agency's invite code (e.g. if it leaked, or an old
-- teammate who left still has it memorized). Returns the new code so the
-- Team screen can show/copy it immediately.
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

-- When someone signs up through Supabase Auth, this decides which
-- organization they land in:
--   - agency_mode = 'create' → brand-new organization, they become its owner.
--   - agency_mode = 'join'   → looked up by the invite code they entered,
--                              they join as a regular agent.
-- See app/js/auth.js / app/index.html for the sign-up screen that collects
-- agency_mode / agency_name / invite_code and passes them through here via
-- Supabase Auth's raw_user_meta_data.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 3. NICHES  (the strategy matrix, owner-editable, team-visible)
-- ----------------------------------------------------------------------------
create table if not exists public.niches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  lead_value smallint not null default 3 check (lead_value between 1 and 5),
  close_speed smallint not null default 3 check (close_speed between 1 and 5),
  stickiness smallint not null default 3 check (stickiness between 1 and 5),
  marketing_gap smallint not null default 3 check (marketing_gap between 1 and 5),
  fit smallint not null default 3 check (fit between 1 and 5),
  notes text not null default '',
  sort_order int not null default 0,
  -- Optional override for what Discovery types into Google Maps for this
  -- niche (e.g. "gym" instead of "Fitness & Gyms"). Blank = use `name`.
  search_query text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists idx_niches_org on public.niches (org_id);

alter table public.niches enable row level security;

create policy "niches: read org" on public.niches
  for select using (org_id = public.my_org_id());

create policy "niches: owner writes" on public.niches
  for insert with check (org_id = public.my_org_id() and public.is_owner());
create policy "niches: owner updates" on public.niches
  for update using (org_id = public.my_org_id() and public.is_owner());
create policy "niches: owner deletes" on public.niches
  for delete using (org_id = public.my_org_id() and public.is_owner());

create trigger trg_niches_org before insert on public.niches
  for each row execute function public.stamp_org_id();

-- ----------------------------------------------------------------------------
-- 4. PROSPECTS  (the heart of the app)
-- ----------------------------------------------------------------------------
create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  business_name text not null,
  niche_id uuid references public.niches (id) on delete set null,
  city text not null default 'Harare',
  area text not null default '',
  whatsapp_number text not null default '',
  email text not null default '',
  instagram text not null default '',
  website text not null default '',
  rating numeric(2,1),
  gap_note text not null default '',
  outreach_message text not null default '',
  -- AI research fields: what the auto-research backend function found, where
  -- the current outreach message came from, and when it last ran. See
  -- supabase/functions/research-prospect for how these get filled in.
  research_summary text not null default '',
  research_status text not null default 'pending'
    check (research_status in ('pending', 'researching', 'done', 'failed')),
  message_source text not null default 'manual'
    check (message_source in ('manual', 'ai_generated', 'auto_template')),
  researched_at timestamptz,
  -- Which Google Maps listing this prospect came from, if it was added via
  -- Discovery. Lets Discovery grey out businesses already in the pipeline.
  google_place_id text,
  tier text not null default 'B' check (tier in ('A', 'B', 'C')),
  heat_score smallint not null default 50 check (heat_score between 0 and 100),
  liora_conflict boolean not null default false,
  status text not null default 'not_contacted'
    check (status in ('not_contacted', 'sent', 'replied', 'meeting_booked', 'signed', 'dead')),
  mrr numeric(10,2) not null default 0,
  assigned_to uuid references public.profiles (id) on delete set null,
  follow_up_date date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- When this prospect last messaged us on WhatsApp. WhatsApp only lets a
  -- business send free-form replies within 24 hours of the customer's last
  -- message, see "7a. WHATSAPP MESSAGES" below for how this gates the
  -- in-app reply thread.
  whatsapp_last_inbound_at timestamptz
);

create index if not exists idx_prospects_org on public.prospects (org_id);
create index if not exists idx_prospects_status on public.prospects (status);
create index if not exists idx_prospects_assigned on public.prospects (assigned_to);
create index if not exists idx_prospects_niche on public.prospects (niche_id);
create index if not exists idx_prospects_followup on public.prospects (follow_up_date);
create index if not exists idx_prospects_city on public.prospects (city);

-- Stops the same Google listing being added twice within one organization,
-- and doubles as the lookup Discovery uses to grey out "already in your
-- pipeline" results. Prospects added by hand (no google_place_id) are
-- untouched, the "where" clause only applies the rule once a place id
-- exists.
create unique index if not exists idx_prospects_org_place
  on public.prospects (org_id, google_place_id)
  where google_place_id is not null;

alter table public.prospects enable row level security;

-- Owner sees every prospect in their org. A team member only sees a
-- prospect once the owner has assigned it to them, or if they personally
-- added it (so they don't lose sight of a lead they just found before it's
-- formally assigned).
create policy "prospects: read own or owner" on public.prospects
  for select using (
    org_id = public.my_org_id()
    and (public.is_owner() or assigned_to = auth.uid() or created_by = auth.uid())
  );

-- Anyone can add a new prospect, but a non-owner can only leave it
-- unassigned or assign it to themselves, never straight to a teammate.
-- Only the owner decides who else works a lead.
create policy "prospects: insert self-assign or owner" on public.prospects
  for insert with check (
    auth.role() = 'authenticated'
    and org_id = public.my_org_id()
    and (public.is_owner() or assigned_to is null or assigned_to = auth.uid())
  );

-- A team member can only edit prospects they can already see (their own
-- assigned/added leads). They can release a prospect back to the owner's
-- pool (assigned_to = null) but can't hand it to another teammate directly, -- only the owner can reassign to someone else.
create policy "prospects: update own or owner" on public.prospects
  for update
  using (org_id = public.my_org_id() and (public.is_owner() or assigned_to = auth.uid() or created_by = auth.uid()))
  with check (org_id = public.my_org_id() and (public.is_owner() or assigned_to is null or assigned_to = auth.uid()));

create policy "prospects: owner deletes" on public.prospects
  for delete using (org_id = public.my_org_id() and public.is_owner());

create trigger trg_prospects_org before insert on public.prospects
  for each row execute function public.stamp_org_id();

-- Keep updated_at fresh automatically.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_prospects_touch
  before update on public.prospects
  for each row execute function public.touch_updated_at();

-- THE "NEVER WORKED TWICE" SAFETY CHECK
-- Call this instead of a plain update when an agent taps "Send WhatsApp" /
-- claims a fresh prospect. It only succeeds if nobody has claimed it yet
-- (or the same person is re-opening their own prospect). If someone else
-- got there first, it returns false and the app tells the agent to pick
-- another prospect, so two people can never work the same lead. This
-- function is security definer (bypasses RLS, so the check is atomic), so
-- it has to enforce the organization boundary itself in the WHERE clause.
create or replace function public.claim_prospect(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_rows int;
begin
  -- Owner can claim/assign anything in their org. A team member can only
  -- claim a prospect that's already theirs (no-op) or one they personally
  -- added and that's still unassigned, never someone else's or the
  -- owner's unassigned pool leads. This keeps assignment owner-controlled.
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
-- 5. STATUS HISTORY  (auto timestamped trail of every status change)
-- ----------------------------------------------------------------------------
create table if not exists public.status_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists idx_status_history_org on public.status_history (org_id);

alter table public.status_history enable row level security;
create policy "status_history: read org" on public.status_history
  for select using (org_id = public.my_org_id());
-- No direct insert policy for clients, only the trigger (below) can write here.

-- ----------------------------------------------------------------------------
-- 5a. RESEARCH REQUESTS  (invisible rate-limit log for AI auto-research)
-- ----------------------------------------------------------------------------
-- One row per research run. Not shown anywhere in the app, the
-- research-prospect backend function reads this to make sure one teammate
-- adding a burst of prospects can't accidentally rack up API costs or trip
-- Anthropic's own rate limits. org_id here is nullable and unenforced by
-- RLS on purpose (see note below), not worth tightening.
create table if not exists public.research_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete cascade,
  prospect_id uuid references public.prospects (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_research_requests_by_user on public.research_requests (requested_by, created_at);

alter table public.research_requests enable row level security;
-- No select/insert policies for ordinary clients on purpose, only the
-- research-prospect function (using the secure service-role key, which
-- bypasses RLS) ever touches this table. Same pattern as status_history above.

-- ----------------------------------------------------------------------------
-- 5b. DISCOVERY REQUESTS  (invisible rate-limit log for Google Places search)
-- ----------------------------------------------------------------------------
-- Same pattern as research_requests above: one row per search, never shown
-- in the app, read only by the discover-places backend function (via the
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
-- No select/insert policies for ordinary clients on purpose, only the
-- discover-places function ever touches this table.

-- ----------------------------------------------------------------------------
-- 5c. COPILOT REQUESTS  (invisible rate-limit log for the AI chat assistant)
-- ----------------------------------------------------------------------------
-- Same pattern as research_requests / discovery_requests above: one row per
-- chat message sent to Claude, never shown in the app, read only by the
-- copilot-chat backend function (via the service-role key, which bypasses
-- RLS) to cap how many messages one teammate can send per hour.
create table if not exists public.copilot_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_copilot_requests_by_user on public.copilot_requests (requested_by, created_at);

alter table public.copilot_requests enable row level security;
-- No select/insert policies for ordinary clients on purpose, only the
-- copilot-chat function ever touches this table.

-- ----------------------------------------------------------------------------
-- 6. ACTIVITY LOG  (powers the live "Team activity feed")
-- ----------------------------------------------------------------------------
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  prospect_id uuid references public.prospects (id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_log_org on public.activity_log (org_id);

alter table public.activity_log enable row level security;
-- The feed names the actual business in its message text ("Alice marked
-- WestProp as Replied"), so it has to follow the same visibility rule as
-- the prospects table itself, otherwise it would leak names/status of
-- prospects a team member isn't assigned to, on top of the organization
-- boundary. A row with no prospect_id (general messages) stays visible to
-- everyone in the org.
create policy "activity_log: read visible prospects" on public.activity_log
  for select using (
    org_id = public.my_org_id()
    and (
      prospect_id is null
      or exists (select 1 from public.prospects p where p.id = activity_log.prospect_id)
    )
  );
-- No direct insert policy for clients, only triggers write here.

-- Trigger: whenever a prospect's status or assignment changes, log it. Runs
-- as security definer (writes to tables clients can't insert into
-- directly), so it stamps org_id straight from the prospect row itself.
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

create trigger trg_prospects_log
  after insert or update on public.prospects
  for each row execute function public.log_prospect_changes();

-- ----------------------------------------------------------------------------
-- 7. PROSPECT NOTES  (activity/notes thread per prospect)
-- ----------------------------------------------------------------------------
create table if not exists public.prospect_notes (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.prospect_notes enable row level security;

-- Notes are about a specific prospect, so only show them to people who can
-- see that prospect (owner, or the team member it's assigned to/added).
-- No org_id column or explicit org check needed here, this subquery runs
-- through prospects' own (already org-scoped) RLS, so visibility is
-- already correctly restricted to your organization.
create policy "notes: read visible prospects" on public.prospect_notes
  for select using (
    exists (select 1 from public.prospects p where p.id = prospect_notes.prospect_id)
  );
create policy "notes: insert own" on public.prospect_notes
  for insert with check (author_id = auth.uid());
create policy "notes: delete own or owner" on public.prospect_notes
  for delete using (author_id = auth.uid() or public.is_owner());

-- Log new notes into the activity feed too. Also security definer, so it
-- looks up the org_id via the prospect the note belongs to.
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

create trigger trg_notes_log
  after insert on public.prospect_notes
  for each row execute function public.log_new_note();

-- ----------------------------------------------------------------------------
-- 7a. WHATSAPP MESSAGES  (two-way conversation thread per prospect, via
-- Twilio, see supabase/functions/send-whatsapp and whatsapp-webhook)
-- ----------------------------------------------------------------------------
-- One row per WhatsApp message, in either direction. Outbound rows are
-- created by the send-whatsapp function right after Twilio accepts the
-- message; inbound rows (and delivery-status updates to outbound rows) are
-- created/updated by the whatsapp-webhook function whenever Twilio calls it.
-- Client apps never insert into this table directly, only those two
-- backend functions do, using the service-role key.
create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  body text not null default '',
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  twilio_sid text,
  -- Who sent it from inside the app. Null for inbound messages (the
  -- prospect sent those) and null for outbound ones sent before this
  -- column existed.
  sent_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_messages_prospect on public.whatsapp_messages (prospect_id, created_at);

-- Lets the webhook look up "which message is this a delivery-status update
-- for" by Twilio's own message id, and stops the same inbound webhook call
-- (Twilio sometimes retries) from being recorded twice.
create unique index if not exists idx_whatsapp_messages_twilio_sid
  on public.whatsapp_messages (twilio_sid)
  where twilio_sid is not null;

alter table public.whatsapp_messages enable row level security;

-- A conversation thread is about a specific prospect, so only show it to
-- people who can see that prospect (owner, or the team member it's
-- assigned to/added), same subquery-through-prospects'-own-RLS trick as
-- prospect_notes above.
create policy "whatsapp_messages: read visible prospects" on public.whatsapp_messages
  for select using (
    exists (select 1 from public.prospects p where p.id = whatsapp_messages.prospect_id)
  );
-- No insert/update/delete policy for ordinary clients on purpose, a plain
-- client-side insert wouldn't actually send anything via Twilio, it'd just
-- create a fake-looking message. Only send-whatsapp (outbound) and
-- whatsapp-webhook (inbound + delivery status) ever write to this table.

-- ----------------------------------------------------------------------------
-- 7b. WHATSAPP SEND REQUESTS  (invisible rate-limit log, same pattern as
-- research_requests / discovery_requests / copilot_requests above)
-- ----------------------------------------------------------------------------
create table if not exists public.whatsapp_send_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_send_requests_by_user on public.whatsapp_send_requests (requested_by, created_at);

alter table public.whatsapp_send_requests enable row level security;
-- No select/insert policies for ordinary clients on purpose, only the
-- send-whatsapp function ever touches this table.

-- ----------------------------------------------------------------------------
-- 8. MESSAGE TEMPLATES  (message kit, team can edit)
-- ----------------------------------------------------------------------------
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  category text not null default 'opener' check (category in ('opener', 'follow_up', 'objection', 'close')),
  body text not null default '',
  -- Which niche this template is written for. Null = "General", shown/used
  -- for every niche. Lets the app auto-pick a niche-specific opener for a
  -- prospect instead of a one-size-fits-all message.
  niche_id uuid references public.niches (id) on delete set null,
  sort_order int not null default 0,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_templates_org on public.message_templates (org_id);
create index if not exists idx_templates_niche on public.message_templates (niche_id);

alter table public.message_templates enable row level security;
create policy "templates: read org" on public.message_templates
  for select using (org_id = public.my_org_id());
create policy "templates: team writes" on public.message_templates
  for insert with check (auth.role() = 'authenticated' and org_id = public.my_org_id());
create policy "templates: team updates" on public.message_templates
  for update using (org_id = public.my_org_id());
create policy "templates: owner deletes" on public.message_templates
  for delete using (org_id = public.my_org_id() and public.is_owner());

create trigger trg_templates_org before insert on public.message_templates
  for each row execute function public.stamp_org_id();

create trigger trg_templates_touch
  before update on public.message_templates
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 9. DAILY TASKS  (shared outreach-rhythm checklist, owner-editable, --    optionally assigned to one specific agent instead of everyone)
-- ----------------------------------------------------------------------------
create table if not exists public.daily_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  day_type text not null default 'general' check (day_type in ('send', 'reply', 'follow_up', 'deposit', 'general')),
  sort_order int not null default 0,
  active boolean not null default true,
  assigned_to uuid references public.profiles (id) on delete cascade
);
create index if not exists idx_daily_tasks_org on public.daily_tasks (org_id);
create index if not exists idx_daily_tasks_assigned_to on public.daily_tasks (assigned_to);

alter table public.daily_tasks enable row level security;
create policy "daily_tasks: read org" on public.daily_tasks
  for select using (org_id = public.my_org_id());
create policy "daily_tasks: owner writes" on public.daily_tasks
  for insert with check (org_id = public.my_org_id() and public.is_owner());
create policy "daily_tasks: owner updates" on public.daily_tasks
  for update using (org_id = public.my_org_id() and public.is_owner());
create policy "daily_tasks: owner deletes" on public.daily_tasks
  for delete using (org_id = public.my_org_id() and public.is_owner());

create trigger trg_daily_tasks_org before insert on public.daily_tasks
  for each row execute function public.stamp_org_id();

-- Per-agent, per-day tick-off.
create table if not exists public.daily_task_completions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.daily_tasks (id) on delete cascade,
  agent_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null default current_date,
  completed boolean not null default false,
  completed_at timestamptz,
  unique (task_id, agent_id, work_date)
);
create index if not exists idx_daily_task_completions_org on public.daily_task_completions (org_id);

alter table public.daily_task_completions enable row level security;
create policy "completions: read org" on public.daily_task_completions
  for select using (org_id = public.my_org_id());
create policy "completions: upsert own" on public.daily_task_completions
  for insert with check (agent_id = auth.uid() and org_id = public.my_org_id());
create policy "completions: update own" on public.daily_task_completions
  for update using (agent_id = auth.uid() and org_id = public.my_org_id());

create trigger trg_daily_task_completions_org before insert on public.daily_task_completions
  for each row execute function public.stamp_org_id();

-- Per-agent daily targets, set by the owner.
create table if not exists public.agent_targets (
  agent_id uuid primary key references public.profiles (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  daily_sends_target int not null default 15,
  weekly_meetings_target int not null default 3
);
create index if not exists idx_agent_targets_org on public.agent_targets (org_id);

alter table public.agent_targets enable row level security;
create policy "targets: read org" on public.agent_targets
  for select using (org_id = public.my_org_id());
create policy "targets: owner writes" on public.agent_targets
  for insert with check (org_id = public.my_org_id() and public.is_owner());
create policy "targets: owner updates" on public.agent_targets
  for update using (org_id = public.my_org_id() and public.is_owner());

create trigger trg_agent_targets_org before insert on public.agent_targets
  for each row execute function public.stamp_org_id();

-- ----------------------------------------------------------------------------
-- 10. MONTHLY REVENUE GOAL  (for the dashboard goal tracker)
-- ----------------------------------------------------------------------------
create table if not exists public.monthly_goal (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  month date not null,
  target_mrr numeric(10,2) not null default 0,
  set_by uuid references public.profiles (id) on delete set null,
  constraint monthly_goal_org_month_key unique (org_id, month)
);
create index if not exists idx_monthly_goal_org on public.monthly_goal (org_id);

alter table public.monthly_goal enable row level security;
create policy "goal: read org" on public.monthly_goal
  for select using (org_id = public.my_org_id());
create policy "goal: owner writes" on public.monthly_goal
  for insert with check (org_id = public.my_org_id() and public.is_owner());
create policy "goal: owner updates" on public.monthly_goal
  for update using (org_id = public.my_org_id() and public.is_owner());

create trigger trg_monthly_goal_org before insert on public.monthly_goal
  for each row execute function public.stamp_org_id();

-- ----------------------------------------------------------------------------
-- 11. PUSH SUBSCRIPTIONS  (pop-up/push notifications, opted in per teammate)
-- ----------------------------------------------------------------------------
-- No org_id column needed, every policy here is already scoped to a
-- specific user_id, which transitively belongs to exactly one organization.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy "push_subscriptions: read own" on public.push_subscriptions
  for select using (user_id = auth.uid());
create policy "push_subscriptions: insert own" on public.push_subscriptions
  for insert with check (user_id = auth.uid());
create policy "push_subscriptions: update own" on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "push_subscriptions: delete own" on public.push_subscriptions
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 12. CONTRACTS, INVOICES, PROJECTS  (post-signing business ops, see
--     supabase/migration_phase3_business_ops.sql for the same tables written
--     as a standalone, idempotent migration for the live database; this
--     section mirrors it for brand-new/empty databases.)
-- ----------------------------------------------------------------------------
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  prospect_id uuid references public.prospects (id) on delete set null,
  title text not null,
  value numeric(10,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'sent', 'signed', 'void')),
  sent_date date,
  signed_date date,
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contracts_org on public.contracts (org_id);
create index if not exists idx_contracts_prospect on public.contracts (prospect_id);
create index if not exists idx_contracts_status on public.contracts (status);

alter table public.contracts enable row level security;
create policy "contracts: read org" on public.contracts
  for select using (org_id = public.my_org_id());
create policy "contracts: insert self" on public.contracts
  for insert with check (auth.role() = 'authenticated' and org_id = public.my_org_id());
create policy "contracts: update own or owner" on public.contracts
  for update
  using (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()))
  with check (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()));
create policy "contracts: owner deletes" on public.contracts
  for delete using (org_id = public.my_org_id() and public.is_owner());

create trigger trg_contracts_org before insert on public.contracts
  for each row execute function public.stamp_org_id();
create trigger trg_contracts_touch before update on public.contracts
  for each row execute function public.touch_updated_at();

create or replace function public.log_contract_changes()
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
    values (auth.uid(), new.prospect_id, actor_name || ' drafted a contract: ' || new.title, new.org_id);
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.activity_log (actor_id, prospect_id, message, org_id)
    values (auth.uid(), new.prospect_id, actor_name || ' marked the contract "' || new.title || '" as ' || initcap(new.status), new.org_id);
  end if;

  return new;
end;
$$;

create trigger trg_contracts_activity after insert or update on public.contracts
  for each row execute function public.log_contract_changes();

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  prospect_id uuid references public.prospects (id) on delete set null,
  contract_id uuid references public.contracts (id) on delete set null,
  invoice_number text not null default '',
  amount numeric(10,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  due_date date,
  paid_date date,
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  overdue_notified_at timestamptz, -- set once check-overdue-invoices pings someone about this one (Section 13b)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_invoices_org on public.invoices (org_id);
create index if not exists idx_invoices_prospect on public.invoices (prospect_id);
create index if not exists idx_invoices_contract on public.invoices (contract_id);
create index if not exists idx_invoices_status on public.invoices (status);

alter table public.invoices enable row level security;
create policy "invoices: read org" on public.invoices
  for select using (org_id = public.my_org_id());
create policy "invoices: insert self" on public.invoices
  for insert with check (auth.role() = 'authenticated' and org_id = public.my_org_id());
create policy "invoices: update own or owner" on public.invoices
  for update
  using (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()))
  with check (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()));
create policy "invoices: owner deletes" on public.invoices
  for delete using (org_id = public.my_org_id() and public.is_owner());

create trigger trg_invoices_org before insert on public.invoices
  for each row execute function public.stamp_org_id();
create trigger trg_invoices_touch before update on public.invoices
  for each row execute function public.touch_updated_at();

create or replace function public.log_invoice_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  label text;
begin
  select coalesce(full_name, email) into actor_name from public.profiles where id = auth.uid();
  actor_name := coalesce(actor_name, 'Someone');
  label := nullif(new.invoice_number, '');
  label := coalesce(label, 'an invoice');

  if tg_op = 'INSERT' then
    insert into public.activity_log (actor_id, prospect_id, message, org_id)
    values (auth.uid(), new.prospect_id, actor_name || ' created ' || label, new.org_id);
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.activity_log (actor_id, prospect_id, message, org_id)
    values (auth.uid(), new.prospect_id, actor_name || ' marked ' || label || ' as ' || initcap(new.status), new.org_id);
  end if;

  return new;
end;
$$;

create trigger trg_invoices_activity after insert or update on public.invoices
  for each row execute function public.log_invoice_changes();

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  prospect_id uuid references public.prospects (id) on delete set null,
  name text not null,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'blocked', 'complete')),
  start_date date,
  due_date date,
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_org on public.projects (org_id);
create index if not exists idx_projects_prospect on public.projects (prospect_id);
create index if not exists idx_projects_status on public.projects (status);

alter table public.projects enable row level security;
create policy "projects: read org" on public.projects
  for select using (org_id = public.my_org_id());
create policy "projects: insert self" on public.projects
  for insert with check (auth.role() = 'authenticated' and org_id = public.my_org_id());
create policy "projects: update own or owner" on public.projects
  for update
  using (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()))
  with check (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()));
create policy "projects: owner deletes" on public.projects
  for delete using (org_id = public.my_org_id() and public.is_owner());

create trigger trg_projects_org before insert on public.projects
  for each row execute function public.stamp_org_id();
create trigger trg_projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

create or replace function public.log_project_changes()
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
    values (auth.uid(), new.prospect_id, actor_name || ' started a project: ' || new.name, new.org_id);
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.activity_log (actor_id, prospect_id, message, org_id)
    values (auth.uid(), new.prospect_id, actor_name || ' marked the project "' || new.name || '" as ' || replace(initcap(replace(new.status, '_', ' ')), ' ', ' '), new.org_id);
  end if;

  return new;
end;
$$;

create trigger trg_projects_activity after insert or update on public.projects
  for each row execute function public.log_project_changes();

create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  done boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_tasks_org on public.project_tasks (org_id);
create index if not exists idx_project_tasks_project on public.project_tasks (project_id);

alter table public.project_tasks enable row level security;
create policy "project_tasks: read org" on public.project_tasks
  for select using (org_id = public.my_org_id());
create policy "project_tasks: insert org" on public.project_tasks
  for insert with check (
    auth.role() = 'authenticated'
    and org_id = public.my_org_id()
    and exists (select 1 from public.projects pr where pr.id = project_tasks.project_id and pr.org_id = public.my_org_id())
  );
create policy "project_tasks: update org" on public.project_tasks
  for update using (org_id = public.my_org_id());
create policy "project_tasks: delete own or owner" on public.project_tasks
  for delete using (org_id = public.my_org_id());

create trigger trg_project_tasks_org before insert on public.project_tasks
  for each row execute function public.stamp_org_id();

-- ----------------------------------------------------------------------------
-- 13. PROFILE PICTURES  (storage bucket, see
--     supabase/migration_phase4_avatars.sql for the same bucket/policies
--     written as a standalone, idempotent migration for the live database;
--     this section mirrors it for brand-new/empty databases.)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars: public read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars: upload own" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "avatars: update own" on storage.objects
  for update using (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "avatars: delete own" on storage.objects
  for delete using (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ----------------------------------------------------------------------------
-- 14. REALTIME  (so changes appear live on every phone without refreshing)
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table public.prospects;
alter publication supabase_realtime add table public.activity_log;
alter publication supabase_realtime add table public.prospect_notes;
alter publication supabase_realtime add table public.daily_task_completions;
alter publication supabase_realtime add table public.contracts;
alter publication supabase_realtime add table public.invoices;
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.project_tasks;
alter publication supabase_realtime add table public.whatsapp_messages;

-- ----------------------------------------------------------------------------
-- 15. STARTER DATA  (Harare niche matrix + message kit + task board),
--     seeded into the one starter organization created in section 1 above.
--     You can edit/add to all of this later from inside the app, and any
--     other organization that signs up afterwards starts with a clean
--     slate and builds its own niches/templates/tasks from scratch.
-- ----------------------------------------------------------------------------
do $$
declare
  starter_org_id uuid;
begin
  select id into starter_org_id from public.organizations order by created_at asc limit 1;

  insert into public.niches (org_id, name, lead_value, close_speed, stickiness, marketing_gap, fit, notes, sort_order)
  select starter_org_id, v.name, v.lead_value, v.close_speed, v.stickiness, v.marketing_gap, v.fit, v.notes, v.sort_order
  from (values
    ('Real Estate Agencies', 5, 3, 4, 4, 5, 'High-value listings need constant visual content; agents switch agencies rarely once happy.', 1),
    ('Car Dealerships', 5, 4, 3, 5, 4, 'Big-ticket sales, huge appetite for lead-gen ads, but shop around on price.', 2),
    ('Professional Services (law, accounting, consulting)', 4, 2, 5, 3, 4, 'Slow to decide but very sticky once signed; trust-based content works well.', 3),
    ('Solar Installers', 5, 4, 4, 5, 5, 'Booming Harare demand, most have zero real content strategy yet.', 4),
    ('Hotels & Lodges', 4, 3, 4, 3, 4, 'Visual-heavy niche, seasonal but reliable retainer once trust is built.', 5),
    ('Events & Wedding Vendors', 3, 4, 2, 4, 3, 'Fast close, exciting content, but seasonal and can churn after peak season.', 6),
    ('Restaurants & Cafes', 3, 4, 2, 4, 3, 'Easy to start, fun content, but tight budgets and higher churn.', 7),
    ('Fashion & Boutiques', 3, 3, 2, 4, 3, 'Loves social content but budgets are inconsistent.', 8),
    ('Fitness & Gyms', 3, 3, 3, 4, 4, 'Community-driven content performs well; moderate stickiness.', 9),
    ('Private Healthcare & Clinics', 5, 2, 5, 5, 5, 'Slow sales cycle but extremely sticky and high trust value once signed.', 10)
  ) as v(name, lead_value, close_speed, stickiness, marketing_gap, fit, notes, sort_order)
  where not exists (select 1 from public.niches n where n.org_id = starter_org_id and n.name = v.name);

  insert into public.message_templates (org_id, title, category, body, sort_order)
  select starter_org_id, v.title, v.category, v.body, v.sort_order
  from (values
    ('Cold Opener', 'opener', 'Hi [Name], I came across [Business] and noticed [specific observation]. We help Harare businesses like yours turn social media into a steady stream of customers, would you be open to a quick chat this week?', 1),
    ('Follow-up 1 (no reply)', 'follow_up', 'Hi [Name], just floating this back up in case it got buried! We put together a couple of quick ideas for [Business]''s Instagram, happy to share, no pressure either way.', 2),
    ('Follow-up 2 (gone quiet)', 'follow_up', 'Hey [Name], totally understand things get busy. If now''s not the right time that''s completely fine, just let me know and I''ll check back in a month or two.', 3),
    ('Objection: "We already post ourselves"', 'objection', 'Totally get that, a lot of our clients did too before we started. The difference is usually consistency and strategy behind each post, not just posting. Want to see a quick before/after example from a similar business?', 4),
    ('Objection: "It''s too expensive"', 'objection', 'I hear you. Think of it less as a cost and more as what one new client is worth to you, most of our retainers pay for themselves with a single signed deal. Want me to break down exactly what''s included?', 5),
    ('The Close', 'close', 'Great, here''s what happens next: I''ll send the agreement and a deposit invoice today, and we can have your first content batch live within [X] days. Sound good?', 6)
  ) as v(title, category, body, sort_order)
  where not exists (select 1 from public.message_templates mt where mt.org_id = starter_org_id and mt.title = v.title);

  -- Niche-specific opener templates. These use {{business_name}}, {{area_clause}},
  -- {{gap_clause}}, and {{agent_name}} tokens that the app fills in automatically
  -- per prospect (see personalizeMessage() in app/js/utils.js), unlike the
  -- generic templates above, which use manual [Name]/[Business] placeholders
  -- for copy-paste. The app picks the matching niche template automatically
  -- when an agent sends a first WhatsApp message and no message has been
  -- written yet; guarded with NOT EXISTS so re-running this file is safe.
  insert into public.message_templates (org_id, title, category, body, niche_id, sort_order)
  select starter_org_id, v.title, 'opener', v.body, n.id, v.sort_order
  from (values
    ('Real Estate Opener', E'Hi! I came across {{business_name}}{{area_clause}} while looking at real estate agencies around Harare, {{gap_clause}}. I work with agencies on getting more listing enquiries through social media and WhatsApp marketing. Worth a quick chat?\n\n{{agent_name}}, Studio X Marketing', 'Real Estate Agencies', 10),
    ('Car Dealership Opener', E'Hi! I spotted {{business_name}}{{area_clause}} while looking at car dealerships in Harare, {{gap_clause}}. We help dealerships turn browsers into buyers with better social content and ads. Open to a quick chat?\n\n{{agent_name}}, Studio X Marketing', 'Car Dealerships', 11),
    ('Professional Services Opener', E'Hi! I came across {{business_name}}{{area_clause}}, {{gap_clause}}. We help professional firms build trust online and bring in more client enquiries through content and a stronger digital presence. Would you be open to a short chat?\n\n{{agent_name}}, Studio X Marketing', 'Professional Services (law, accounting, consulting)', 12),
    ('Solar Installer Opener', E'Hi! I noticed {{business_name}}{{area_clause}}, {{gap_clause}}. With load-shedding, demand for solar is huge right now, and we help installers like you capture more of those enquiries online. Quick chat?\n\n{{agent_name}}, Studio X Marketing', 'Solar Installers', 13),
    ('Hotels & Lodges Opener', E'Hi! I came across {{business_name}}{{area_clause}}, {{gap_clause}}. We help hotels and lodges fill more rooms through better social media and booking-focused marketing. Open to a quick chat about it?\n\n{{agent_name}}, Studio X Marketing', 'Hotels & Lodges', 14),
    ('Events & Wedding Opener', E'Hi! I spotted {{business_name}}{{area_clause}}, {{gap_clause}}. Wedding season enquiries move fast on Instagram and WhatsApp, and we help vendors like you stay visible and book more events. Worth a quick chat?\n\n{{agent_name}}, Studio X Marketing', 'Events & Wedding Vendors', 15),
    ('Restaurants & Cafes Opener', E'Hi! I came across {{business_name}}{{area_clause}}, {{gap_clause}}. We help restaurants and cafes get more foot traffic through consistent, mouth-watering social content. Open to a quick chat?\n\n{{agent_name}}, Studio X Marketing', 'Restaurants & Cafes', 16),
    ('Fashion & Boutiques Opener', E'Hi! I spotted {{business_name}}{{area_clause}}, {{gap_clause}}. We help boutiques turn their catalogue into consistent sales through social media and WhatsApp marketing. Quick chat sometime this week?\n\n{{agent_name}}, Studio X Marketing', 'Fashion & Boutiques', 17),
    ('Fitness & Gyms Opener', E'Hi! I came across {{business_name}}{{area_clause}}, {{gap_clause}}. We help gyms and fitness studios fill more classes and memberships through better online marketing. Open to a quick chat?\n\n{{agent_name}}, Studio X Marketing', 'Fitness & Gyms', 18),
    ('Healthcare & Clinics Opener', E'Hi! I noticed {{business_name}}{{area_clause}}, {{gap_clause}}. We help clinics build trust and bring in more patient enquiries through a stronger, more professional online presence. Would you be open to a quick chat?\n\n{{agent_name}}, Studio X Marketing', 'Private Healthcare & Clinics', 19)
  ) as v(title, body, niche_name, sort_order)
  join public.niches n on n.name = v.niche_name and n.org_id = starter_org_id
  where not exists (select 1 from public.message_templates mt where mt.org_id = starter_org_id and mt.title = v.title);

  -- One niche-agnostic fallback opener, for the rare prospect with no niche set.
  insert into public.message_templates (org_id, title, category, body, niche_id, sort_order)
  select starter_org_id, 'General Opener', 'opener', E'Hi! I came across {{business_name}}{{area_clause}}, {{gap_clause}}. We help local Harare businesses grow through social media and WhatsApp marketing. Would you be open to a quick chat?\n\n{{agent_name}}, Studio X Marketing', null, 20
  where not exists (select 1 from public.message_templates where org_id = starter_org_id and title = 'General Opener');

  insert into public.daily_tasks (org_id, title, day_type, sort_order)
  select starter_org_id, v.title, v.day_type, v.sort_order
  from (values
    ('Send new outreach messages', 'send', 1),
    ('Reply to everyone who responded yesterday', 'reply', 2),
    ('Follow up on prospects due today', 'follow_up', 3),
    ('Chase deposits from signed clients', 'deposit', 4),
    ('Log notes on any calls/replies', 'general', 5)
  ) as v(title, day_type, sort_order)
  where not exists (select 1 from public.daily_tasks dt where dt.org_id = starter_org_id and dt.title = v.title);
end $$;

-- ----------------------------------------------------------------------------
-- 16. OVERDUE INVOICE ALERTS  (daily scheduled check via pg_cron + pg_net, --     see the check-overdue-invoices Edge Function, and SETUP.md "Turn on
--     overdue invoice alerts" for how to deploy it and fill in the
--     x-cron-secret value below.)
-- ----------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'check-overdue-invoices-daily') then
    perform cron.unschedule('check-overdue-invoices-daily');
  end if;
end $$;

select cron.schedule(
  'check-overdue-invoices-daily',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'https://hzjadsomvosoolxtnskj.supabase.co/functions/v1/check-overdue-invoices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_jQYkXfZ0aaj03MGkf6Bk9A_yqDztzsJ',
      'Authorization', 'Bearer sb_publishable_jQYkXfZ0aaj03MGkf6Bk9A_yqDztzsJ',
      'x-cron-secret', 'PASTE_YOUR_CRON_SECRET_HERE'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================================
-- DONE. Next: run this whole file once in the Supabase SQL Editor.
-- Then go to Authentication settings and turn OFF "Confirm email" if you
-- want your team to log in immediately without checking their inbox first
-- (see SETUP.md for exact steps), and see SETUP.md Step 6 for how the
-- first person joins the starter organization this file just seeded and
-- promotes themselves to Owner.
-- ============================================================================
