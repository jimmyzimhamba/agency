-- ============================================================================
-- STUDIO X COMMAND, Migration: Email Notifications
-- ============================================================================
-- Run this once in the Supabase SQL Editor to add what the new email
-- notifications feature needs. See SETUP.md Step 145.
-- ============================================================================

-- Lets each teammate opt out of email notifications from their own Team
-- screen, separate from (and on by default alongside) pop-up notifications.
alter table public.profiles
  add column if not exists email_notifications_enabled boolean not null default true;
