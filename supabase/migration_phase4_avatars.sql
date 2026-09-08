-- ============================================================================
-- Agency Command, Phase 4: Profile Pictures
-- ============================================================================
-- Adds a real "edit profile" flow: change your display name and upload a
-- profile picture. Two parts:
--   1. profiles.avatar_url, a plain text column holding the public URL of
--      the uploaded image (or null, in which case the app keeps showing the
--      colored-initials circle it already draws today).
--   2. A public Supabase Storage bucket named "avatars" with RLS policies so
--      everyone can view avatars, but you can only upload/replace/delete
--      your own (enforced by requiring the file to live in a folder named
--      after your own user id, e.g. "<your-user-id>/avatar.jpg").
--
-- PREREQUISITE: migration_organizations.sql must already be applied.
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. profiles.avatar_url
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists avatar_url text;

-- ----------------------------------------------------------------------------
-- 2. Storage bucket + policies
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Anyone (including logged-out visitors, since profile photos aren't
-- sensitive) can view avatar images, this is what lets <img src="..."> tags
-- load instantly without an auth header.
drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read" on storage.objects
  for select using (bucket_id = 'avatars');

-- You can only upload/replace/delete a file that lives inside a folder named
-- after your own auth.uid(), e.g. path "3f9c.../avatar.jpg". This is the
-- standard Supabase avatar-bucket pattern: storage.foldername(name) splits
-- the object path into an array of folder segments, and [1] is the first one.
drop policy if exists "avatars: upload own" on storage.objects;
create policy "avatars: upload own" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "avatars: update own" on storage.objects;
create policy "avatars: update own" on storage.objects
  for update using (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "avatars: delete own" on storage.objects;
create policy "avatars: delete own" on storage.objects
  for delete using (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================================
-- DONE. After running this in the SQL Editor:
--   1. Redeploy the frontend (app/ folder via Netlify Drop), sw.js's
--      CACHE_VERSION was bumped so every phone picks up the new Team page.
--   2. Open the app → Team → tap your avatar → pick a photo → it uploads and
--      shows immediately, everywhere your avatar appears.
-- ============================================================================
