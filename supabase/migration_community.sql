-- ============================================================================
-- STUDIO X COMMAND — Community Feed
-- ============================================================================
-- Third in the Biblo-inspired series (after Services & Packages, Portfolio
-- Studio). An internal, team-only social feed — wins, shout-outs, quick
-- updates, announcements — separate from the auto-generated Activity Feed
-- (which logs system events like "created a contract") and from Messages
-- (which is a template library, not a conversation).
--
-- Three tables:
--   community_posts     — the posts themselves, optionally with one image
--   community_comments  — threaded replies on a post
--   community_reactions — a simple one-per-person "like" toggle per post
--
-- PERMISSION MODEL — deliberately different from Niches/Services/Portfolio:
-- this is "team writes", not "owner writes, team reads". A community feed
-- where only the owner can post isn't a community — everyone on the team
-- should be able to share a win or an update. Matches the existing
-- Contracts/Invoices/Projects convention instead:
--   - Posts:     anyone inserts; creator-or-owner edits; OWNER ONLY deletes
--                (keeps moderation in one place, discourages rage-deletes —
--                same reasoning as contracts/invoices/projects)
--   - Comments:  anyone inserts; creator-or-owner edits OR deletes (a
--                comment is more like a chat message than a business
--                record — you should be able to remove your own typo/reply
--                immediately without waiting on the owner)
--   - Reactions: a simple insert-to-like / delete-to-unlike toggle, and you
--                can only ever touch your own reaction row (no liking on
--                someone else's behalf, no owner override needed since
--                there's nothing to moderate in a like)
--
-- New posts get one Activity Feed entry (mirroring contracts/invoices/
-- projects, which also log to activity_log despite having their own list
-- view) — comments and reactions do NOT, to keep the Activity Feed from
-- drowning in "so-and-so liked a post" noise. The Community Feed itself is
-- already the place to watch that traffic.
--
-- Post images use the SAME private-bucket-plus-signed-URL pattern as
-- grid-media (org-scoped folder, `createSignedUrl()` on read) rather than
-- portfolio-media's public bucket — unlike a portfolio, this content is
-- internal team chatter and was never meant to be discoverable outside the
-- org, so there's no reason to make it public.
--
-- PREREQUISITE: migration_organizations.sql must already be applied (uses
-- public.my_org_id(), public.is_owner(), public.stamp_org_id(), and
-- public.touch_updated_at(), all defined there).
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- Safe to re-run — every statement is guarded (if not exists / or replace /
-- drop policy if exists).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COMMUNITY_POSTS
-- ----------------------------------------------------------------------------
create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  body text not null default '',
  image_path text,
  pinned boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_community_posts_org on public.community_posts (org_id);
create index if not exists idx_community_posts_created on public.community_posts (created_at desc);

alter table public.community_posts enable row level security;

drop policy if exists "community_posts: read org" on public.community_posts;
create policy "community_posts: read org" on public.community_posts
  for select using (org_id = public.my_org_id());

-- Anyone on the team can post. Only the owner or whoever wrote it can edit
-- it afterwards; only the owner can delete one outright — same split as
-- contracts/invoices/projects.
drop policy if exists "community_posts: insert self" on public.community_posts;
create policy "community_posts: insert self" on public.community_posts
  for insert with check (auth.role() = 'authenticated' and org_id = public.my_org_id());

drop policy if exists "community_posts: update own or owner" on public.community_posts;
create policy "community_posts: update own or owner" on public.community_posts
  for update
  using (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()))
  with check (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()));

drop policy if exists "community_posts: owner deletes" on public.community_posts;
create policy "community_posts: owner deletes" on public.community_posts
  for delete using (org_id = public.my_org_id() and public.is_owner());

drop trigger if exists trg_community_posts_org on public.community_posts;
create trigger trg_community_posts_org before insert on public.community_posts
  for each row execute function public.stamp_org_id();

drop trigger if exists trg_community_posts_touch on public.community_posts;
create trigger trg_community_posts_touch before update on public.community_posts
  for each row execute function public.touch_updated_at();

create or replace function public.log_community_post()
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

  insert into public.activity_log (actor_id, prospect_id, message, org_id)
  values (auth.uid(), null, actor_name || ' posted in the Community Feed', new.org_id);
  return new;
end;
$$;

drop trigger if exists trg_community_posts_log on public.community_posts;
create trigger trg_community_posts_log after insert on public.community_posts
  for each row execute function public.log_community_post();

