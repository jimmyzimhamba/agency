-- ============================================================================
-- STUDIO X COMMAND — Remove the em dash from stored text
-- ============================================================================
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once (running it twice changes nothing the second
-- time, because there is nothing left to change).
--
-- What this is for, in plain language:
--   The em dash (—) is now banned from anything a person reads in this app.
--   The app code and the AI functions have been changed so nothing new is ever
--   written with one. This file deals with the text that is ALREADY saved in
--   the database from before that rule existed.
--
-- Why it matters more than it sounds:
--   The em dash is the single most recognisable sign that a sentence was
--   written by a machine rather than a person. These messages go to real
--   business owners in Harare under a real teammate's name. A prospect who
--   reads the message and thinks "a robot wrote this" has already decided the
--   answer before they finish line 3. It costs nothing to remove and it
--   removes a reason to be ignored.
--
--   The message templates are the worst offenders and the reason this file
--   exists at all. Every one of the eleven niche openers seeded when the app
--   was first set up contains TWO of them, including one immediately before
--   the sender's name. Those are not internal notes, they are the exact words
--   that get pasted into WhatsApp.
--
-- A note on what this does NOT touch:
--   Nothing anyone typed themselves by hand is rewritten here. Prospect notes,
--   gap notes, task titles, invoice line items and contract bodies are left
--   exactly as written, because a human choosing to type a dash is a human
--   writing, not a machine giving itself away, and silently editing somebody's
--   own words is not something a migration should do. The screen strips the
--   character on the way to being displayed anyway, so those read correctly
--   without the stored text being altered.
-- ============================================================================


-- ============================================================================
-- SECTION A — A helper, so every rule below is applied identically
-- ============================================================================
-- Written as a function rather than repeating three replace() calls in five
-- places, because the risk with a find-and-replace migration is that one of
-- the copies is subtly different from the others and nobody notices for a
-- year. One definition means one behaviour.
--
-- The three rules run innermost-first, and the order is load-bearing. Both of
-- the specific rules have to fire before the general one, because the general
-- one matches everything they match:
--   1. Number ranges. "1-15" means "1 to 15", and turning that into "1, 15"
--      would change what the sentence actually says.
--   2. The signature dash, the one sitting just before {{agent_name}} at the
--      end of every seeded template, becomes a blank line, so the templates
--      sign off the same way the AI-written messages already do. If the
--      general rule ran first this would already be a comma and there would
--      be nothing left to recognise.
--   3. Everything else. A dash used as punctuation becomes a comma, because
--      that is nearly always what it was standing in for. A hyphen was the
--      alternative and was rejected: " - " is becoming a machine-writing tell
--      in its own right, and it reads like a typo mid-sentence.

create or replace function public.strip_em_dash(txt text)
returns text
language sql
immutable
as $$
  select case when txt is null then null else
    regexp_replace(
      regexp_replace(
        regexp_replace(txt, '(\d)\s*[—–]\s*(\d)', '\1 to \2', 'g'),
        '\?\s*—\s*\{\{agent_name\}\}', E'?\n\n{{agent_name}}', 'g'
      ),
      '\s*[—–]\s*', ', ', 'g'
    )
  end;
$$;


-- ============================================================================
-- SECTION B — The message templates
-- ============================================================================
-- The ones that actually get sent to strangers. Both the title and the body,
-- because the title shows in the picker the team reads when choosing one.

update public.message_templates
set body = public.strip_em_dash(body),
    title = public.strip_em_dash(title)
where body like '%—%' or body like '%–%' or title like '%—%' or title like '%–%';


-- ============================================================================
-- SECTION C — Messages the AI has already written
-- ============================================================================
-- outreach_message is the drafted opener sitting on each prospect, waiting to
-- be approved and sent. research_summary is the "here is what I found" note
-- the team reads beside it.
--
-- Deliberately NOT touching a message that has already been approved and is
-- waiting to go out today: editing it here would fire the approval-clearing
-- trigger and quietly knock it out of the send list, which would look like the
-- app losing work. Those are handled on screen instead, where the character is
-- stripped as the message is handed to WhatsApp, so they still go out clean.

update public.prospects
set outreach_message = public.strip_em_dash(outreach_message)
where outreach_approved_at is null
  and (outreach_message like '%—%' or outreach_message like '%–%');

update public.prospects
set research_summary = public.strip_em_dash(research_summary)
where research_summary like '%—%' or research_summary like '%–%';


-- ============================================================================
-- SECTION D — The activity feed
-- ============================================================================
-- Lines like "Tino drafted a contract, Website Retainer". Nobody outside the
-- company reads these, so this is tidiness rather than credibility, but the
-- rule was "never, anywhere a person sees it", and this is somewhere a person
-- sees it.
--
-- The first version of this section named the wrong column on activity_log
-- (description, when the column is actually called message) and the wrong
-- table for points (points_ledger, when it is points_log). Postgres rejected
-- the whole file rather than that one statement, which meant sections A to C
-- did not apply either. That is the useful lesson here and the reason the
-- checks below changed shape:
--
--   A to_regclass check only proves a TABLE exists. It says nothing about the
--   columns inside it, so a wrong column name still aborts the run. Asking
--   information_schema for the column itself is the check that actually
--   matches what the statement needs.
--
-- Both objects are optional in a way that justifies the guards: points_log
-- only exists if the points migration was run, and activity_log's column names
-- differ between older and newer installs of this app. Neither should be able
-- to stop the parts above from applying.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_log' and column_name = 'message'
  ) then
    update public.activity_log
    set message = public.strip_em_dash(message)
    where message like '%—%' or message like '%–%';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'points_log' and column_name = 'reason'
  ) then
    update public.points_log
    set reason = public.strip_em_dash(reason)
    where reason like '%—%' or reason like '%–%';
  end if;
end $$;


-- ============================================================================
-- SECTION E — Check it worked
-- ============================================================================
-- Run this on its own afterwards if you want to see the result. Every row
-- should read 0.

-- select
--   (select count(*) from public.message_templates where body like '%—%') as templates,
--   (select count(*) from public.prospects where outreach_message like '%—%') as messages,
--   (select count(*) from public.prospects where research_summary like '%—%') as summaries;
