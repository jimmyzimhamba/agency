-- ============================================================================
-- Agency Command, Portfolio Studio
-- ============================================================================
-- A public-facing "our best work" showcase, case studies of past client
-- projects (title, niche, a short summary, results, an image, an optional
-- external link) that the agency can share with a prospect as a plain link,
-- with zero login required on the other end.
--
-- This is a DIFFERENT security model from Grid Plan Review (review.html):
-- that page shares one specific client's private content-calendar behind a
-- random unguessable share_token, validated server-side by an Edge Function,
-- because the content is private to that one client. A portfolio is the
-- opposite, it's marketing material the agency WANTS publicly visible, so
-- there's no token to guess/leak and no Edge Function needed. Anonymous read
-- access is granted directly via RLS, scoped to exactly two things:
--   1. only rows the owner explicitly marked "published" ever become visible
--   2. only for orgs that have explicitly turned their portfolio "public"
-- Nothing else about the organization (its other data, its team, its
-- pipeline) is exposed by these policies, every other table's RLS is
-- untouched.
--
-- Two tables:
--   1. portfolio_settings, one row per org: headline/tagline copy + the
--      "is_public" on/off switch for the whole showcase page.
--   2. portfolio_items, the actual case studies.
-- Plus a public Storage bucket ("portfolio-media") for case-study images,
-- same pattern as the existing "avatars" bucket (migration_phase4_avatars.sql).
--
-- Permission model mirrors Niches/Services & Packages: everyone on the team
-- can see the full internal catalog (published or not) to review what's
-- being shown off, but only the owner curates it (write/update/delete), -- portfolio content is a marketing/positioning decision, not day-to-day
-- delivery work.
--
-- PREREQUISITE: migration_organizations.sql must already be applied (this
-- file uses public.my_org_id(), public.is_owner(), public.stamp_org_id(),
-- and public.touch_updated_at(), all defined there).
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- Safe to re-run, every statement is guarded (if not exists / or replace /
-- drop policy if exists).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PORTFOLIO SETTINGS  (one row per org, headline copy + the public switch)
-- ----------------------------------------------------------------------------
create table if not exists public.portfolio_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.organizations (id) on delete cascade,
  headline text not null default 'Our Work',
  tagline text not null default '',
  is_public boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_portfolio_settings_org on public.portfolio_settings (org_id);

alter table public.portfolio_settings enable row level security;

drop policy if exists "portfolio_settings: read own org" on public.portfolio_settings;
create policy "portfolio_settings: read own org" on public.portfolio_settings
  for select using (org_id = public.my_org_id());

-- Anonymous visitors (the public portfolio page) can only ever read a
-- settings row that's explicitly been switched public, flipping this back
-- off immediately hides the whole showcase again.
drop policy if exists "portfolio_settings: public read when published" on public.portfolio_settings;
create policy "portfolio_settings: public read when published" on public.portfolio_settings
  for select using (is_public = true);

drop policy if exists "portfolio_settings: owner writes" on public.portfolio_settings;
create policy "portfolio_settings: owner writes" on public.portfolio_settings
  for insert with check (org_id = public.my_org_id() and public.is_owner());

drop policy if exists "portfolio_settings: owner updates" on public.portfolio_settings;
create policy "portfolio_settings: owner updates" on public.portfolio_settings
  for update using (org_id = public.my_org_id() and public.is_owner());

drop trigger if exists trg_portfolio_settings_org on public.portfolio_settings;
create trigger trg_portfolio_settings_org before insert on public.portfolio_settings
  for each row execute function public.stamp_org_id();

drop trigger if exists trg_portfolio_settings_touch on public.portfolio_settings;
create trigger trg_portfolio_settings_touch before update on public.portfolio_settings
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. PORTFOLIO ITEMS  (the case studies)
-- ----------------------------------------------------------------------------
create table if not exists public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  category text not null default '',
  client_name text not null default '',
  summary text not null default '',
  results text not null default '',
  image_url text,
  external_link text not null default '',
  is_published boolean not null default false,
  sort_order int not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_portfolio_items_org on public.portfolio_items (org_id);
