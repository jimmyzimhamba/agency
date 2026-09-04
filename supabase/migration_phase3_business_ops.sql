-- ============================================================================
-- Agency Command — Phase 3: Contracts, Invoices, Projects
-- ============================================================================
-- Adds three new org-scoped modules for what happens AFTER a prospect signs:
-- Contracts (drafted/sent/signed agreements), Invoices (billing), and
-- Projects (delivery work + a simple checklist per project).
--
-- Same patterns as every other table in this app: org_id + RLS scoped to
-- public.my_org_id(), a stamp_org_id trigger so inserts don't need to pass
-- org_id by hand, touch_updated_at for updated_at, and activity_log entries
-- so these show up in the Team Activity Feed. No new external services.
--
-- PREREQUISITE: migration_organizations.sql must already be applied (this
-- file uses public.my_org_id(), public.is_owner(), public.stamp_org_id(),
-- and public.touch_updated_at(), all defined there).
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- Safe to re-run — every statement is guarded (if not exists / or replace /
-- drop policy if exists).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CONTRACTS
-- ----------------------------------------------------------------------------
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  prospect_id uuid references public.prospects (id) on delete set null,
  title text not null,
  value numeric(10,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'sent', 'signed', 'void')),
  sent_date date,
  signed_date date,
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contracts_org on public.contracts (org_id);
create index if not exists idx_contracts_prospect on public.contracts (prospect_id);
create index if not exists idx_contracts_status on public.contracts (status);

alter table public.contracts enable row level security;

drop policy if exists "contracts: read org" on public.contracts;
create policy "contracts: read org" on public.contracts
  for select using (org_id = public.my_org_id());

-- Anyone on the team can draft a contract (usually the agent who just
-- closed the deal). Only the owner or whoever created it can edit it
-- afterwards; only the owner can delete one outright.
drop policy if exists "contracts: insert self" on public.contracts;
create policy "contracts: insert self" on public.contracts
  for insert with check (auth.role() = 'authenticated' and org_id = public.my_org_id());

drop policy if exists "contracts: update own or owner" on public.contracts;
create policy "contracts: update own or owner" on public.contracts
  for update
  using (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()))
  with check (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()));

drop policy if exists "contracts: owner deletes" on public.contracts;
create policy "contracts: owner deletes" on public.contracts
  for delete using (org_id = public.my_org_id() and public.is_owner());

drop trigger if exists trg_contracts_org on public.contracts;
create trigger trg_contracts_org before insert on public.contracts
  for each row execute function public.stamp_org_id();

drop trigger if exists trg_contracts_touch on public.contracts;
create trigger trg_contracts_touch before update on public.contracts
  for each row execute function public.touch_updated_at();

create or replace function public.log_contract_changes()
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

  if tg_op = 'INSERT' then
    insert into public.activity_log (actor_id, prospect_id, message, org_id)
    values (auth.uid(), new.prospect_id, actor_name || ' drafted a contract — ' || new.title, new.org_id);
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.activity_log (actor_id, prospect_id, message, org_id)
    values (auth.uid(), new.prospect_id, actor_name || ' marked the contract "' || new.title || '" as ' || initcap(new.status), new.org_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_contracts_activity on public.contracts;
create trigger trg_contracts_activity after insert or update on public.contracts
  for each row execute function public.log_contract_changes();

-- ----------------------------------------------------------------------------
-- 2. INVOICES
-- ----------------------------------------------------------------------------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  prospect_id uuid references public.prospects (id) on delete set null,
  contract_id uuid references public.contracts (id) on delete set null,
  invoice_number text not null default '',
  amount numeric(10,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  due_date date,
  paid_date date,
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_invoices_org on public.invoices (org_id);
create index if not exists idx_invoices_prospect on public.invoices (prospect_id);
create index if not exists idx_invoices_contract on public.invoices (contract_id);
create index if not exists idx_invoices_status on public.invoices (status);

alter table public.invoices enable row level security;

drop policy if exists "invoices: read org" on public.invoices;
create policy "invoices: read org" on public.invoices
  for select using (org_id = public.my_org_id());

drop policy if exists "invoices: insert self" on public.invoices;
create policy "invoices: insert self" on public.invoices
  for insert with check (auth.role() = 'authenticated' and org_id = public.my_org_id());

drop policy if exists "invoices: update own or owner" on public.invoices;
create policy "invoices: update own or owner" on public.invoices
  for update
  using (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()))
  with check (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()));

drop policy if exists "invoices: owner deletes" on public.invoices;
create policy "invoices: owner deletes" on public.invoices
  for delete using (org_id = public.my_org_id() and public.is_owner());

drop trigger if exists trg_invoices_org on public.invoices;
create trigger trg_invoices_org before insert on public.invoices
  for each row execute function public.stamp_org_id();

drop trigger if exists trg_invoices_touch on public.invoices;
create trigger trg_invoices_touch before update on public.invoices
  for each row execute function public.touch_updated_at();

