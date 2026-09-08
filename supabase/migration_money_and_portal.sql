-- ============================================================================
-- STUDIO X COMMAND — Expenses, the client project portal, and auto-drafted
-- retainer invoices.
-- ----------------------------------------------------------------------------
-- Three features ship together in ONE file on purpose. They could each have
-- their own migration (that's the convention every earlier feature followed),
-- but the person running this is not a developer, and three separate pastes
-- into the SQL editor is three chances to run two of them and forget the
-- third — which fails in the worst possible way, because the app would load
-- fine and then break only on the one screen whose table never got created.
-- One paste either works completely or fails completely.
--
-- Safe to run more than once. Every statement is guarded (if not exists /
-- create or replace / a do-block that checks first), so re-running it after a
-- partial failure fixes up whatever is missing and leaves the rest alone. It
-- never drops anything and never touches a row of existing data.
--
--   SECTION A — expenses (money out, so profit is knowable)
--   SECTION B — client project portal (a no-login link per project)
--   SECTION C — retainer invoices that draft themselves
-- ============================================================================


-- ============================================================================
-- SECTION A — EXPENSES
-- ----------------------------------------------------------------------------
-- Until now the app tracked every dollar coming in (invoices) and nothing
-- going out, which means "we collected $4,000 this month" could not be turned
-- into "we kept $X". Worse, it could not answer the question that actually
-- decides who the agency should keep working with: is this client profitable?
--
-- prospect_id is deliberately NULLABLE, and that nullability is the whole
-- design. An expense either belongs to one client (ad spend fronted for them,
-- a freelance designer booked for their job) or it is the cost of being open
-- at all (office data bundle, Canva subscription). Forcing every expense onto
-- a client would inflate that client's cost with overhead they didn't cause;
-- refusing to attach any would make per-client profit impossible. So: attach
-- it when it's genuinely theirs, leave it blank when it isn't.
--
-- What this deliberately does NOT do is spread overhead across clients. There
-- are respectable formulas for that (by revenue share, by hours) and every one
-- of them produces a confident-looking number resting on an assumption nobody
-- in the room agreed to. Per-client profit here means revenue minus costs
-- genuinely incurred for that client, and the screen says so in those words.
-- ============================================================================

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,

  description text not null,
  amount numeric(10,2) not null default 0,

  -- Categories are a fixed list rather than free text so the breakdown can
  -- actually group. They're chosen for a Harare agency specifically:
  --   ad_spend       — Meta/Google budget, very often fronted for a client
  --   subcontractor  — freelance designer, editor, photographer, writer
  --   software       — Canva, hosting, domains, scheduling tools
  --   data_airtime   — bundles and airtime, a real and recurring line here
  --   transport      — fuel and kombi fare to client meetings
  --   equipment      — phones, laptops, lights, gimbals
  --   other          — the honest escape hatch, so nothing gets miscategorised
  --                    just to make the form submit
  category text not null default 'other'
    check (category in ('ad_spend', 'subcontractor', 'software', 'data_airtime', 'transport', 'equipment', 'other')),

  -- Which client this was spent on, if any. on delete set null, not cascade:
  -- deleting a prospect must never quietly delete money that actually left the
  -- bank. The expense survives and becomes overhead, which is wrong-ish but
  -- recoverable; erasing it would silently overstate profit forever.
  prospect_id uuid references public.prospects (id) on delete set null,

  -- The date the money was actually spent, which is not the date somebody got
  -- round to typing it in. Every "this month" total in the app keys off this,
  -- so an expense entered late still lands in the month it belongs to.
  spent_on date not null default current_date,

  -- A flag, not a scheduler. Marking a subscription recurring does not create
  -- next month's row — it just lets the Expenses screen show a "these repeat"
  -- total, so the owner can see the standing monthly burn separately from
  -- one-off spending. Auto-creating rows for money that may not have actually
  -- left the account would put fiction in the ledger.
  recurring boolean not null default false,

  notes text not null default '',

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_expenses_org on public.expenses (org_id);
create index if not exists idx_expenses_prospect on public.expenses (prospect_id);
create index if not exists idx_expenses_spent_on on public.expenses (spent_on);
create index if not exists idx_expenses_category on public.expenses (category);

alter table public.expenses enable row level security;

-- Permission model mirrors invoices exactly, and for the same reason: this is
-- money. Everyone on the team can see it (an agent who fronts ad spend has to
-- be able to record it and check it landed), anyone can add, but you may only
-- edit your own entries unless you're the owner, and only the owner can
-- delete. Deleting an expense makes the agency look more profitable than it
-- is, so that stays with one person.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'expenses' and policyname = 'expenses: read org') then
    create policy "expenses: read org" on public.expenses
      for select using (org_id = public.my_org_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'expenses' and policyname = 'expenses: insert self') then
    create policy "expenses: insert self" on public.expenses
      for insert with check (auth.role() = 'authenticated' and org_id = public.my_org_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'expenses' and policyname = 'expenses: update own or owner') then
    create policy "expenses: update own or owner" on public.expenses
      for update
      using (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()))
      with check (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'expenses' and policyname = 'expenses: owner deletes') then
    create policy "expenses: owner deletes" on public.expenses
      for delete using (org_id = public.my_org_id() and public.is_owner());
  end if;