create index if not exists idx_portfolio_items_published on public.portfolio_items (is_published);

alter table public.portfolio_items enable row level security;

drop policy if exists "portfolio_items: read own org" on public.portfolio_items;
create policy "portfolio_items: read own org" on public.portfolio_items
  for select using (org_id = public.my_org_id());

-- Anonymous visitors only ever see the individual items marked published, -- the owner can build/edit a case study privately for as long as they like
-- before it ever becomes visible on the public page. Combined with the
-- org-level is_public switch above (checked client-side by the public page
-- before it queries this table at all), a case study is only ever visible
-- when BOTH the org has gone public AND that specific item is published.
drop policy if exists "portfolio_items: public read published" on public.portfolio_items;
create policy "portfolio_items: public read published" on public.portfolio_items
  for select using (is_published = true);

drop policy if exists "portfolio_items: owner writes" on public.portfolio_items;
create policy "portfolio_items: owner writes" on public.portfolio_items
  for insert with check (org_id = public.my_org_id() and public.is_owner());

drop policy if exists "portfolio_items: owner updates" on public.portfolio_items;
create policy "portfolio_items: owner updates" on public.portfolio_items
  for update using (org_id = public.my_org_id() and public.is_owner());

drop policy if exists "portfolio_items: owner deletes" on public.portfolio_items;
create policy "portfolio_items: owner deletes" on public.portfolio_items
  for delete using (org_id = public.my_org_id() and public.is_owner());

drop trigger if exists trg_portfolio_items_org on public.portfolio_items;
create trigger trg_portfolio_items_org before insert on public.portfolio_items
  for each row execute function public.stamp_org_id();

drop trigger if exists trg_portfolio_items_touch on public.portfolio_items;
create trigger trg_portfolio_items_touch before update on public.portfolio_items
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. STORAGE  (case-study images, public bucket, same pattern as "avatars")
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('portfolio-media', 'portfolio-media', true)
on conflict (id) do nothing;

-- Anyone (including logged-out visitors viewing the public page) can view
-- portfolio images, this is what lets <img src="..."> tags on the public
-- page load without an auth header.
drop policy if exists "portfolio-media: public read" on storage.objects;
create policy "portfolio-media: public read" on storage.objects
  for select using (bucket_id = 'portfolio-media');

-- Only the owner can upload/replace/delete, matches the owner-only write
-- policies on portfolio_items above.
drop policy if exists "portfolio-media: owner upload" on storage.objects;
create policy "portfolio-media: owner upload" on storage.objects
  for insert with check (bucket_id = 'portfolio-media' and public.is_owner());

drop policy if exists "portfolio-media: owner update" on storage.objects;
create policy "portfolio-media: owner update" on storage.objects
  for update using (bucket_id = 'portfolio-media' and public.is_owner());

drop policy if exists "portfolio-media: owner delete" on storage.objects;
create policy "portfolio-media: owner delete" on storage.objects
  for delete using (bucket_id = 'portfolio-media' and public.is_owner());

-- ----------------------------------------------------------------------------
-- 4. REALTIME  (live updates on the internal Portfolio Studio tab only, the
--    public showcase page is a simple load-on-visit page, no live sync)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'portfolio_items'
  ) then
    alter publication supabase_realtime add table public.portfolio_items;
  end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'portfolio_settings'
  ) then
    alter publication supabase_realtime add table public.portfolio_settings;
  end if;
end $$;

-- ============================================================================
-- DONE. After running this in the SQL Editor:
--   1. Redeploy the frontend (app/ folder via Netlify Drop), sw.js's
--      CACHE_VERSION was bumped so every phone picks up the new tab, and a
--      new standalone page (portfolio.html) ships alongside index.html.
--   2. New sidebar link: Portfolio Studio (under "Business"), visible to
--      everyone, but only the owner can add/edit/delete a case study or
--      toggle the showcase public. Once public, the link is
--      portfolio.html?org=<your org id> (shown/copyable right on the tab).
-- ============================================================================
