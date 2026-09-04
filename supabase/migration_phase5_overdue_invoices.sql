-- ============================================================================
-- PHASE 5 — Overdue invoice alerts
-- ============================================================================
-- Run this once in the Supabase SQL Editor. Safe to re-run.
--
-- What it does:
--   1. Adds a column to `invoices` so each overdue invoice only ever gets
--      flagged/notified once, not re-checked forever.
--   2. Turns on the pg_cron and pg_net extensions (they ship with every
--      Supabase project, just off by default).
--   3. Schedules a daily job (9:00am UTC) that calls the
--      check-overdue-invoices Edge Function.
--
-- This step depends on that Edge Function already being deployed — see
-- SETUP.md, "Turn on overdue invoice alerts", for the full walkthrough in
-- order (deploy the function first, then run this).
-- ============================================================================

alter table public.invoices add column if not exists overdue_notified_at timestamptz;

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