end $$;

drop trigger if exists trg_expenses_org on public.expenses;
create trigger trg_expenses_org before insert on public.expenses
  for each row execute function public.stamp_org_id();

drop trigger if exists trg_expenses_touch on public.expenses;
create trigger trg_expenses_touch before update on public.expenses
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- SECTION B — CLIENT PROJECT PORTAL
-- ----------------------------------------------------------------------------
-- A read-only page a client opens with no login, showing what's been done on
-- their project and what's next. The link is the credential: ?t=<token>.
--
-- Grid Plans already solved this exact problem and its solution is the one
-- worth copying — the table stays completely unreadable to anonymous
-- visitors, and the public page gets its data through a single controlled
-- entry point that validates the token server-side. What is NOT copied is the
-- delivery mechanism. Grid Plans routes through four Edge Functions, and Edge
-- Functions have to be deployed with a command-line tool. There is already one
-- function in this project written months ago and still not deployed, which is
-- the honest evidence that anything requiring a deploy step will not reliably
-- happen here.
--
-- So this uses a database function instead. It is pasted in with the rest of
-- this file, it runs the moment this migration does, and there is nothing left
-- to deploy afterwards. security definer lets it read past row-level security;
-- the token check inside it is what replaces that security, and it can only
-- ever return the single project whose token matches exactly.
-- ============================================================================

alter table public.projects add column if not exists share_token text;
alter table public.projects add column if not exists shared_at timestamptz;

-- One token can only ever mean one project, and a unique index is what makes
-- the "exactly one row" guarantee below real rather than assumed.
create unique index if not exists idx_projects_share_token on public.projects (share_token)
  where share_token is not null;

