// ============================================================================
// STUDIO X COMMAND, Public portfolio showcase page (app/portfolio.html)
// ============================================================================
// What this does, in plain language:
//   The page a prospect lands on when the agency sends them a portfolio
//   link. No login, no account, just ?org=<id> in the URL. Unlike
//   review.html (which proxies every read/write through Edge Functions
//   because a client's content calendar is private data), this page talks
//   directly to Supabase with the anon key, because the whole point of a
//   showcase is that it's meant to be public. RLS is the actual gate here:
//   portfolio_settings only returns a row when that org has explicitly
//   flipped "is_public" on, and portfolio_items only ever returns rows the
//   owner explicitly marked "is_published", see
//   supabase/migration_portfolio.sql for the full policy reasoning. Nothing
//   else about the organization (team, pipeline, contracts, etc.) is
//   reachable from here; every other table's RLS is untouched.
//
//   Deliberately self-contained: reuses only the pure-DOM helpers from
//   utils.js (el/esc), not portfolio.js or state.js, since this page has no
//   session/store to hang off of, same convention as review.js.
// ============================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { el, esc } from "./utils.js";

const orgId = new URLSearchParams(location.search).get("org");
const root = document.getElementById("portfolio-root");

// persistSession: false, no login here, and this is often a shared/first
// -time visitor, so nothing about this visit should linger in localStorage.
const sb = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  : null;

function renderMessage(title, body) {
  root.innerHTML = "";
  root.appendChild(el(`
    <div style="max-width:480px;margin:60px auto;padding:0 20px;text-align:center;">
      <div class="page-title mt-0" style="font-size:20px;">${esc(title)}</div>
      <p class="text-faint" style="font-size:13.5px;line-height:1.5;">${esc(body)}</p>
    </div>
  `));
}

function itemCard(item) {
  return el(`
    <div class="card" style="margin-bottom:16px;overflow:hidden;">
      ${item.image_url ? `<img src="${esc(item.image_url)}" alt="" style="width:100%;max-height:340px;object-fit:cover;border-radius:8px;margin-bottom:14px;" />` : ""}
      <div class="flex-between" style="margin-bottom:6px;align-items:flex-start;">
        <div style="font-weight:800;font-size:17px;">${esc(item.title)}</div>
      </div>
      ${item.category || item.client_name ? `
        <div class="text-faint" style="font-size:12.5px;margin-bottom:10px;">
          ${[item.category, item.client_name].filter(Boolean).map(esc).join(" · ")}
        </div>
      ` : ""}
      ${item.summary ? `<p style="font-size:14px;line-height:1.55;margin:0 0 12px;">${esc(item.summary)}</p>` : ""}
      ${item.results ? `
        <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px 12px;margin-bottom:12px;">
          <div class="text-faint" style="font-size:10.5px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:4px;">Results</div>
          <div style="font-size:13.5px;line-height:1.5;">${esc(item.results)}</div>
        </div>
      ` : ""}
      ${item.external_link ? `<a class="btn btn-ghost" href="${esc(item.external_link)}" target="_blank" rel="noopener noreferrer" style="width:auto;display:inline-block;padding:8px 18px;">View Project</a>` : ""}
    </div>
  `);
}

async function load() {
  if (!sb) return renderMessage("Not available", "This page isn't configured correctly. Please contact the agency directly.");
  if (!orgId) return renderMessage("Portfolio not found", "This link is missing some information, please ask the agency for a fresh link.");

  root.innerHTML = `<div style="text-align:center;padding:60px 20px;" class="text-faint">Loading…</div>`;

  const { data: settings } = await sb.from("portfolio_settings").select("*").eq("org_id", orgId).eq("is_public", true).maybeSingle();
  if (!settings) {
    return renderMessage("Portfolio not available", "This showcase isn't public right now, please ask the agency for a fresh link.");
  }

  const { data: items } = await sb
    .from("portfolio_items")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_published", true)
    .order("sort_order", { ascending: true });

  root.innerHTML = "";
  const wrap = el(`
    <div style="max-width:640px;margin:0 auto;padding:40px 18px 60px;">
      <div style="text-align:center;margin-bottom:32px;">
        <div class="page-title mt-0" style="font-size:26px;">${esc(settings.headline || "Our Work")}</div>
        ${settings.tagline ? `<p class="text-faint" style="font-size:14px;max-width:420px;margin:8px auto 0;line-height:1.5;">${esc(settings.tagline)}</p>` : ""}
      </div>
      <div id="pfp-list"></div>
    </div>
  `);
  root.appendChild(wrap);

  const listEl = wrap.querySelector("#pfp-list");
  if (!items || !items.length) {
    listEl.appendChild(el(`
      <div class="empty-state">
        <p>Nothing published here yet. Check back soon.</p>
      </div>
    `));
    return;
  }
  items.forEach((item) => listEl.appendChild(itemCard(item)));
}

load();