create or replace function public.log_invoice_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  label text;
begin
  select coalesce(full_name, email) into actor_name from public.profiles where id = auth.uid();
  actor_name := coalesce(actor_name, 'Someone');
  label := nullif(new.invoice_number, '');
  label := coalesce(label, 'an invoice');

  if tg_op = 'INSERT' then
    insert into public.activity_log (actor_id, prospect_id, message, org_id)
    values (auth.uid(), new.prospect_id, actor_name || ' created ' || label, new.org_id);
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.activity_log (actor_id, prospect_id, message, org_id)
    values (auth.uid(), new.prospect_id, actor_name || ' marked ' || label || ' as ' || initcap(new.status), new.org_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_invoices_activity on public.invoices;
create trigger trg_invoices_activity after insert or update on public.invoices
  for each row execute function public.log_invoice_changes();

-- ----------------------------------------------------------------------------
-- 3. PROJECTS  (+ a simple per-project checklist)
-- ----------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  prospect_id uuid references public.prospects (id) on delete set null,
  name text not null,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'blocked', 'complete')),
  start_date date,
  due_date date,
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_org on public.projects (org_id);
create index if not exists idx_projects_prospect on public.projects (prospect_id);
create index if not exists idx_projects_status on public.projects (status);

alter table public.projects enable row level security;

drop policy if exists "projects: read org" on public.projects;
create policy "projects: read org" on public.projects
  for select using (org_id = public.my_org_id());

drop policy if exists "projects: insert self" on public.projects;
create policy "projects: insert self" on public.projects
  for insert with check (auth.role() = 'authenticated' and org_id = public.my_org_id());

drop policy if exists "projects: update own or owner" on public.projects;
create policy "projects: update own or owner" on public.projects
  for update
  using (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()))
  with check (org_id = public.my_org_id() and (public.is_owner() or created_by = auth.uid()));

drop policy if exists "projects: owner deletes" on public.projects;
create policy "projects: owner deletes" on public.projects
  for delete using (org_id = public.my_org_id() and public.is_owner());

drop trigger if exists trg_projects_org on public.projects;
create trigger trg_projects_org before insert on public.projects
  for each row execute function public.stamp_org_id();

drop trigger if exists trg_projects_touch on public.projects;
create trigger trg_projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

create or replace function public.log_project_changes()
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

  if tg_op = 'INSERT' then
    insert into public.activity_log (actor_id, prospect_id, message, org_id)
    values (auth.uid(), new.prospect_id, actor_name || ' started a project — ' || new.name, new.org_id);
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.activity_log (actor_id, prospect_id, message, org_id)
    values (auth.uid(), new.prospect_id, actor_name || ' marked the project "' || new.name || '" as ' || replace(initcap(replace(new.status, '_', ' ')), ' ', ' '), new.org_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_projects_activity on public.projects;
create trigger trg_projects_activity after insert or update on public.projects
  for each row execute function public.log_project_changes();

-- Per-project checklist (deliverables) — a much simpler cousin of
-- daily_tasks: no per-agent completion tracking, just a shared list of
-- done/not-done items scoped to one project.
create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  done boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_tasks_org on public.project_tasks (org_id);
create index if not exists idx_project_tasks_project on public.project_tasks (project_id);

alter table public.project_tasks enable row level security;

drop policy if exists "project_tasks: read org" on public.project_tasks;
create policy "project_tasks: read org" on public.project_tasks
  for select using (org_id = public.my_org_id());

-- Insert/update/delete are open to anyone in the org (not just the project's
-- creator) — a project's checklist is shared delivery work, same spirit as
-- the shared daily checklist, so any teammate helping on it can tick items
-- off or add a new one. The subquery on insert makes sure you can only file
-- tasks under a project you can actually see (i.e. one in your own org).
drop policy if exists "project_tasks: insert org" on public.project_tasks;
create policy "project_tasks: insert org" on public.project_tasks
  for insert with check (
    auth.role() = 'authenticated'
    and org_id = public.my_org_id()
    and exists (select 1 from public.projects pr where pr.id = project_tasks.project_id and pr.org_id = public.my_org_id())
  );

drop policy if exists "project_tasks: update org" on public.project_tasks;
create policy "project_tasks: update org" on public.project_tasks
  for update using (org_id = public.my_org_id());

drop policy if exists "project_tasks: delete own or owner" on public.project_tasks;
create policy "project_tasks: delete own or owner" on public.project_tasks
  for delete using (org_id = public.my_org_id());

drop trigger if exists trg_project_tasks_org on public.project_tasks;
create trigger trg_project_tasks_org before insert on public.project_tasks
  for each row execute function public.stamp_org_id();

-- ----------------------------------------------------------------------------
-- 4. REALTIME  (live updates across every teammate's screen, same as prospects)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'contracts'
  ) then
    alter publication supabase_realtime add table public.contracts;
  end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'invoices'
  ) then
    alter publication supabase_realtime add table public.invoices;
  end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'project_tasks'
  ) then
    alter publication supabase_realtime add table public.project_tasks;
  end if;
end $$;

-- ============================================================================
-- DONE. After running this in the SQL Editor:
--   1. Redeploy the frontend (app/ folder via Netlify Drop) — sw.js's
--      CACHE_VERSION was bumped so every phone picks up the new views.
--   2. New sidebar links: Contracts, Invoices, Projects (under a new
--      "Business" group) — visible to everyone, editing rules enforced by
--      the RLS policies above (draft freely, owner/creator edits, owner
--      deletes).
-- ============================================================================
