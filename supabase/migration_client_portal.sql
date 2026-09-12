-- ============================================================================
-- STUDIO X COMMAND, Client Portal (welcome page, monthly reports, invoices,
-- feedback)
-- ============================================================================
-- What this ships:
--   A single no-login link per client (same "the link is the credential"
--   pattern as the existing project portal, see
--   migration_money_and_portal.sql SECTION B), pointed at a new page,
--   app/client.html. It shows a short welcome, whichever monthly reports the
--   team has PUBLISHED for that client (drafts stay invisible), their
--   invoices that are sent or paid (never drafts, by design, a client should
--   never see an internal draft dollar figure), and a simple feedback box.
--
-- Why one token on prospects rather than one per report/invoice:
--   The ask was "a dashboard", one durable place a client bookmarks and keeps
--   coming back to, not a fresh link every month. So the token lives on
--   prospects (one per client, same row that already anchors everything else
--   about them), and client_reports/invoices are looked up FROM that client,
--   not the other way around.
--
-- Safe to run more than once, same idempotent shape as every other migration
-- in this project (if not exists / create or replace / guarded columns).
-- Never drops anything, never touches an existing row. The "create policy"
-- statements below are the one exception to "never drops": Postgres has no
-- "create policy if not exists", so each one is preceded by a matching
-- "drop policy if exists" on that exact name. That only ever drops and
-- immediately recreates the identical rule, it does not touch any table
-- data, so a half-finished earlier run of this same file is safe to just
-- run again from the top.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION A, the token itself
-- ----------------------------------------------------------------------------
alter table public.prospects add column if not exists portal_token text;
alter table public.prospects add column if not exists portal_token_created_at timestamptz;

create unique index if not exists idx_prospects_portal_token on public.prospects (portal_token)
  where portal_token is not null;

-- ----------------------------------------------------------------------------
-- SECTION B, monthly reports
-- ----------------------------------------------------------------------------
create table if not exists public.client_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  -- Draft is the default on purpose, same reasoning as invoices defaulting to
  -- 'draft': whatever the team is mid-writing should never be one Realtime
  -- event away from showing up on a client's dashboard. Only 'published'
  -- rows are ever returned by client_portal() below.
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_client_reports_prospect on public.client_reports (prospect_id);

alter table public.client_reports enable row level security;

drop policy if exists "client_reports: read org" on public.client_reports;
create policy "client_reports: read org" on public.client_reports
  for select using (org_id = public.my_org_id());

drop policy if exists "client_reports: insert self" on public.client_reports;
create policy "client_reports: insert self" on public.client_reports
  for insert with check (auth.role() = 'authenticated' and org_id = public.my_org_id());

drop policy if exists "client_reports: update own or owner" on public.client_reports;
create policy "client_reports: update own or owner" on public.client_reports
  for update
  using (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()))
  with check (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()));

drop policy if exists "client_reports: owner deletes" on public.client_reports;
create policy "client_reports: owner deletes" on public.client_reports
  for delete using (org_id = public.my_org_id() and public.is_owner());

-- ----------------------------------------------------------------------------
-- SECTION C, feedback
-- ----------------------------------------------------------------------------
create table if not exists public.client_feedback (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  message text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_client_feedback_prospect on public.client_feedback (prospect_id);

alter table public.client_feedback enable row level security;

drop policy if exists "client_feedback: read org" on public.client_feedback;
create policy "client_feedback: read org" on public.client_feedback
  for select using (org_id = public.my_org_id());

drop policy if exists "client_feedback: owner deletes" on public.client_feedback;
create policy "client_feedback: owner deletes" on public.client_feedback
  for delete using (org_id = public.my_org_id() and public.is_owner());

-- No insert policy for authenticated team members here on purpose: every row
-- in this table arrives from an anonymous client through the SECURITY
-- DEFINER function below, which does its own validation before inserting.
-- If the team ever wants to log feedback by hand, that's a deliberate
-- follow-up, not an oversight.

-- ----------------------------------------------------------------------------
-- SECTION D, the two functions the public page actually talks to
-- ----------------------------------------------------------------------------

-- Read side, mirrors project_portal() in migration_money_and_portal.sql
-- exactly: security definer so it can see past RLS, an explicit field list
-- (never select *) so no future column leaks to a client by accident, and a
-- token that has to be an exact, non-trivial match. The prospects table
-- itself, and client_reports/invoices, all stay completely unreadable to
-- anon; this function is the only door, and it only ever opens onto one
-- client's own data.
create or replace function public.client_portal(p_token text)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  pros public.prospects%rowtype;
  org_name text;
  result json;
begin
  if p_token is null or length(p_token) < 16 then
    return null;
  end if;

  select * into pros from public.prospects where portal_token = p_token;
  if not found then
    return null;
  end if;

  select name into org_name from public.organizations where id = pros.org_id;

  select json_build_object(
    'client', json_build_object('name', pros.business_name),
    'agency', json_build_object('name', coalesce(org_name, 'Your agency')),
    'reports', coalesce((
      select json_agg(json_build_object(
        'title', r.title,
        'body', r.body,
        'published_at', r.published_at
      ) order by r.published_at desc)
      from public.client_reports r
      where r.prospect_id = pros.id and r.status = 'published'
    ), '[]'::json),
    -- Only sent/paid, never draft/void, drafts are internal-only numbers and
    -- void ones were mistakes, neither belongs in front of a client.
    'invoices', coalesce((
      select json_agg(json_build_object(
        'invoice_number', i.invoice_number,
        'amount', i.amount,
        'status', i.status,
        'due_date', i.due_date,
        'paid_date', i.paid_date,
        'service_period', i.service_period
      ) order by coalesce(i.due_date, i.created_at::date) desc)
      from public.invoices i
      where i.prospect_id = pros.id and i.status in ('sent', 'paid')
    ), '[]'::json)
  ) into result;

  return result;
end;
$$;

grant execute on function public.client_portal(text) to anon;

-- Write side, the one thing an anonymous client can actually change: leaving
-- feedback. Kept deliberately narrow, it validates the token the same way
-- the read side does, caps message length so this can't become a free text
-- dumping ground, and writes nothing at all if either check fails, no error
-- detail is returned that would help someone probe for a valid token.
create or replace function public.client_portal_feedback(p_token text, p_message text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  pros public.prospects%rowtype;
begin
  if p_token is null or length(p_token) < 16 then
    return false;
  end if;
  if p_message is null or length(trim(p_message)) = 0 or length(p_message) > 4000 then
    return false;
  end if;

  select * into pros from public.prospects where portal_token = p_token;
  if not found then
    return false;
  end if;

  insert into public.client_feedback (org_id, prospect_id, message)
  values (pros.org_id, pros.id, trim(p_message));

  return true;
end;
$$;

grant execute on function public.client_portal_feedback(text, text) to anon;
