-- ============================================================================
-- STUDIO X COMMAND, Client Portal + Grid Plan (content calendar, due dates)
-- ============================================================================
-- What this adds:
--   Wires the existing Grid Plan feature (migration_grid_plans.sql, the
--   drag-and-drop content calendar clients already review via a separate
--   review.html?t=<share_token> link) into the unified client dashboard
--   (app/client.html) added in migration_client_portal.sql, so a client sees
--   their upcoming posts and due dates on the SAME page as their reports and
--   invoices, instead of a second unrelated link.
--
-- Why a separate file instead of editing migration_client_portal.sql:
--   That file already ran in production. This one only touches
--   public.client_portal() (create or replace, same function name and
--   signature), which is exactly as safe to layer on top as every other
--   grid-plan follow-up migration in this project
--   (migration_grid_video_link.sql, migration_grid_rate_limit.sql).
--
-- Why match by name instead of a new foreign key:
--   grid_plans has no prospect_id column, a plan is created with a free-text
--   client_name (see app/js/views/gridPlans.js). Rather than add a column
--   the agency UI doesn't yet have a way to set, this does the same thing
--   any human would: match the plan whose client_name equals this prospect's
--   business_name (case/whitespace-insensitive), scoped to the same org, and
--   only ever a plan the agency has actually shared (never 'draft', same
--   "clients never see drafts" rule as reports/invoices). If more than one
--   matches, the most recently updated one wins, on the assumption that's
--   the current one. A prospect renamed or a plan named differently just
--   means no calendar section shows, same as "no reports yet" today, never
--   an error.
--
-- What it deliberately does NOT return: post content or media. Those still
-- come from the review-load Edge Function (which knows how to mint signed,
-- time-limited URLs into the private grid-media bucket, something a plain
-- SQL function can't do), the client dashboard just now knows which
-- share_token to call it with. See app/js/clientPortal.js.
--
-- Safe to run more than once, create or replace only, touches no rows.
-- ============================================================================

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
  plan public.grid_plans%rowtype;
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

  select * into plan
    from public.grid_plans gp
    where gp.org_id = pros.org_id
      and gp.status <> 'draft'
      and lower(trim(gp.client_name)) = lower(trim(pros.business_name))
    order by gp.updated_at desc
    limit 1;

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
    ), '[]'::json),
    -- Just enough to let the dashboard call the existing review-load /
    -- review-update Edge Functions itself, see app/js/clientPortal.js. The
    -- share_token here is not a new exposure, it's the exact same credential
    -- the client would already have from a review.html link, just handed
    -- over automatically instead of the agency copy-pasting a second link.
    'gridPlan', case when plan.id is null then null else json_build_object(
      'shareToken', plan.share_token,
      'clientName', plan.client_name,
      'accentColor', plan.accent_color,
      'status', plan.status
    ) end
  ) into result;

  return result;
end;
$$;

grant execute on function public.client_portal(text) to anon;