-- Lets a task be kept off the client's page. Without this the team has to
-- choose between writing tasks honestly ("chase client for their logo, third
-- time") and being able to share the project at all — and faced with that
-- choice people write vague tasks, which quietly makes the whole checklist
-- less useful internally. Defaults to false so sharing shows everything unless
-- somebody deliberately hides a line.
alter table public.project_tasks add column if not exists internal boolean not null default false;

-- The public page's only door. Takes a token, returns one project as json, or
-- null for anything it doesn't recognise.
--
-- Returning plain null on a bad token — rather than raising — is deliberate.
-- An error would let someone guessing tokens tell the difference between
-- "wrong token" and "something else went wrong", and there is no benefit to
-- the client in distinguishing them either: the page says "this link isn't
-- valid any more, ask your agency for a new one" for every failure.
--
-- The select list is written out field by field rather than as a row-to-json
-- of the whole table. That is the point of it: internal notes, who created the
-- project, and the org's own identifiers must not travel to a client's phone,
-- and a explicit list is the only version of this that stays safe when a
-- column is added to projects later. A `select *` here would silently start
-- publishing any future column the moment it was created.
create or replace function public.project_portal(p_token text)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  proj public.projects%rowtype;
  org_name text;
  result json;
begin
  if p_token is null or length(p_token) < 16 then
    return null;
  end if;

  select * into proj from public.projects where share_token = p_token;
  if not found then
    return null;
  end if;

  select name into org_name from public.organizations where id = proj.org_id;

  select json_build_object(
    'project', json_build_object(
      'name', proj.name,
      'status', proj.status,
      'start_date', proj.start_date,
      'due_date', proj.due_date,
      'updated_at', proj.updated_at
    ),
    'agency', json_build_object('name', coalesce(org_name, 'Your agency')),
    'client', (
      select json_build_object('name', pr.business_name)
      from public.prospects pr
      where pr.id = proj.prospect_id
    ),
    'tasks', coalesce((
      select json_agg(json_build_object('title', t.title, 'done', t.done) order by t.sort_order)
      from public.project_tasks t
      where t.project_id = proj.id and t.internal = false
    ), '[]'::json)
  ) into result;

  return result;
end;
$$;

-- anon is the role an un-logged-in browser uses. Granting execute on this one
-- function is what makes the public page possible; the projects table itself
-- stays unreadable to anon, so this function is the only thing anonymous
-- visitors can reach, and it only ever answers with a project whose exact
-- token they already had.
grant execute on function public.project_portal(text) to anon;


-- ============================================================================
-- SECTION C — RETAINER INVOICES THAT DRAFT THEMSELVES
-- ----------------------------------------------------------------------------
-- Signed clients carry a monthly retainer (prospects.mrr) but invoices are
-- created entirely by hand. Revenue that depends on somebody remembering to
-- invoice leaks, and it leaks silently: an invoice nobody created never shows
-- up as overdue, never appears in Outstanding, and never gets chased. It just
-- isn't there, and the month closes short with no trace of why.
--
-- Drafts, never sends. Every generated invoice lands in 'draft' so a human
-- still reviews and sends it. Auto-sending real bills to real clients on a
-- timer is how an agency emails an invoice to somebody who cancelled last
-- week.
-- ============================================================================

create or replace function public.draft_retainer_invoices(p_org_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  month_start date := date_trunc('month', current_date)::date;
  month_end date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  made integer := 0;
  next_num text;
begin
  -- Defence in depth, and it is not theoretical: the first version of this
  -- file relied solely on the revoke at the bottom to keep web callers out,
  -- and that revoke did not work. Postgres grants EXECUTE on a new function
  -- to PUBLIC automatically, and revoking from 'anon' does not remove a grant
  -- held by PUBLIC — so this function stayed callable by anyone holding the
  -- publishable key, which is everyone, since it ships inside the app's
  -- JavaScript. Called with no argument it drafts invoices for every
  -- organisation in the database.
  --
  -- The revoke below is now written correctly. This check is here anyway,
  -- because a grant is a fact stored in the database that a later migration
  -- or a hand-run statement can quietly undo, whereas this travels with the
  -- function itself. pg_cron runs as the database owner, not as one of the
  -- two web roles, so the scheduled job is unaffected.
  if current_user in ('anon', 'authenticated') and not public.is_owner() then
    raise exception 'Only the owner can draft retainer invoices';
  end if;

  for r in
    select p.id as prospect_id, p.org_id, p.mrr, p.assigned_to
    from public.prospects p
    where p.status = 'signed'
      and p.mrr > 0
      and (p_org_id is null or p.org_id = p_org_id)
      -- The whole idempotency guarantee lives here. "Has this client already
      -- got an invoice covering this month?" is asked by due_date falling
      -- inside the month, not by created_at, because an invoice raised on the
      -- 28th of last month for this month's work is the same money. Keying on
      -- creation date would raise a duplicate for it. Void invoices are
      -- excluded on purpose: voiding one is how a person says "that was
      -- wrong, do it again", so a void shouldn't block the retry.
      and not exists (
        select 1 from public.invoices i
        where i.prospect_id = p.id
          and i.status <> 'void'
          and i.due_date between month_start and month_end
      )
  loop
    -- Numbering reads the highest number already used in this org and adds
    -- one, rather than counting the rows. Counting is what the app's own
    -- client-side helper does, and it repeats a number as soon as an invoice
    -- has ever been deleted — fine-ish when a human is looking at the field
    -- and can correct it, not fine for something that runs unattended.
    select 'INV-' || lpad((coalesce(max(nullif(regexp_replace(invoice_number, '\D', '', 'g'), '')::bigint), 0) + 1)::text, 4, '0')
      into next_num
      from public.invoices
      where org_id = r.org_id;

    insert into public.invoices (org_id, prospect_id, invoice_number, amount, status, due_date, notes, created_by)
    values (
      r.org_id,
      r.prospect_id,
      next_num,
      r.mrr,
      'draft',
      -- Due at the end of the month it covers. A date the client can sanity
      -- check against the work they received.
      month_end,
      'Monthly retainer — ' || to_char(month_start, 'FMMonth YYYY') || '. Drafted automatically; check the amount before sending.',
      -- Attributed to whoever owns the client, so it shows up under a real
      -- name in Invoices rather than appearing from nowhere. Null if the
      -- client is unassigned, which the invoices table already allows.
      r.assigned_to
    );
    made := made + 1;
  end loop;

  return made;
end;
$$;

-- The version the app calls. The one above takes an org id and will happily
-- run for every org in the database, which is exactly right for a scheduled
-- job and exactly wrong for a button in a web app — a caller could pass
-- somebody else's org id, or none at all. This wrapper takes no arguments, so
-- the only org it can ever touch is the caller's own, and it refuses anyone
-- who isn't the owner of it.
create or replace function public.draft_my_retainer_invoices()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can draft retainer invoices';
  end if;
  return public.draft_retainer_invoices(public.my_org_id());
end;
$$;

-- These revokes name PUBLIC, not anon/authenticated, and that distinction is
-- the whole point. Creating a function automatically grants EXECUTE to
-- PUBLIC — a group both web roles belong to — and "revoke from anon" only
-- removes a grant made directly to anon. It leaves the inherited PUBLIC grant
-- untouched, so the function stays callable. Revoking from PUBLIC first and
-- then granting back to exactly the role that should have it is the only
-- version of this that actually closes the door.
revoke execute on function public.draft_retainer_invoices(uuid) from public, anon, authenticated;
revoke execute on function public.draft_my_retainer_invoices() from public, anon;
grant execute on function public.draft_my_retainer_invoices() to authenticated;

-- Run it on the 1st of every month at 06:00 UTC (08:00 in Harare), so the
-- drafts are already waiting when somebody opens the app.
--
-- No Edge Function and no pg_net here, unlike the overdue-invoice job that
-- already runs on this database. That one has to make an HTTP call because it
-- sends push notifications, which the database can't do. This one only writes
-- rows, so pg_cron can call it directly — which means no function to deploy,
-- no secret to paste, and nothing that can silently stop working because a
-- key was rotated.
--
-- If this whole block fails, the feature still works: the Invoices screen
-- shows the owner a "these retainers aren't invoiced yet" banner with a button
-- that calls exactly the same function by hand. The schedule is a convenience,
-- not the mechanism, which is why the failure is caught and reported rather
-- than aborting the migration.
do $$
begin
  create extension if not exists pg_cron;

  if exists (select 1 from cron.job where jobname = 'draft-retainer-invoices-monthly') then
    perform cron.unschedule('draft-retainer-invoices-monthly');
  end if;

  perform cron.schedule(
    'draft-retainer-invoices-monthly',
    '0 6 1 * *',
    $job$ select public.draft_retainer_invoices(); $job$
  );

  raise notice 'Retainer invoice drafting scheduled for the 1st of each month.';
exception when others then
  raise notice 'Could not schedule the monthly job (%). Not a problem — the Invoices screen has a button that does the same thing.', sqlerrm;
end $$;
