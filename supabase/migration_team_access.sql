-- ============================================================================
-- Migration: team access control ("Remove access" for a teammate)
-- ============================================================================
-- Adds a soft on/off switch for team members. The owner can flip a
-- teammate's access off from the Team screen without deleting anything they
-- ever did, their past prospects, notes, and activity history all stay
-- intact and still show their name. The actual login lockout happens in the
-- manage-team-member Edge Function (it bans the auth.users row); this column
-- just mirrors that state for the UI to show "Removed" and to keep them out
-- of new assignment dropdowns.
--
-- Safe to run more than once.
-- ============================================================================

alter table public.profiles
  add column if not exists active boolean not null default true;
