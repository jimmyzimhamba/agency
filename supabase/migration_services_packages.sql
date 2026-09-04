-- ============================================================================
-- Agency Command — Services & Packages
-- ============================================================================
-- The agency's own sellable catalog: fixed, named service offerings with a
-- price and a turnaround estimate (e.g. "Starter Social Package — $500/mo,
-- 5 business days"). This is genuinely new ground — Deal Pricing
-- (dealPricing.js) is a market-band *calculator* keyed on a client's segment
-- (small/SME/pro/large), not a catalog of what the agency actually sells;
-- Niches is client-industry categorization. Nothing else in the app
-- overlaps with "here's our fixed menu of packages."
--
-- Same patterns as every other table in this app: org_id + RLS scoped to
-- public.my_org_id(), a stamp_org_id trigger so inserts don't need to pass
-- org_id by hand, touch_updated_at for updated_at.
--
-- Permission model mirrors Niches, not Contracts/Invoices/Projects: the
-- catalog is a small, curated list the whole team reads (to quote clients
-- accurately and consistently) but only the owner curates — same "owner
-- writes, team reads" split as public.niches, since a service catalog is a
-- pricing/positioning decision, not day-to-day delivery work anyone should
-- freely edit.
--
-- PREREQUISITE: migration_organizations.sql must already be applied (this
-- file uses public.my_org_id(), public.is_owner(), public.stamp_org_id(),
-- and public.touch_updated_at(), all defined there).
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- Safe to re-run — every statement is guarded (if not exists / or replace /
-- drop policy if exists).
-- ============================================================================

create table if not exists public.service_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  category text not null default '',
  description text not null default '',
  price numeric(10,2) not null default 0,
  price_type text not null default 'one_time' check (price_type in ('one_time', 'monthly')),
  turnaround_days int,
  active boolean not null default true,
  sort_order int not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_service_packages_org on public.service_packages (org_id);
create index if not exists idx_service_packages_active on public.service_packages (active);

alter table public.service_packages enable row level security;

drop policy if exists "service_packages: read org" on public.service_packages;
create policy "service_packages: read org" on public.service_packages
  for select using (org_id = public.my_org_id());

-- Only the owner curates the catalog — everyone on the team can see it (to
-- quote a client accurately) but adding/renaming/repricing a package is a
-- deliberate business decision, same split as public.niches.
drop policy if exists "service_packages: owner writes" on public.service_packages;
create policy "service_packages: owner writes" on public.service_packages
  for insert with check (org_id = public.my_org_id() and public.is_owner());

drop policy if exists "service_packages: owner updates" on public.service_packages;
create policy "service_packages: owner updates" on public.service_packages
  for update using (org_id = public.my_org_id() and public.is_owner());

drop policy if exists "service_packages: owner deletes" on public.service_packages;
create policy "service_packages: owner deletes" on public.service_packages
  for delete using (org_id = public.my_org_id() and public.is_owner());

drop trigger if exists trg_service_packages_org on public.service_packages;
create trigger trg_service_packages_org before insert on public.service_packages
  for each row execute function public.stamp_org_id();

drop trigger if exists trg_service_packages_touch on public.service_packages;
create trigger trg_service_packages_touch before update on public.service_packages
  for each row execute function public.touch_updated_at();

-- Realtime (live updates across every teammate's screen, same as prospects)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'service_packages'
  ) then
    alter publication supabase_realtime add table public.service_packages;
  end if;
end $$;

-- ============================================================================
-- DONE. After running this in the SQL Editor:
--   1. Redeploy the frontend (app/ folder via Netlify Drop) — sw.js's
--      CACHE_VERSION was bumped so every phone picks up the new view.
--   2. New sidebar link: Services & Packages (under "Business") — visible to
--      everyone, but only the owner can add/edit/delete a package; any team
--      member can browse the catalog when quoting a client.
-- ============================================================================
