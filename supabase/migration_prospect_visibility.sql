-- ============================================================================
-- STUDIO X COMMAND, MIGRATION: Team members only see prospects assigned to them
-- ============================================================================
-- What this does, in plain language:
--   - You (the owner) can still see and manage every prospect, always.
--   - A team member can now ONLY see a prospect once you've assigned it to
--     them, or if they personally added it themselves.
--   - Team members can no longer "grab" an unclaimed prospect from a shared
--     pool, and they can't hand a prospect to a teammate, only you assign.
--   - The team Activity feed and per-prospect Notes now also hide anything
--     tied to a prospect a team member isn't allowed to see (so a name/status
--     can't leak through the feed even though the prospect itself is hidden).
--   - The "This Week, Team" leaderboard on the Dashboard keeps working for
--     everyone, since it only shows counts (sends/replies/meetings/signed),
--     never business names.
--
-- HOW TO RUN THIS (you already ran the main schema.sql once, so just run
-- this smaller file, don't re-paste the whole schema.sql, it will error
-- on things that already exist):
--   1. Open your Supabase project → SQL Editor → New query.
--   2. Paste this ENTIRE file in.
--   3. Click "Run".
-- Nothing in your app or data gets deleted, this only changes who is
-- allowed to see/edit which rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PROSPECTS: visibility + assignment rules
-- ----------------------------------------------------------------------------
drop policy if exists "prospects: read all" on public.prospects;
create policy "prospects: read own or owner" on public.prospects
  for select using (
    public.is_owner()
    or assigned_to = auth.uid()
    or created_by = auth.uid()
  );

drop policy if exists "prospects: insert any team member" on public.prospects;
create policy "prospects: insert self-assign or owner" on public.prospects
  for insert with check (
    auth.role() = 'authenticated'
    and (public.is_owner() or assigned_to is null or assigned_to = auth.uid())
  );

drop policy if exists "prospects: update any team member" on public.prospects;
create policy "prospects: update own or owner" on public.prospects
  for update
  using (public.is_owner() or assigned_to = auth.uid() or created_by = auth.uid())
  with check (public.is_owner() or assigned_to is null or assigned_to = auth.uid());

-- ----------------------------------------------------------------------------
-- Harden the "claim" function so a team member can only self-claim a
-- prospect they personally added, never someone else's or your unassigned
-- pool leads. Assignment to a teammate is owner-only from here on.
-- ----------------------------------------------------------------------------
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
-- ACTIVITY FEED & NOTES: follow the same visibility rule as the prospect
-- they belong to, so a hidden prospect's name/status can't leak through.
-- ----------------------------------------------------------------------------
drop policy if exists "activity_log: read all" on public.activity_log;
create policy "activity_log: read visible prospects" on public.activity_log
  for select using (
    prospect_id is null
    or exists (select 1 from public.prospects p where p.id = activity_log.prospect_id)
  );

drop policy if exists "notes: read all" on public.prospect_notes;
create policy "notes: read visible prospects" on public.prospect_notes
  for select using (
    exists (select 1 from public.prospects p where p.id = prospect_notes.prospect_id)
  );

-- status_history is deliberately left as "read all", the Dashboard's
-- weekly team leaderboard needs it, and it only exposes counts, not
-- business names, so it's not a privacy concern.
