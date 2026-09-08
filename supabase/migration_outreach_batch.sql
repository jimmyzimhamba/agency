-- ============================================================================
-- STUDIO X COMMAND — Batch outreach: approval, do-not-contact, and a send log
-- ============================================================================
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.
--
-- What this is for, in plain language:
--   The AI already researches a business and writes the 3-line opener (the
--   research-prospect Edge Function, which IS deployed and working). What was
--   missing was everything around it: a place to review a stack of those
--   messages in one sitting, a record of who has actually been contacted
--   today, and — most importantly — a way to record "never message this
--   business again".
--
-- What this deliberately does NOT do:
--   It does not send anything. There is no automated WhatsApp sending here and
--   there is not going to be. Cold outreach from an automated WhatsApp session
--   is the single fastest way to get +263775051827 banned, and that number is
--   how existing clients reach the agency — losing it costs far more than the
--   outreach is worth. The app's long-standing design (see the comment at the
--   top of app/js/whatsapp.js) is that the FIRST message to a stranger is
--   always a wa.me hand-off that a human presses send on inside their own
--   WhatsApp. That is not a workaround, it is the only version of this that is
--   allowed and safe. This migration supports batching that hand-off, so 20
--   sends is a few minutes of tapping instead of two hours of research and
--   typing.
-- ============================================================================


-- ============================================================================
-- SECTION A — Do not contact
-- ============================================================================
-- The gap that mattered most, and the reason this is section A rather than an
-- afterthought at the bottom. Right now if a business replies "stop messaging
-- me", there is nowhere to put that. The prospect can be marked 'dead', but
-- dead means "no sale here" — it does not mean "do not ever write to these
-- people again", and nothing stops a teammate re-adding them from Discovery
-- next month and starting over. In a city the size of Harare, where the
-- business community talks, that is how an agency gets a reputation.
--
-- Separate from status on purpose. Status describes the sales conversation.
-- This describes consent, which outlives it: a business can go dead and later
-- become a lead again, but a business that asked not to be contacted stays
-- that way regardless of what the pipeline says.

alter table public.prospects add column if not exists do_not_contact boolean not null default false;
alter table public.prospects add column if not exists do_not_contact_reason text;
alter table public.prospects add column if not exists do_not_contact_at timestamptz;

-- Partial index: the flag is false for almost every row, so only the true ones
-- are worth indexing. This is the lookup every outreach screen runs.
create index if not exists idx_prospects_dnc on public.prospects (org_id)
  where do_not_contact = true;


-- ============================================================================
-- SECTION B — Approval
-- ============================================================================
-- Two columns rather than a queue table, and that choice is worth explaining
-- because a queue table was the obvious design.
--
-- A queue would hold its own copy of the message, which immediately creates
-- two versions of the truth: edit the prospect's opener afterwards and the
-- queued copy silently goes stale, so the message reviewed is not the message
-- sent. Approval is really just a fact about the prospect — "a human has read
-- this opener and is happy for it to go" — so it lives on the prospect, and
-- there is only ever one copy of the text.
--
-- Editing the message clears the approval again. That is enforced by the
-- trigger below rather than by the app, because it is the whole point of
-- having an approval step and it should not depend on a button remembering.

alter table public.prospects add column if not exists outreach_approved_at timestamptz;
alter table public.prospects add column if not exists outreach_approved_by uuid references public.profiles (id) on delete set null;

create or replace function public.clear_outreach_approval()
returns trigger
language plpgsql
as $$
begin
  -- Only when the message text itself actually changed. Comparing with "is
  -- distinct from" rather than <> so a null-to-text change counts too, which a
  -- plain inequality would miss.
  if new.outreach_message is distinct from old.outreach_message then
    -- Unless this same statement is what granted the approval — otherwise the
    -- app could never approve and tidy up the wording in one go.
    if new.outreach_approved_at is not distinct from old.outreach_approved_at then
      new.outreach_approved_at := null;
      new.outreach_approved_by := null;
    end if;
  end if;

  -- Marking a business do-not-contact withdraws any approval it was carrying,
  -- so an already-approved message cannot be sitting in today's send list when
  -- the flag goes on.
  if new.do_not_contact = true and coalesce(old.do_not_contact, false) = false then
    new.outreach_approved_at := null;
    new.outreach_approved_by := null;
    new.do_not_contact_at := coalesce(new.do_not_contact_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prospects_clear_approval on public.prospects;
create trigger trg_prospects_clear_approval before update on public.prospects
  for each row execute function public.clear_outreach_approval();


-- ============================================================================
-- SECTION C — The send log
-- ============================================================================
-- One row every time somebody actually hands a message off to WhatsApp.
--
-- Why not just count prospects whose status flipped to 'sent' today? Because
-- status is a single field that moves for lots of reasons and only remembers
-- where a prospect is now, not what happened. It gets set by hand, corrected
-- after a mistake, and moved on to 'replied' the moment somebody answers — at
-- which point that send disappears from any count based on it. A prospect
-- contacted this morning who replies this afternoon would make the daily
-- total go DOWN, which is exactly the number nobody can trust.
--
-- An append-only log has none of that. It also answers "who contacted this
-- business, and when" months later, which is the question that matters when a
-- prospect says "someone from your team already called me".

create table if not exists public.outreach_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  prospect_id uuid not null references public.prospects (id) on delete cascade,

  -- Only whatsapp for now. Email is in the check constraint because the column
  -- is cheaper to widen than to add later, not because email outreach exists
  -- yet — it needs a sending domain and a provider whose terms permit cold
  -- email, and neither is set up.
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'email')),

  -- A snapshot of what was actually sent. The prospect's outreach_message can
  -- be edited afterwards; this cannot, so there is always a truthful record of
  -- the words that went out.
  message text not null default '',

  sent_by uuid references public.profiles (id) on delete set null,
  sent_at timestamptz not null default now()
);

create index if not exists idx_outreach_log_org_time on public.outreach_log (org_id, sent_at desc);
create index if not exists idx_outreach_log_prospect on public.outreach_log (prospect_id);

alter table public.outreach_log enable row level security;

-- No update policy and no delete policy at all, deliberately. This is a record
-- of what was said to people outside the company; being able to quietly revise
-- it afterwards would make it worthless as a record. Rows go in and stay.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'outreach_log' and policyname = 'outreach_log: read org') then
    create policy "outreach_log: read org" on public.outreach_log
      for select using (org_id = public.my_org_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'outreach_log' and policyname = 'outreach_log: insert self') then
    create policy "outreach_log: insert self" on public.outreach_log
      for insert with check (auth.role() = 'authenticated' and org_id = public.my_org_id());
  end if;
end $$;

drop trigger if exists trg_outreach_log_org on public.outreach_log;
create trigger trg_outreach_log_org before insert on public.outreach_log
  for each row execute function public.stamp_org_id();