-- ----------------------------------------------------------------------------
-- 2. COMMUNITY_COMMENTS
-- ----------------------------------------------------------------------------
create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  post_id uuid not null references public.community_posts (id) on delete cascade,
  body text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_community_comments_org on public.community_comments (org_id);
create index if not exists idx_community_comments_post on public.community_comments (post_id);

alter table public.community_comments enable row level security;

drop policy if exists "community_comments: read org" on public.community_comments;
create policy "community_comments: read org" on public.community_comments
  for select using (org_id = public.my_org_id());

drop policy if exists "community_comments: insert self" on public.community_comments;
create policy "community_comments: insert self" on public.community_comments
  for insert with check (auth.role() = 'authenticated' and org_id = public.my_org_id());

-- Comments read more like chat messages than business records, so — unlike
-- posts — the author can remove their own comment immediately, not just
-- edit it, without waiting on the owner.
drop policy if exists "community_comments: update own or owner" on public.community_comments;
create policy "community_comments: update own or owner" on public.community_comments
  for update
  using (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()))
  with check (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()));

drop policy if exists "community_comments: delete own or owner" on public.community_comments;
create policy "community_comments: delete own or owner" on public.community_comments
  for delete using (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()));

drop trigger if exists trg_community_comments_org on public.community_comments;
create trigger trg_community_comments_org before insert on public.community_comments
  for each row execute function public.stamp_org_id();

drop trigger if exists trg_community_comments_touch on public.community_comments;
create trigger trg_community_comments_touch before update on public.community_comments
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. COMMUNITY_REACTIONS  ("likes" — one per person per post)
-- ----------------------------------------------------------------------------
create table if not exists public.community_reactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  post_id uuid not null references public.community_posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create index if not exists idx_community_reactions_org on public.community_reactions (org_id);
create index if not exists idx_community_reactions_post on public.community_reactions (post_id);

alter table public.community_reactions enable row level security;

drop policy if exists "community_reactions: read org" on public.community_reactions;
create policy "community_reactions: read org" on public.community_reactions
  for select using (org_id = public.my_org_id());

-- You can only ever like on your own behalf, and only ever remove your own
-- like — there's nothing here for the owner to moderate, so no owner
-- override is needed on either policy.
drop policy if exists "community_reactions: insert self" on public.community_reactions;
create policy "community_reactions: insert self" on public.community_reactions
  for insert with check (
    auth.role() = 'authenticated'
    and org_id = public.my_org_id()
    and user_id = auth.uid()
  );

drop policy if exists "community_reactions: delete own" on public.community_reactions;
create policy "community_reactions: delete own" on public.community_reactions
  for delete using (org_id = public.my_org_id() and user_id = auth.uid());

drop trigger if exists trg_community_reactions_org on public.community_reactions;
create trigger trg_community_reactions_org before insert on public.community_reactions
  for each row execute function public.stamp_org_id();

-- ----------------------------------------------------------------------------
-- 4. STORAGE — community-media bucket (private, org-scoped, signed URLs)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('community-media', 'community-media', false)
on conflict (id) do nothing;

-- Org scoping via the first path segment, e.g. `{org_id}/{timestamp}.jpg` —
-- same folder-prefix convention as grid-media.
drop policy if exists "community-media: org read" on storage.objects;
create policy "community-media: org read" on storage.objects
  for select using (
    bucket_id = 'community-media'
    and (storage.foldername(name))[1] = public.my_org_id()::text
  );

drop policy if exists "community-media: org upload" on storage.objects;
create policy "community-media: org upload" on storage.objects
  for insert with check (
    bucket_id = 'community-media'
    and (storage.foldername(name))[1] = public.my_org_id()::text
  );

drop policy if exists "community-media: owner delete" on storage.objects;
create policy "community-media: owner delete" on storage.objects
  for delete using (
    bucket_id = 'community-media'
    and (storage.foldername(name))[1] = public.my_org_id()::text
    and public.is_owner()
  );

-- ----------------------------------------------------------------------------
-- 5. REALTIME
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_posts'
  ) then
    alter publication supabase_realtime add table public.community_posts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_comments'
  ) then
    alter publication supabase_realtime add table public.community_comments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_reactions'
  ) then
    alter publication supabase_realtime add table public.community_reactions;
  end if;
end $$;

-- ============================================================================
-- DONE.
--   1. Run this whole file in Supabase Dashboard → SQL Editor.
--   2. Redeploy the app/ folder (frontend changes ship alongside this).
--   3. New sidebar link: "Community Feed" — everyone can post/comment/like;
--      only the owner can pin or delete a post; a comment's own author (or
--      the owner) can delete/edit that comment.
-- ============================================================================
