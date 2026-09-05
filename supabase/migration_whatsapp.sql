-- ============================================================================
-- STUDIO X COMMAND — Migration: WhatsApp Integration (Twilio)
-- ============================================================================
-- Run this once in the Supabase SQL Editor to add what the new two-way
-- WhatsApp feature needs. See SETUP.md Step 146.
-- ============================================================================

-- Tracks when a prospect last messaged you on WhatsApp. WhatsApp only lets a
-- business send free-form replies within 24 hours of the customer's last
-- message — this is how the app knows whether the in-app reply box is
-- allowed to be used right now, or whether the cold-open "Send WhatsApp"
-- button (which hands off to the teammate's own WhatsApp app instead) is
-- the only option.
alter table public.prospects
  add column if not exists whatsapp_last_inbound_at timestamptz;

-- ----------------------------------------------------------------------------
-- WHATSAPP MESSAGES  (two-way conversation thread per prospect)
-- ----------------------------------------------------------------------------
-- One row per WhatsApp message, in either direction. Outbound rows are
-- created by the send-whatsapp function right after Twilio accepts the
-- message; inbound rows (and delivery-status updates to outbound rows) are
-- created/updated by the whatsapp-webhook function whenever Twilio calls it.
-- Client apps never insert into this table directly — only those two
-- backend functions do, using the service-role key.
create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  body text not null default '',
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  twilio_sid text,
  -- Who sent it from inside the app. Null for inbound messages (the
  -- prospect sent those) and null for outbound ones sent before this
  -- column existed.
  sent_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_messages_prospect on public.whatsapp_messages (prospect_id, created_at);

-- Lets the webhook look up "which message is this a delivery-status update
-- for" by Twilio's own message id, and stops the same inbound webhook call
-- (Twilio sometimes retries) from being recorded twice.
create unique index if not exists idx_whatsapp_messages_twilio_sid
  on public.whatsapp_messages (twilio_sid)
  where twilio_sid is not null;

alter table public.whatsapp_messages enable row level security;

-- A conversation thread is about a specific prospect, so only show it to
-- people who can see that prospect (owner, or the team member it's
-- assigned to/added) — same subquery-through-prospects'-own-RLS trick as
-- prospect_notes above.
create policy "whatsapp_messages: read visible prospects" on public.whatsapp_messages
  for select using (
    exists (select 1 from public.prospects p where p.id = whatsapp_messages.prospect_id)
  );
-- No insert/update/delete policy for ordinary clients on purpose — a plain
-- client-side insert wouldn't actually send anything via Twilio, it'd just
-- create a fake-looking message. Only send-whatsapp (outbound) and
-- whatsapp-webhook (inbound + delivery status) ever write to this table.

-- ----------------------------------------------------------------------------
-- WHATSAPP SEND REQUESTS  (invisible rate-limit log, same pattern as
-- research_requests / discovery_requests / copilot_requests)
-- ----------------------------------------------------------------------------
create table if not exists public.whatsapp_send_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_send_requests_by_user on public.whatsapp_send_requests (requested_by, created_at);

alter table public.whatsapp_send_requests enable row level security;
-- No select/insert policies for ordinary clients on purpose — only the
-- send-whatsapp function ever touches this table.

-- ----------------------------------------------------------------------------
-- Realtime: add whatsapp_messages to the same publication every other
-- realtime table in this app already uses, so a new inbound reply or a
-- delivery-status update appears in the thread live, without a refresh.
-- Guarded so re-running this migration doesn't error if it's already added.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_messages'
  ) then
    alter publication supabase_realtime add table public.whatsapp_messages;
  end if;
end $$;
