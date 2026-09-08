-- ============================================================================
-- STUDIO X COMMAND, MIGRATION: Push (pop-up) notifications
-- ============================================================================
-- What this does, in plain language:
--   - Adds a table to store each phone/browser's "push subscription", the
--     address the browser gives us so we can send it a notification even
--     when Agency Command isn't open on screen.
--   - A teammate turns this on themselves from the Team screen (nothing is
--     sent to anyone who hasn't opted in). Each person only ever sees/
--     controls their own subscriptions.
--   - Two things trigger a pop-up once this is on:
--       1. A teammate adds a new prospect -> every owner gets pinged.
--       2. The owner assigns a prospect to a teammate -> that teammate
--          gets pinged.
--   - The actual sending happens in the `send-push` Edge Function (deploy
--     that separately, see SETUP.md) using a private key that never
--     touches the app or this table.
--
-- HOW TO RUN THIS:
--   1. Open your Supabase project -> SQL Editor -> New query.
--   2. Paste this ENTIRE file in.
--   3. Click "Run".
-- Safe to run even if you've already run it before.
-- ============================================================================

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

drop policy if exists "push_subscriptions: read own" on public.push_subscriptions;
create policy "push_subscriptions: read own" on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists "push_subscriptions: insert own" on public.push_subscriptions;
create policy "push_subscriptions: insert own" on public.push_subscriptions
  for insert with check (user_id = auth.uid());

drop policy if exists "push_subscriptions: update own" on public.push_subscriptions;
create policy "push_subscriptions: update own" on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "push_subscriptions: delete own" on public.push_subscriptions;
create policy "push_subscriptions: delete own" on public.push_subscriptions
  for delete using (user_id = auth.uid());
