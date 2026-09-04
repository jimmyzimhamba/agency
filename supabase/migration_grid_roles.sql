-- ============================================================================
-- Agency Command — Grid Plan Review, Part 1: Team Roles
-- ============================================================================
-- Today profiles.role only allows 'owner' or 'agent' — everyone who isn't
-- the owner has identical permissions everywhere in the app. The Client
-- Grid Plan Review feature needs finer-grained roles so an agency can let a
-- designer edit captions/media without letting them send a plan to a client,
-- and let a contributor view plans without editing them at all.
--
-- This migration ONLY widens the allowed role values and adds two helper
-- functions grid-plan RLS policies will call. It does NOT change any
-- existing behavior:
--   - Every existing owner/agent check in the app (main.js, team.js, tasks.js,
--     prospectForm.js, prospectDetail.js, invoices.js, projects.js,
--     contracts.js, dashboard.js, niches.js) only ever tests
--     `role === "owner"` vs. anything else, so it keeps working unchanged.
--   - Existing rows stay 'owner' or 'agent' — nothing is migrated/renamed.
--   - 'agent' is treated as equal to the new 'manager' tier for grid-plan
--     permissions (full edit + send-to-client), since that matches the
--     access an "agent" already has everywhere else in the app today.
--     'designer' and 'contributor' are new, MORE restricted tiers an owner
--     can opt a teammate into from the Team screen once that UI ships.
--
-- Grid-plan permission matrix (enforced here AND re-checked in the
-- review-* Edge Functions, since RLS is the real boundary but the Edge
-- Functions run with the service-role key and must not blindly trust it):
--   owner / manager / agent : create/edit/delete plans, edit posts + media,
--                             reorder, send to client, mark complete
--   designer                : edit posts + media, reorder — CANNOT send to
--                             client, CANNOT create/delete plans
--   contributor             : read-only — can view plans, cannot write
--
-- Safe to re-run.
-- ============================================================================

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner', 'agent', 'manager', 'designer', 'contributor'));

-- "Can this person create/edit/delete grid plans and send them to a client?"
-- owner/manager/agent all qualify — see note above on why 'agent' is
-- included. Security definer for the same reason as is_owner()/my_org_id().
create or replace function public.grid_can_manage()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('owner', 'manager', 'agent')
  );
$$;

-- "Can this person edit post content (captions, media, reorder) but not
-- necessarily send to a client?" Everyone who can manage, plus designers.
create or replace function public.grid_can_edit()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('owner', 'manager', 'agent', 'designer')
  );
$$;

-- ============================================================================
-- DONE. This alone changes nothing visible — it just makes the wider role
-- values legal so the next migration's RLS policies (migration_grid_plans.sql)
-- and the eventual Team-screen role picker can use them.
-- ============================================================================
