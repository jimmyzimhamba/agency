# Studio X Command — Setup Checklist

Follow these steps in order. It takes about 10 minutes. You don't need to know how to code — just click where I say click, and copy/paste where I say copy/paste.

---

## Step 1 — Create your free Supabase account

1. Go to **supabase.com** and click **Start your project**.
2. Sign up (GitHub sign-in is fastest, or use an email + password).
3. Click **New project**.
4. Fill in:
   - **Name**: `studio-x-command` (or anything you like)
   - **Database password**: click "Generate a password" and **save it somewhere safe** (a notes app is fine) — you won't need it day-to-day, but keep it just in case.
   - **Region**: pick the one closest to Harare (usually an EU or South Africa region — whichever is closest/lowest latency in the list).
5. Click **Create new project**. Wait 1–2 minutes while Supabase sets it up (there's a progress spinner).

---

## Step 2 — Build the database (paste one file, click Run)

> Already have a live Studio X Command / Agency Command database from before
> multi-tenancy was added? Don't run this file — use
> **`supabase/migration_organizations.sql`** instead, which upgrades your
> existing database in place without touching any of your real data. This
> step (and the rest of this checklist) is only for a brand-new, empty
> Supabase project.
>
> Already on a live database and just want Contracts/Invoices/Projects
> (added after multi-tenancy)? Skip straight to **Step 12** at the bottom —
> that's a separate, standalone migration file you can run any time.
>
> Just want profile pictures (Step 13)? Same deal — it's a standalone file
> too, run it whenever.

1. In your new project, click **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open the file **`supabase/schema.sql`** from this project folder, select all the text, and copy it.
4. Paste it into the SQL Editor box in Supabase.
5. Click **Run** (bottom right, or Ctrl/Cmd + Enter).
6. You should see "Success. No rows returned." That means every table, security rule, and one starter organization (with starter niches, message templates, and daily tasks) was created in one shot.

---

## Step 3 — Get your two connection keys

1. Still in Supabase, click the **gear icon (Project Settings)** in the left sidebar.
2. Click **API** in the settings menu.
3. You'll see two things you need:
   - **Project URL** — looks like `https://abcdxyz.supabase.co`
   - **anon public** key — a long string of letters/numbers under "Project API keys"
4. Keep this tab open — you'll copy these in the next step.

---

## Step 4 — Paste your keys into the app

1. Open the file **`app/js/config.js`** in this project folder.
2. Replace `PASTE_YOUR_SUPABASE_PROJECT_URL_HERE` with your **Project URL**.
3. Replace `PASTE_YOUR_SUPABASE_ANON_PUBLIC_KEY_HERE` with your **anon public** key.
4. Save the file.

(If you're not comfortable editing this yourself, just tell me you've created the Supabase project and paste me the URL and anon key in chat — I'll fill it in for you.)

---

## Step 5 — Turn off "Confirm email" (recommended for a small team)

By default, Supabase makes new users click a confirmation link in their email before they can log in. For a small internal team, it's simpler to skip that:

1. In Supabase, click **Authentication** in the left sidebar.
2. Click **Sign In / Providers** (or **Settings**, depending on the current Supabase layout).
3. Find **Confirm email** (sometimes called "Email confirmations required") and turn it **off**.
4. Save.

(If you'd rather keep email confirmation on for security, that's fine too — just know your team will need to click a link in their inbox the first time they sign up.)

---

## Step 6 — Create your own account and make yourself the Owner

Since Agency Command supports multiple agencies on one shared database, sign-up now asks "New agency" or "Join a team." Step 2 already seeded one starter organization with the starter niches/message kit/task board — join that one so you inherit all of it, rather than starting a second, empty organization by accident.

1. First, look up the starter organization's invite code — in Supabase, **SQL Editor** → **New query**:
   ```sql
   select invite_code from public.organizations order by created_at asc limit 1;
   ```
   Click **Run** and copy the code shown (a short string like `a1b2c3d4`).
2. Open the app (I'll give you the link once it's deployed — see below).
3. On the sign-in screen, tap **Create account**, then choose **Join a team**.
4. Enter your name, email, and a password (at least 6 characters), and paste the invite code from step 1. Tap **Create account**.
5. You're now logged in as a regular **agent**. To make yourself the **owner** (so you can see all stats, manage the team, edit niches, etc.), go back to Supabase:
   - Click **SQL Editor** → **New query**.
   - Paste this, replacing the email with the one you just signed up with:
     ```sql
     update public.profiles set role = 'owner' where email = 'you@studioxmarketing.com';
     ```
   - Click **Run**.
6. Reload the app on your phone/browser. You're now the Owner.

(If you'd rather start with a completely clean slate instead of the seeded starter niches/templates, choose **New agency** at sign-up instead — you'll still need the same SQL promotion step above to become its Owner.)

---

## Step 7 — Invite your team

Once you're the Owner, open **Team & Settings** in the app — your agency's invite code is shown there with a **Copy** button (and a **Regenerate Code** button if it ever leaks). Share that code with your teammates, along with the app link. Each person:
1. Opens the link, taps **Create account**, chooses **Join a team**.
2. Enters their name, email, password, and your agency's invite code.
3. They're automatically added as an **agent** in your agency — able to see the shared pipeline, work assigned leads, log activity, etc.

You (the owner) will see them appear in the **Team** view automatically. Only share the invite code with your actual team — anyone with it can join your agency.

---

That's the entire backend setup. Once this is done, the app is fully live — everyone's phone talks to the same shared database in real time.

---

## Step 8 — Turn on AI Research (auto-generated outreach messages)

This is optional, but it's the feature that makes adding a prospect turn into a ready-to-send message automatically. It costs a small, predictable amount per prospect — full honesty on that below. Takes about 10 minutes, one-time.

### 8.1 — Add the new database fields

1. In Supabase, click **SQL Editor** → **New query**.
2. Open **`supabase/migration_ai_research.sql`** from this project folder, select all, copy it.
3. Paste into the SQL Editor and click **Run**.
4. "Success. No rows returned." means it worked. Safe to run even twice.

### 8.2 — Get a free Anthropic account and an API key

This is the AI that does the research and writes the messages (same company that makes Claude, the AI you're talking to right now).

1. Go to **console.anthropic.com** and sign up (email + password, or Google sign-in).
2. Unlike Supabase, Anthropic's API isn't free to use — you'll need to add a card and load a small amount of prepaid credit under **Billing**. **$5 is plenty to start** — realistically, each prospect researched costs about **3–8 cents** (a capped 3 web searches plus a tiny bit of AI text generation), so $5 covers roughly 60–150 prospects.
3. Once billing is set up, go to **API Keys** in the left sidebar → **Create Key**. Give it any name (e.g. "Studio X Command").
4. Copy the key that appears (starts with `sk-ant-...`) — you'll paste it in the next step. You won't be able to see it again after you leave this page, so copy it now.

**This key never goes into the app or any file in this project** — it only ever lives inside Supabase's secure backend, in the next step.

### 8.3 — Deploy the research function

1. In Supabase, click **Edge Functions** in the left sidebar.
2. Click **Create a new function** (or **Deploy a new function**).
3. Name it exactly: `research-prospect`
4. Open **`supabase/functions/research-prospect/index.ts`** from this project folder, select all, copy it.
5. Paste it into the code editor that opens in Supabase, replacing whatever placeholder code is there.
6. Click **Deploy**.

### 8.4 — Add your API key as a secret

1. Still in **Edge Functions**, find **Secrets** (sometimes called **Manage secrets**, usually a tab or button near the top of the Edge Functions page).
2. Add a new secret:
   - **Name**: `ANTHROPIC_API_KEY`
   - **Value**: the `sk-ant-...` key you copied in Step 8.2.
3. Save.

### 8.5 — Try it on a real business

1. Open the app, tap **+** to add a prospect.
2. Fill in the business name (and area/Instagram/website if you have them) — **leave the Outreach message box blank**.
3. Tap **Add Prospect**. You'll see "researching this business online..." — open that prospect's card after about a minute and you'll see a ready-to-send 3-line message plus a "what we found" summary.
4. If it can't verify anything specific about that business online, you'll instead see a general niche-based opener clearly marked **"auto-template — review before sending"** — nothing sends itself either way; a teammate always taps Send inside WhatsApp.

### What this costs, plainly

- **Web search**: $10 per 1,000 searches. Each prospect is capped at 3 searches (≈3 cents), even if Claude would want to search more.
- **AI writing**: a fraction of a cent per prospect (Studio X Command uses Anthropic's cheapest model, Claude Haiku, on purpose).
- **Typical total**: roughly **3–8 cents per prospect researched**.
- **Safety cap**: no single teammate can trigger more than **20 researches per hour** — built into the backend function, not adjustable from the app. This means even if someone accidentally adds a big batch of prospects back-to-back, there's a hard ceiling on how much that can cost before it simply stops and asks them to wait.
- Bulk-imported prospects (via **Bulk Import**) are never auto-researched — only prospects added one at a time through the **+ Add Prospect** button, and only when the message box is left blank.
- You can watch actual spend anytime in the Anthropic Console under **Billing** → **Usage**.

If you'd rather skip this feature entirely, that's fine — everything else in the app works exactly as before, and teammates can keep writing/picking messages by hand.

---

## Step 9 — Turn on the City filter (Harare / Bulawayo)

One-time database update, takes under a minute.

1. In Supabase, click **SQL Editor** → **New query**.
2. Open **`supabase/migration_city_filter.sql`** from this project folder, select all, copy it, paste into the SQL Editor, and click **Run**.
3. Reload the app. The Pipeline screen now has a row of city chips (Harare, Bulawayo, and any others you've used) right under the tier filters — tap one to see just that city's prospects. Every existing prospect is automatically set to **Harare** since that's been the only market so far; new ones default to Harare too but you can change it in the Add/Edit Prospect form or via Bulk Import.

---

## Step 10 — Turn on pop-up notifications

Optional. This pings a teammate's phone/browser the moment a prospect is added (owners get pinged) or assigned to them (that teammate gets pinged) — even if Agency Command isn't open. Takes about 10 minutes, one-time.

### 10.1 — Add the database table

1. In Supabase, click **SQL Editor** → **New query**.
2. Open **`supabase/migration_push_notifications.sql`**, select all, copy, paste into the SQL Editor, click **Run**.

### 10.2 — Deploy the send-push function

1. In Supabase, click **Edge Functions** in the left sidebar → **Create a new function** (or **Deploy a new function**).
2. Name it exactly: `send-push`
3. Open **`supabase/functions/send-push/index.ts`** from this project folder, select all, copy it, and paste it into the code editor, replacing the placeholder.
4. Click **Deploy**.

### 10.3 — Add the notification signing keys as secrets

These two values let the backend prove the notifications really came from your app (they're already generated for you — no account or sign-up needed for this part):

1. Still in **Edge Functions**, find **Secrets** (sometimes **Manage secrets**).
2. Add two secrets:
   - **Name**: `VAPID_PUBLIC_KEY` — **Value**: `BIXko_6kDEnqXV9T9PuuFoXlT7SAGxKrkxWobxwOdgz3rzsURjvnkPVNTAYS9BDJk-vlR7fBgNkXai4yrW3FbXs`
   - **Name**: `VAPID_PRIVATE_KEY` — **Value**: `DFpCu4cRO12e7WC1XR6wt29mvVEb3uDUtlVJ7hjqNx4`
3. (Optional) Add a third secret **`VAPID_SUBJECT`** set to `mailto:you@studioxmarketing.com` (or your real contact email) — some browsers use this to reach you if a subscription looks abusive. Skips fine without it; it falls back to that same address.
4. Save.

The matching **public** key is already saved in `app/js/config.js` (`VAPID_PUBLIC_KEY`) — that half is safe to be public, it can only prove a push came from this app, never send one. **Never paste the private key into the app itself** — it only ever belongs in this Edge Function secret.

### 10.4 — Try it

1. Open the app on your phone, go to **More → Team & Settings**, and tap **Turn On** under **Notifications**. Approve the browser's permission prompt.
2. Have a teammate add a test prospect (or assign one to you from another device/account). You should get a pop-up within a few seconds, even with the app closed.
3. If nothing arrives: double-check both secrets were saved exactly as above (no extra spaces), and that notifications are actually allowed for this site in your phone's browser settings — that's the most common snag, especially on iPhone (needs the app **installed to your Home Screen** first — see **Get the App** in the More menu — plain Safari tabs can't receive push on iOS).

If you'd rather skip this, that's fine too — everything else works exactly as before, and the app still shows in-app toasts for your own actions either way.

---

## Step 11 — Turn on "Remove access" for team members

Lets you (the owner) lock a teammate out of the app — e.g. someone leaves the team — without deleting anything they ever did. Their name still shows correctly on every prospect, note, and activity entry they touched; you can restore their access any time. Takes under 5 minutes, one-time.

### 11.1 — Add the database field

1. In Supabase, click **SQL Editor** → **New query**.
2. Open **`supabase/migration_team_access.sql`**, select all, copy, paste into the SQL Editor, click **Run**.

### 11.2 — Deploy the manage-team-member function

1. In Supabase, click **Edge Functions** → **Create a new function** (or **Deploy a new function**).
2. Name it exactly: `manage-team-member`
3. Open **`supabase/functions/manage-team-member/index.ts`** from this project folder, select all, copy it, and paste it into the code editor, replacing the placeholder.
4. Click **Deploy**.

No secrets to add for this one — it only uses the same auto-injected Supabase keys the other functions already use.

### 11.3 — Try it

1. Open the app, go to **More → Team & Settings**.
2. Next to any teammate (not yourself), tap **Remove access**, confirm. They're immediately signed out and can't log back in — but you'll still see their name on their past prospects and activity.
3. Tap **Restore access** any time to let them back in.

Notes: you can't remove your own access, and the app won't let you remove the last remaining Owner (so the team can never get locked out entirely). If you'd rather skip this, everything else still works exactly as before — team members just can't be individually locked out from within the app.

---

## Step 12 — Turn on Contracts, Invoices & Projects

Adds three new tabs (sidebar: **Business** group, or phone: **More**) for what happens after a prospect signs — drafting/tracking contracts, billing invoices, and running delivery projects with a simple per-project checklist. Same permissions pattern as everything else: anyone can create one, the owner or whoever created it can edit it, only the owner can delete it. No new external services, no new secrets.

1. In Supabase, click **SQL Editor** → **New query**.
2. Open **`supabase/migration_phase3_business_ops.sql`**, select all, copy, paste into the SQL Editor, click **Run**. You should see "Success. No rows returned."
3. Redeploy the frontend (`app/` folder) via Netlify Drop, same as any other update — the service worker's cache version was bumped so every phone picks up the new tabs automatically within a few seconds of reopening the app.
4. Open the app — you'll see **Contracts**, **Invoices**, and **Projects** under the **Business** group in the sidebar (or under **More** on phone). On a **Signed** prospect's detail sheet, you'll also see quick "Contract / Invoice / Project" buttons that pre-fill the link to that prospect.

If you're setting this up on a brand-new/empty Supabase project instead, you don't need this file separately — `supabase/schema.sql` (Step 2) already includes these tables.

---

## Step 13 — Turn on profile pictures

Lets anyone tap **Edit** on their own profile card (Team tab) to change their display name and upload a real photo, which then shows up everywhere their initials-circle used to (sidebar, team roster, prospect assignments, dashboard). If you skip this step, everything still works exactly as before — people just keep the colored-initials circle.

1. In Supabase, click **SQL Editor** → **New query**.
2. Open **`supabase/migration_phase4_avatars.sql`**, select all, copy, paste into the SQL Editor, click **Run**. You should see "Success. No rows returned." This adds one column to `profiles` and creates a public `avatars` storage bucket with per-user upload permissions (you can only ever overwrite your own photo, never someone else's).
3. Redeploy the frontend (`app/` folder) via Netlify Drop.
4. Open the app → **Team** → tap **Edit** on your own profile card at the top → tap your avatar or **Change Photo** to upload a picture, and/or edit your name → **Save Changes**.

If you're setting this up on a brand-new/empty Supabase project instead, you don't need this file separately — `supabase/schema.sql` (Step 2) already includes the `avatar_url` column and the storage bucket.

---

## Step 14 — Turn on overdue invoice alerts

Once a day, checks every invoice marked **Sent** whose due date has passed and never got paid, and pings whoever created it plus every Owner with a pop-up — even if nobody has the app open. Each invoice only ever pings once. Needs Step 10 (pop-up notifications) done first — this reuses the same signing keys. Takes about 10 minutes, one-time.

### 14.1 — Deploy the check-overdue-invoices function

1. In Supabase, click **Edge Functions** → **Create a new function** (or **Deploy a new function**).
2. Name it exactly: `check-overdue-invoices`
3. Open **`supabase/functions/check-overdue-invoices/index.ts`** from this project folder, select all, copy it, and paste it into the code editor, replacing the placeholder.
4. Click **Deploy**.

No new secrets needed for the push part — it reuses the `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` secrets from Step 10.

### 14.2 — (Optional but recommended) set a cron secret

This one isn't triggered by a person clicking something in the app — it wakes up on a timer — so there's no login token to check like the other functions have. A shared secret keeps randoms from pinging it directly.

1. Still in **Edge Functions** → **check-overdue-invoices** → **Secrets**.
2. Add a secret named **`CRON_SECRET`** — value can be anything, e.g. a random password you make up (open any password generator, or just mash the keyboard — nobody needs to memorize it).
3. Save it somewhere you'll be able to copy from in the next step.

If you skip this, the function still works — it just won't check who's calling it.

### 14.3 — Add the database column and schedule the daily check

1. In Supabase, click **SQL Editor** → **New query**.
2. Open **`supabase/migration_phase5_overdue_invoices.sql`**, select all, and copy it into the SQL Editor.
3. Find the line near the bottom that says `'x-cron-secret', 'PASTE_YOUR_CRON_SECRET_HERE'` — if you set a `CRON_SECRET` in 14.2, replace `PASTE_YOUR_CRON_SECRET_HERE` with that exact same value. If you skipped 14.2, leave it as-is, it's harmless.
4. Click **Run**. You should see "Success. No rows returned." This adds one column to `invoices`, turns on the `pg_cron`/`pg_net` extensions (built into every Supabase project), and schedules the daily check for 9:00am UTC.

### 14.4 — Try it

The easiest way to test without waiting a full day: open any **Sent** invoice in the app and set its due date to yesterday, then in Supabase go to **Edge Functions** → **check-overdue-invoices** → find the **Invoke**/**Test** button and run it manually (or wait for the next 9am UTC run). Whoever created that invoice, plus every Owner with notifications turned on, should get a pop-up within a few seconds.

If you're setting this up on a brand-new/empty Supabase project instead, you don't need the migration file separately — `supabase/schema.sql` (Step 2) already includes the `overdue_notified_at` column and the cron schedule (still fill in your own `CRON_SECRET` there if you want one).

---

## Step 15 — Revenue by Niche / Tier

Adds two breakdowns to the **Pipeline Value** tab — total monthly recurring revenue (and client count) grouped by niche, and separately by tier (A/B/C) — built entirely from your existing signed prospects. No new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Pipeline Value** → scroll past "What We're Seeing" to see **Revenue by Niche** and **Revenue by Tier**. Fills in automatically as prospects get marked Signed with a niche/tier/MRR set on them.

---

## Step 16 — Recurring invoice prompts

When you mark an invoice **Paid** (and it's linked to a client), you'll now be offered a one-tap draft of next month's invoice — same amount, same client/contract, due date rolled forward one calendar month. Skips the prompt automatically if a later invoice for that client already exists, so it won't nag you every time you re-open a paid invoice. No new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open any **Sent** invoice with a client linked → mark it **Paid** → **Save Changes**. You'll see a "Draft next month's invoice?" prompt.

---

## Step 17 — Export Pipeline to CSV

Adds an **Export CSV** link next to Bulk Import on the Pipeline tab. Downloads whatever's currently filtered/searched (business name, niche, city, area, contact info, tier, status, heat score, MRR, assignee, follow-up date) as a spreadsheet-ready file — handy for reporting, or handing a filtered list to someone outside the app. Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Pipeline** → (optionally filter/search down to what you want) → tap **Export CSV**.

---

## Step 18 — Global search

One search box that finds matches across prospects, contracts, invoices, and projects at once (not just whatever tab you're on) — matches by business name, area/city, contract title, invoice number, project name, or the client any of those are linked to. Tapping a result opens it directly, same as tapping it from its own tab. Desktop gets a search bar pinned in the sidebar with a dropdown; phone gets a search icon in the top bar that opens the same results in a sheet. Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Desktop: click into the search bar at the top of the left sidebar and start typing (2+ characters). Phone: tap the magnifying-glass icon in the top bar.

---

## Step 19 — "Needs Follow-up" dashboard widget

Flags active leads (not Signed or Dead) that haven't been touched — no status change, no reassignment, no edit — in 5+ days, so a prospect can't quietly go cold just because nobody remembered to set a follow-up date on it. Separate from the existing "Due Today" bell, which only catches leads someone manually scheduled a reminder on. Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Dashboard** → under **Needs Follow-up** (right below the Monthly Revenue Goal card) you'll see a live count. Tap it to see the list, sorted most-stale-first; tap any prospect to jump straight to their detail sheet.

---

## Step 20 — Saved filter views on Pipeline

Lets anyone save their current combo of Pipeline filter chips (status/tier/city/niche/"Assigned to me"/sort) as a named shortcut, so re-checking e.g. "Harare, Tier A, cold" is one tap instead of five clicks every time. Personal to each device/browser (stored locally, not shared with teammates) — nothing to set up on the backend. Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Pipeline** → tap **+ Save View** below the search bar after setting up filters you want to keep. Tap a saved chip to reapply it instantly; tap the ✕ on a chip to delete it.

---

## Step 21 — Duplicate prospect detection

Catches likely duplicate leads before they clutter the pipeline — matched on a normalized business name (case/punctuation-insensitive) or a matching WhatsApp number (last 9 digits, so `0771234567` and `263771234567` count as the same number). Warns, doesn't hard-block, since two real locations can share a name.

- **Adding one prospect** (Pipeline "+" button): if a match is found, a "Possible duplicate" prompt shows the existing lead's name and current status before saving — pick **Add Anyway** to proceed, or **Cancel** to go back and check the pipeline first.
- **Bulk import**: the preview screen flags any row that matches either an existing prospect *or* an earlier row in the same pasted batch (easy to do by accident copying from a big spreadsheet). Flagged rows are skipped by default — check the box next to a flagged row to import it anyway.

Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.

---

## Step 22 — Bulk actions on Pipeline

Select multiple prospect cards at once and apply one change to all of them — set status, assign/unassign to a teammate, or mark dead — instead of opening each prospect individually. Uses a single batched `update ... where id in (...)` call per action, so bulk-updating 30 leads is one request, not 30. Entirely client-side/API-only, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Pipeline** → tap **Select** (top right, next to Export CSV). Tap cards to check them off, then use the bar that appears above the bottom nav: **Status**, **Assign**, or **Mark Dead**. Tap **Cancel** to exit select mode.

---

## Step 23 — Win-Back Candidates dashboard widget

Surfaces dead leads that have sat untouched for 60+ days — a business that wasn't interested six months ago might have new management, a new budget, or better timing now. Separate from "Needs Follow-up" (which only tracks *active* leads going cold). Tapping a candidate in the list either opens its full detail sheet, or — one tap — **Reopen**, which resets it straight back to Not Contacted so it re-enters the active pipeline. Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Dashboard** → under **Win-Back Candidates** (below Needs Follow-up) you'll see a live count. Tap it to see the list, longest-dead first; tap **Reopen** on any row to bring it back into the active pipeline, or tap the name to open its detail sheet.

---

## Step 24 — Print / Save as PDF for Invoices & Contracts

Lets anyone turn an invoice or contract into a clean, shareable PDF straight from the browser — no PDF library added. Opening an existing invoice or contract now shows a **Print / Save as PDF** button that fills a hidden letterhead-style document (org name, party details, line items/terms, signature block for contracts) and calls the browser's native print dialog, where "Save as PDF" is already a built-in destination on every desktop and mobile browser. Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Invoices** or **Contracts** → open any existing one → tap **Print / Save as PDF** near the bottom of the sheet → in the print dialog, choose **Save as PDF** (or print physically) as the destination.

---

## Step 25 — Revenue at Risk dashboard widget

Signed clients can quietly slip away even after the deal's won — flags any signed client showing an overdue invoice, a blocked project, or (30+ days on) no invoice ever raised at all. Same "flag it, don't guess why" pattern as Needs Follow-up / Win-Back, but aimed at protecting revenue already won instead of reviving dead leads. Only shows up once there's some contract/invoice/project data in the org. Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Dashboard** → under **Revenue at Risk** (below Business Snapshot) you'll see a live count. Tap it to see which clients and why — each one is tagged with its specific warning sign(s); tap a row to open that client's detail sheet.

---

## Step 26 — Monthly team leaderboard

Ranks the whole team by deals signed this month (🥇🥈🥉 for the top 3), front and center above the existing unranked "This Week — Team" breakdown. Pulled from `status_history`, which every team member can read org-wide under RLS — unlike the `prospects` table itself, where a non-owner only sees their own assigned/created leads — so the board is accurate for everyone, not just the owner. Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Dashboard** → **This Month — Leaderboard** (above This Week — Team) shows everyone who's signed a deal this month, ranked highest to lowest.

---

## Step 27 — Win Rate by Niche & Agent on Pipeline Value

Revenue by Niche/Tier (already on the Pipeline Value page) answers "where's the money" — this answers "where does outreach actually convert." Two new grids show win rate (signed ÷ everyone actually contacted, i.e. not left at Not Contacted) per niche and per agent, with the raw `signed/total` count shown underneath each percentage so small sample sizes stay obvious rather than getting hidden. Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Pipeline Value** → scroll past Revenue by Tier to **Win Rate by Niche** and **Win Rate by Agent**.

---

## Step 28 — Add to Calendar (.ics export)

Turns a follow-up date, invoice due date, or project due date into a one-tap download that any calendar app (Google, Apple, Outlook) opens straight into a reminder — no need to re-type the date by hand or rely on the in-app bell alone. Generates a plain-text `.ics` file client-side (no calendar API/library, same "browser already knows how to do this" approach as Print/PDF export). Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → any **prospect's detail sheet** with a follow-up date set → tap **+ Calendar** next to the date field. Or open an existing **invoice** → tap **Add Due Date to Calendar**. Or open a **project** with a due date → tap **Add Due Date to Calendar**. Open the downloaded `.ics` file to add it to your calendar app.

---

## Step 29 — "Signed, No MRR Set" data-quality flag on the Dashboard

A prospect marked **signed** but left at $0 MRR is almost always a forgotten retainer field, not an intentional free deal — and it silently understates the Monthly Revenue Goal progress bar, Revenue by Niche/Tier, and the Pipeline Value win-rate grids, since all of them derive their totals from `mrr`. A new **Data Check** card on the Dashboard counts these and lets you tap through to fix them, the same way Revenue at Risk and Needs Follow-up already work. Entirely client-side (reads `store.prospects`, already loaded), no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Dashboard** → **Data Check** card. Tap it to see any signed client missing an MRR value, then tap a row to jump straight to that prospect and fill it in.

---

## Step 30 — Send Payment Reminder (WhatsApp) from Invoices

An overdue invoice used to be just a badge — now it's an action. Any **sent** invoice with a linked prospect who has a WhatsApp number saved gets a one-tap **Send Payment Reminder** button, both right on the invoice card in the list (only shows once it's overdue) and inside the invoice sheet itself (shows any time it's sent, so you can nudge before the due date too). The message wording adjusts automatically — "was due X and is still outstanding" once it's overdue, a softer "is due X" beforehand — built client-side from data already loaded (`store.invoices` + the linked prospect's `whatsapp_number`), opened via the same `wa.me` click-to-chat link the pipeline outreach button already uses. No new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Invoices** → any invoice marked **Overdue** with a linked client that has a WhatsApp number → tap **Send Payment Reminder** (on the card, or inside the invoice sheet). It opens WhatsApp with a pre-written reminder ready to send.

---

## Step 31 — Unassigned Leads widget on the Dashboard (owners)

An active lead nobody's assigned to doesn't show up on any one agent's plate — it can just sit there until somebody happens to notice. A new **Unassigned Leads** card on the Dashboard counts active (not signed/dead) prospects with no `assigned_to`, so an owner can spot and assign them before they go cold. Owner-only, since a non-owner only ever sees prospects assigned to (or created by) them under RLS — the same reasoning already applied to the Monthly Leaderboard's data source. Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Sign in as an **owner** → **Dashboard** → **Unassigned Leads** card. Tap it to see the list, then tap a row to jump into that prospect and assign it.

---

## Step 32 — Overdue Projects widget on the Dashboard

A project can sit as "In Progress" and still be late — the existing "Project blocked" flag inside Revenue at Risk only catches ones that stalled for a known reason, not ones that just quietly slipped past their due date. A new **Overdue Projects** card (next to Revenue at Risk, inside the Business Snapshot section) counts any non-complete project whose due date has passed, so a missed deadline gets caught before the client notices it first. Entirely client-side (`store.projects`, already loaded), no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Dashboard** → **Overdue Projects** card (shows once you have at least one contract, invoice, or project on record). Tap it to see the list, then tap a row to jump into that project.

---

## Step 33 — CSV Export for Contracts & Invoices

Pipeline already had "Export CSV" for handing prospect data off to a spreadsheet — Contracts and Invoices now get the same, for handing a batch of billing/legal records off to an accountant or bookkeeper without giving them app access. Each export respects whatever status filter chip is currently active (e.g. exporting just "Overdue" invoices), and downloads instantly as a `.csv` file — same `toCSV`/`downloadTextFile` mechanism as Pipeline's export, no new library. Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Contracts** or **Invoices** → tap **Export CSV** (top right, next to "+ New"). Optionally filter by status chip first to export just that subset.

---

## Step 34 — Team Workload widget on the Dashboard (owners)

This Week — Team already shows recent *activity* (sends, replies, meetings, signs) — it doesn't show current *load*. A new **Team Workload** section lists each agent's count of currently-active leads (not signed/dead), sorted highest-first with a bar underneath, so an owner can spot who's overloaded and who has room before reassigning. Tap an agent's row to see their exact list of active leads. Owner-only, same RLS reasoning as Unassigned Leads (a non-owner's `store.prospects` is limited to their own). Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Sign in as an **owner** → **Dashboard** → **Team Workload** section (between the Leaderboard and This Week — Team). Tap any agent's row to see their active leads.

---

## Step 35 — Send Contract via WhatsApp

Invoices already had a one-tap WhatsApp send (Step 30's payment reminder) — Contracts now get the equivalent: any existing contract with a linked client who has a WhatsApp number saved gets a **Send via WhatsApp** button in the contract sheet, opening a pre-written message with the contract title, value, and a status-aware line ("ready for your signature," "which we now both have signed," etc.). Entirely client-side, reuses the same `buildWhatsAppLink()` helper the invoice reminder and pipeline outreach already use. No new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Contracts** → any existing contract with a linked client that has a WhatsApp number → tap **Send via WhatsApp**. It opens WhatsApp with a pre-written message ready to send.

---

## Step 36 — Save Contact (vCard export) on Prospect Detail

A hot lead's number lives inside the app, but the sales rep's phone doesn't know about it — no way to call or text them outside WhatsApp without retyping the number by hand. A new **Save Contact** link on the Contact card of any prospect with a WhatsApp number or email downloads a standard `.vcf` file (name, phone, email, niche/area as a note) that any phone imports straight into its native Contacts app on tap. Same plain-text-file approach as the existing `.ics` calendar export — no library, no server round-trip. Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → any **prospect** with a WhatsApp number or email saved → **Save Contact** (top right of the Contact card). Open the downloaded `.vcf` file to add it to your phone's contacts.

---

## Step 37 — Live Preview in the Message Kit editor

A `{{token}}` typo used to only get caught the first time an agent actually sent the message to a real client. Now, while creating or editing any template, a **Live Preview** box below the message field re-renders on every keystroke using `personalizeMessage()` against a real prospect (preferring one in the currently-selected niche, so it previews against who the template will actually reach) — so a broken token shows up as literal `{{text}}` in the preview immediately, before saving. Falls back to a sample business if the org has no prospects loaded yet. Entirely client-side, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Message Kit** → **+ New** or edit any existing template → type in the **Message** field and watch the **Live Preview** update below it.

---

## Step 38 — Niche Template Coverage Flag

A niche can end up with active prospects but no niche-tagged Opener template — agents either improvise a first message or grab a generic one that doesn't mention the niche's actual pitch. Niche cards now show a **"No opener template"** pill whenever a niche has active (non-signed, non-dead) prospects and no Opener tagged to it. Tapping the pill jumps straight into **+ New Template**, pre-filled with Category = Opener and Niche = that niche, so fixing the gap is one tap away instead of a hunt through the Message Kit. Entirely client-side, reuses the existing template form — no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Niche Strategy** → any niche card with active prospects and no opener will show a **No opener template** pill. Tap it, fill in the message, and save.

---

## Step 39 — This Week Ahead (forward-looking follow-up planner)

"Due Today" only ever looks backward — it tells you what's overdue or due right now, never what's coming. The Daily Plan page now has a **This Week Ahead** section that groups every prospect with a follow-up date in the next 7 days by day ("Tomorrow", "Fri, Aug 28", etc.), so agents can plan their week instead of only reacting day-to-day. Same visibility rule as Due Today: agents see their own upcoming follow-ups, owners see everyone's. Tap any row to jump straight into that prospect. Reuses the existing `follow_up_date` column — no new tables, no new secrets, purely a new client-side grouping over data already loaded.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Daily Plan** → **This Week Ahead** section, below Your Targets Today. Tap any prospect to open their detail page.

---

## Step 40 — Global Keyboard Shortcuts (desktop)

Power users on a laptop/desktop shouldn't have to reach for the mouse for everything. New shortcuts, active anywhere in the app except while actually typing in a field:

- `/` or `Cmd/Ctrl+K` — focus the sidebar search
- `n` — add a new prospect
- `1` `2` `3` `4` — jump to Dashboard / Pipeline / Daily Plan / Message Kit
- `Esc` — close the open sheet or modal
- `?` — show the shortcuts list (also under **More → ⌨️ Keyboard Shortcuts**)

They're deliberately inert while a form field is focused or another sheet/modal is already open, so they never hijack normal typing or double-fire. Entirely client-side, no new tables, no new secrets — and harmless on phones, since nothing fires without a physical keyboard.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. On a desktop browser, press `?` anywhere in the app to see the full shortcut list, or try `/` to jump into search.

---

## Step 41 — Dashboard as the landing page

The app used to open straight into Pipeline, but Dashboard — the overview of what needs attention today — is the more useful first thing to see, and it's what the desktop sidebar already listed first. Fixed the mismatch:

- Sign-in now lands on **Dashboard** instead of Pipeline (on both phone and desktop).
- The mobile bottom nav now shows **Dashboard, Pipeline, Tasks, Messages, More** (Dashboard moved to the first/leftmost tab, matching the desktop sidebar's order) — same tabs, just reordered.
- The `1`/`2` desktop keyboard shortcuts (Step 40) were re-numbered to match: `1` = Dashboard, `2` = Pipeline.

Pure reordering/config change — no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Sign in (or reload) — you should land on **Dashboard**, and on phone the bottom nav's first tab should read **Dashboard**.

---

## Step 42 — Business Ops on Prospect Detail (Client 360)

Once a prospect had a contract, invoice, or project, the only way to check on them was to leave the prospect's card and go hunt through three separate list views. The **Business Ops** section on Prospect Detail now lists every contract, invoice, and project already linked to that client — title/value, status pill (invoices flag Overdue the same way the Invoices list does) — right alongside the existing "add a new one" buttons. Tap any row to jump straight into that record. Entirely client-side, reads `store.contracts`/`store.invoices`/`store.projects` (already loaded for their own list views) filtered by `prospect_id` — no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → any **signed** prospect with an existing contract, invoice, or project → **Business Ops** section now lists them. Tap one to open it.

---

## Step 43 — Activity Feed filters

Team Activity used to be one flat, unfiltered list — no way to answer "what did Alice do today" or find a specific update without scrolling the whole feed. It now has a **search box** (filters by message text) and **agent chips** (only shows agents who actually have activity in the loaded feed) above the list, so owners can narrow it down in two taps. Operates entirely on the feed already loaded client-side (the most recent 60 entries) — no new query, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Team Activity** → type in the search box or tap an agent chip to filter the feed.

---

## Step 44 — Dashboard Business Snapshot deep-links

The Business Snapshot stat cards (Outstanding, Overdue Inv., Awaiting Sig., Active Projects) used to just switch tabs, landing on the unfiltered "All" list every time — unlike Pipeline's own status cards, which already jump straight into a filtered view. Now they do the same: tapping **Outstanding** or **Overdue Inv.** lands on Invoices pre-filtered to Sent, **Awaiting Sig.** lands on Contracts pre-filtered to Sent, and **Active Projects** lands on Projects pre-filtered to In Progress. Pure UX fix, reusing the exact filter-setter pattern Pipeline's dashboard deep-link already used — no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Dashboard** → tap any Business Snapshot card → lands on the matching list, already filtered.

---

## Step 45 — Projects CSV export

Contracts and Invoices already had a one-tap CSV export; Projects was the odd one out, so pulling a delivery report meant manually copying rows. Projects now has the same **Export CSV** link next to "+ New Project" — it exports whatever's currently on screen (respects the active status chip filter) with columns for Name, Client, Status, Due Date, Tasks Done/Total, Started By, and Created At. Same client-side CSV builder the other two exports already use — no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → **Projects** → tap **Export CSV** → a `.csv` file downloads with the currently filtered list.

---

## Step 46 — Client Statement print/PDF

Contracts and Invoices could already be printed one at a time, but there was no single document that showed a client's whole account — their contract value, every invoice, and what's still owed. Any signed prospect (or one with existing contracts/invoices/projects) now has a **Print Statement** link above their Business Ops list — it opens the browser's print dialog ("Save as PDF" works on every device) with a one-page statement: contract table, invoice table, and a Paid / Outstanding summary at the top. Built entirely from records already loaded client-side, reusing the exact letterhead/table styling the existing invoice and contract prints already use — no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → any prospect with contracts/invoices → tap **Print Statement** → confirm the print/PDF dialog shows a combined statement.

---

## Step 47 — Biiblo-inspired visual refresh (accent color + font)

Requested after seeing screenshots of Biiblo's UI: same dark shell, but a cleaner single-accent look. Two changes, pure styling, no markup/structure rewrite:

- **New primary accent** — a vivid green (`--brand`) now drives every interactive "chrome" element: primary buttons, active nav (sidebar + bottom bar), focus rings on inputs/search, active chips, links (`small-link`), progress bars, the floating "+" button, timeline dots, and the top-bar/sidebar logo badge (now a rounded square, Biiblo-style, instead of a circle). The old violet (`--purple`) is **kept** for exactly 3 pipeline-status spots — Tier B leads and the "Meeting Booked" status pill — so those stages still read as visually distinct from "Signed" (green) and from the new brand green; nothing about pipeline color-coding changed.
- **Font** — now loads and prioritizes Inter everywhere (previously the system font took over on Apple devices since it was listed before the web font), for a more consistent, "SaaS dashboard" look across every device instead of varying by OS. Dropped the unused Sora font load.
- Added a reusable `.icon-badge` CSS class (rounded-square tinted icon container, Biiblo's icon treatment) for future sections to opt into — not retrofitted across every existing icon in this pass.

Pure CSS/HTML `<link>` changes — no new tables, no new secrets, no JS logic touched.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → check buttons, active nav tab, and focused inputs are now green instead of violet, and that Tier B / "Meeting Booked" pills in Pipeline are still the old violet (unchanged, intentional).

**Note:** the accent-color half of this step was reverted in Step 48 below — see there for the current state. The font change from this step is still in effect.

---

## Step 48 — Reverted accent color back to violet

Feedback after Step 47 shipped: the new green accent wasn't wanted. Every "chrome" element that Step 47 repointed to the new `--brand` green — primary buttons, active nav (sidebar + bottom bar), focus rings, active chips, links, progress bars, the floating "+" button, timeline dots, and the logo badge (back to a circle) — is now back to the original violet `--purple`, byte-for-byte matching how it looked before Step 47. The `--brand*` variables have been removed entirely. Pipeline's Tier B / "Meeting Booked" pills were never touched by any of this (they were always violet). The **Inter font change from Step 47 is kept** — that wasn't part of the color complaint.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open the app → buttons, active nav, and focus rings are violet/purple again everywhere; text still renders in Inter.

---

## Step 49 — Team Checklist Today (owner view)

The daily checklist (`daily_tasks` + `daily_task_completions`) already loads every agent's completions for today into the store, but the Tasks screen only ever showed *your own* progress — an owner had to ask around or dig through Activity to find out who'd actually worked through today's list. Owners now see a **Team Checklist Today** card (between Manage Checklist and Team Targets) listing every active team member, worst-progress-first, with a progress bar, "X / Y done" count, and — for anyone not finished — the exact outstanding task titles, so there's no need to DM anyone to check. Entirely derived from data already in the store (`profiles`, `dailyTasks`, `dailyCompletions`) and re-renders live via the existing Realtime subscriptions — no new query, no new tables, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Sign in as an owner → **Tasks** → scroll to **Team Checklist Today** → confirm each active team member shows a progress bar and, if incomplete, a list of what's still outstanding.

---

## Step 50 — Awaiting Signature staleness flag on Contracts

Invoices already flags overdue payments with a stat card, an "Overdue" pill, and a one-tap WhatsApp reminder — Contracts had the identical "sent but nothing's happened" scenario (an unsigned contract sitting for weeks) with zero equivalent. Now, any contract still in "Sent" status 5+ days after its sent date shows an **"Awaiting Signature (Xd)"** pill instead of the plain "Sent" pill, a matching stat card at the top of the Contracts list ("Awaiting Signature 5+ days"), and a **Send Signature Reminder** button (when the client has a saved WhatsApp number) that opens a light "just checking in" nudge — different tone from the initial send. The CSV export gains a "Days Since Sent" column and labels stale rows "Awaiting Signature (stale)" in the Status column. Purely derived from `contracts.status`/`sent_date` already in the store — no new tables, columns, or secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open **Contracts** → find (or backdate) a contract with status "Sent" and a sent date 5+ days ago → confirm the stat card appears, the pill reads "Awaiting Signature (Xd)", and (if the linked prospect has a WhatsApp number) the reminder button opens a pre-filled nudge message.

---

## Step 51 — "Going Cold" flag + filter on Pipeline

Dashboard already computes which active leads haven't been touched in 5+ days for its aggregate stat card, but that signal only opened a separate read-only modal — it never showed up on the actual Pipeline list where reps work day-to-day. Now any active (not signed/dead) prospect untouched for 5+ days gets a **"Cold · Xd"** pill right on its card next to the other flags (REVIEW MESSAGE, RESEARCHING…, etc.), plus a new **Going Cold** filter chip (next to "Assigned to me") to instantly narrow the whole list down to just the cold ones. The CSV export also gains a "Days Since Update" column. Same 5-day threshold and `updated_at` signal Dashboard already uses, so the two views agree — purely derived from data already in `store.prospects`, no new tables, columns, or secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open **Pipeline** → any active lead untouched for 5+ days shows a "Cold · Xd" pill → tap **Going Cold** to filter down to just those.

---

## Step 52 — Removed the Liora conflict flag

Per request, the "Liora conflict" flag has been removed entirely from the app — it's no longer a real workflow anyone uses. Removed: the "Liora conflict flag" checkbox from the Add/Edit Prospect form, the red "LIORA CONFLICT" badge from the prospect detail sheet, and the matching badge from Pipeline cards. The `.conflict-flag` CSS class itself was **kept** — it's shared by three unrelated badges (AUTO-TEMPLATE, RESEARCHING…, REVIEW MESSAGE) that still use it. The underlying `prospects.liora_conflict` database column was left in place (this is a pure frontend removal, no migration) — any prospect that already had the flag set just no longer displays it anywhere; the column is simply unused going forward.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open any prospect's Edit form → confirm the "Liora conflict flag" checkbox is gone, and no "LIORA CONFLICT" badge appears anywhere in Pipeline or the prospect detail sheet.

---

## Step 53 — "Find Duplicates" audit tool on Pipeline

Duplicate-detection (`findDuplicateProspect`, matching on business name or WhatsApp number) already ran at creation time — new-prospect save and bulk-import preview — but never retroactively. Two reps adding the same business weeks apart, with no shared import batch, could sit in the pipeline as split duplicate cards indefinitely with no way to spot it besides manual scrolling. Pipeline now has a **Find Duplicates** link (next to Export CSV) that sweeps every prospect already loaded and opens a sheet listing each matched pair side by side — business name, status, assigned agent, last updated — with a tap-to-view on each so you can open one, decide, and delete the loser from its own detail sheet like normal. Reuses the exact same matching function bulk-import already relies on, just run pairwise across the whole pipeline instead of "new row vs. everything before it." No new tables, columns, or secrets — a pure client-side scan of `store.prospects`.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open **Pipeline** → tap **Find Duplicates** → confirm it lists any prospects sharing a business name or WhatsApp number, or shows "No duplicates found" if the pipeline's clean.

---

## Step 54 — Global Search now covers Niches and Message Templates

Global Search already searched prospects, contracts, invoices, and projects, but `store.niches` and `store.templates` were loaded into the app the whole time and just never wired into the search index — a plain parity gap. Typing a niche name (or a word from its notes) or a template's title/body/category now surfaces it in its own "Niches" / "Message Templates" group in both the desktop sidebar dropdown and the mobile search sheet, same as every other record type. Tapping a niche result opens the niche edit form **only for owners** — matching the fact that the "Edit" link on niche cards elsewhere in the app is owner-only too, so search can't be used to punch a hole in that restriction; non-owners still see niches in results (useful as a read-only reference) but tapping one does nothing. Tapping a template result opens its edit form for everyone, since template editing was never role-gated anywhere else either. No schema changes, no new secrets — purely wiring two already-loaded `store` arrays into the existing client-side `computeMatches`/`buildResultsHTML` functions.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Focus the search bar (desktop sidebar, or the search icon in the mobile topbar) and type part of a niche's name or a message template's title — confirm a "Niches" or "Message Templates" group appears with a match, and tapping it opens the right sheet (niche edit only if you're signed in as an owner).

---

## Step 55 — "Overdue" flag + filter on Projects

Dashboard has always counted overdue projects (`status !== "complete"` and `due_date` in the past) for its "Overdue Projects" stat card, but that count was dashboard-only — the Projects view itself, where delivery actually gets managed, showed no per-card indicator and had no way to isolate just the late ones; someone had to eyeball every card's due date by hand. Projects now shows a red "Overdue" badge next to any card past its due date and not complete, plus a matching "Overdue" filter chip (alongside the existing status chips) that narrows the list to just those. Overdue projects also sort to the top of the list regardless of the usual "most recently updated" order, so the ones needing attention aren't buried. Export CSV picks up the same flag, prefixing overdue rows' Status column with "Overdue — ". Uses only `projects.status` and `projects.due_date`, both already loaded into `store.projects` — same overdue definition Dashboard already uses, kept in sync deliberately.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open **Projects** → confirm any project past its due date (and not marked Complete) shows a red "Overdue" badge and sorts near the top; tap the new "Overdue" chip to confirm it filters down to just those.

---

## Step 56 — "Collected This Month" stat card on Invoices

Invoices already showed "Outstanding" (money still owed) and "Overdue" (how many sent invoices are past due), but nothing showed how much cash has actually landed — the number an owner asks about most. Dashboard's "Projected MRR" is forward-looking (based on signed clients' recurring value), not a record of real payments. Invoices now has a third stat card, "Collected This Month," summing the `amount` of every invoice with `status = paid` and a `paid_date` inside the current calendar month — using the same `firstOfMonth()` helper Dashboard already relies on for its own monthly-goal scoping, so "this month" means the same thing everywhere in the app. Purely a read from data already loaded into `store.invoices`; no new query, no schema change.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open **Invoices** → confirm a third "Collected This Month" card appears showing the total of this month's Paid invoices (mark one Paid with today's date if you want to see the number move).

---

## Step 57 — "Average Time in Stage" on Pipeline Value

Pipeline Value already answered "how many" and "what %" for every funnel step (counts, win rate by niche/agent) but nothing answered "how long" — an owner had no visibility into where deals actually stall in time: sitting on a fresh lead too long before the first message, or waiting on a reply, or dragging on scheduling a meeting after one comes in. Pipeline Value now has an "Average Time in Stage" section showing the average days spent in each of four adjacent funnel steps — Lead → First Sent, Sent → Replied, Replied → Meeting, Meeting → Signed — computed from real `status_history` rows (`prospect_id`, `old_status`, `new_status`, `changed_at`) over the last 90 days (a longer lookback than the existing 30-day live-rate stats, since averages need more sample size), using each prospect's `created_at` as the baseline for that first step. Each stage card shows its sample size alongside the average so a 1-deal average doesn't look as solid as a 20-deal one. No new tables or columns — `status_history` and `prospects.created_at` were already there; no new secrets — one extra `status_history` select alongside the query Pipeline Value already ran.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open **Pipeline Value** → scroll to "Average Time in Stage" → confirm it shows day-averages with deal counts for stages that have logged transitions, or a "no data yet" hint if the org is brand new.

---

## Step 58 — "No Follow-up Date Set" gap flag (Dashboard + Pipeline)

Every follow-up surface in the app — the "Due Today" list on the home screen, Team's "Week Ahead", the ICS calendar export — depends entirely on someone remembering to set a prospect's `follow_up_date`. Nothing previously caught the case where that step just got skipped: a rep replies to a lead, moves it to Replied, gets pulled onto something else, and never sets a reminder — that lead goes invisible to every follow-up surface, and (unlike the existing "Needs Follow-up" staleness card, which is really about `updated_at` going quiet) wouldn't even get flagged there for days, and only once it's visibly gone cold. Dashboard's Data Check section now has a card counting active leads (Sent/Replied/Meeting Booked) with no `follow_up_date` set, opening the same list-modal pattern as the Zero-MRR card next to it. Pipeline gets a matching "No Follow-up" filter chip (next to "Going Cold") so a rep can jump straight to the offending leads and set a date on the spot. Pure client-side read of `prospects.status`/`prospects.follow_up_date`, both already loaded — no new tables, columns, or secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open **Dashboard** → confirm a card appears under "Data Check" counting active leads with no follow-up date, and tapping it lists them.
3. Open **Pipeline** → tap the new "No Follow-up" chip → confirm it filters to the same leads.

---

## Step 59 — "Draft First Invoice" prompt on Contract Signing

Contracts and Invoices were fully decoupled — marking a contract Signed had zero effect on billing. The only existing safety net, Dashboard's Revenue at Risk card, only caught a missing invoice after a signed client had sat untouched for 30 days. Now, the moment a contract's status is changed to Signed (and it isn't already linked to an invoice), a confirm modal offers to draft the client's first invoice on the spot — pre-filled with the contract's value, linked prospect, and a reference back to the contract — same "offer, don't force" pattern Invoices already uses when a recurring invoice gets marked Paid (`offerRecurringInvoice`). One tap creates it as a Draft; declining does nothing, and it only ever offers once per contract. No new tables/columns — reuses `contracts.value`/`prospect_id` and inserts into the existing `invoices` table exactly like every other invoice-creation path already does. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open a contract not yet linked to any invoice, change its Status to Signed, Save → confirm a "Draft the first invoice?" prompt appears; confirm it creates a Draft invoice pre-filled with the contract's value and client.

---

## Step 60 — "Distribute Evenly" bulk-assignment on Pipeline

Dashboard already had cards that detect a lopsided or unassigned workload ("Unassigned Leads," "Team Workload"), but nothing actually fixed it in one action — a lead admin still had to manually assign leads one teammate at a time, eyeballing who had the lightest load. Pipeline's multi-select "Assign" modal now has a "Distribute Evenly" option at the top, styled apart from the per-teammate rows below it. Selecting it round-robins the whole selected batch across currently-active teammates (`profiles.active !== false`), always handing the next lead to whoever currently has the fewest active (non-Signed/non-Dead) assigned prospects — so it naturally levels out an existing imbalance instead of just splitting evenly from zero. Assignments are grouped per agent and written with one batched `prospects` update per agent, then a summary toast shows the final split (e.g., "Distributed 12 prospects — Alex: 4, Sam: 4, Jo: 4"). No schema change — only writes to the existing `prospects.assigned_to` column exactly like the existing per-teammate assign rows already do. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open **Pipeline** → select several prospects → tap Assign → tap "Distribute Evenly" → confirm they're spread across active teammates, starting with whoever had the fewest active leads, and a summary toast shows the split.

---

## Step 61 — "Stale Draft" flag on Invoices

Overdue was already covered (a sent invoice past its due date), but nothing flagged the opposite failure mode: an invoice someone starts drafting — fills in the amount, saves it — and then never actually sends. It never counts toward "Outstanding" (which only sums `status = sent` invoices) and Dashboard's Revenue at Risk card only catches a signed client with *zero* invoices raised after 30 days, so a client who already has a half-finished, forgotten draft is invisible everywhere. Invoices now flags any draft invoice sitting untouched for 3+ days (`STALE_DRAFT_DAYS`, mirroring Contracts' existing `STALE_DAYS`/"Awaiting Signature" pattern, anchored on `created_at` since a draft has no `sent_date` yet): a one-column stat card appears above the existing 3-card grid when any exist, each stale draft's status pill shows "Draft (Xd)" in the list instead of a plain "Draft," and a one-tap "Mark as Sent" button appears on the card to clear the flag the moment it's actually sent — same placement pattern as the existing "Send Payment Reminder" button on overdue invoices. The CSV export reflects the same labeling. No schema change — uses only the existing `invoices.status`/`created_at` columns. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Create a new invoice and leave it as Draft → confirm nothing is flagged yet (under 3 days old).
3. Open an existing draft invoice 3+ days old (or edit one's created date directly in Supabase to test) → confirm the "Draft invoice(s) not sent" card appears, its list pill reads "Draft (Xd)", and tapping "Mark as Sent" clears the flag.

---

## Step 62 — "Idle" flag on Projects

Overdue only fires when a project has a `due_date` that's passed — but `due_date` is optional, and a project can sit at Not Started or In Progress for weeks with nothing touched (no status change, no notes, no date edits) and never get flagged anywhere. Dashboard's Revenue at Risk only catches the narrower case of a Blocked project on a signed client, not a plain stalled one. Projects now flags any non-complete, non-overdue project that's gone 10+ days (`IDLE_DAYS`) without a touch, using `updated_at` — already bumped automatically by the existing `trg_projects_touch` trigger on status/date/notes edits — as the "last touched" signal, same proxy Dashboard's stale-lead check already uses for prospects. Idle projects get an "Idle · Xd" pill (styled like Pipeline's existing "Cold" pill) next to their status, a new "Idle" filter chip alongside "Overdue," rank just below overdue ones in the sort order, and show up correctly in the CSV export's Status column. No schema change — reuses the existing `projects.updated_at`/`status` columns. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Find (or create) a project that's been sitting untouched 10+ days with no due date pressure → confirm an "Idle · Xd" pill appears and the new "Idle" chip filters down to it.
3. Touch that project (change status, edit notes, etc.) → confirm the Idle flag clears once `updated_at` refreshes.

---

## Step 63 — "MRR Mismatch" flag on signed Contracts

A new contract's value pre-fills from the linked prospect's `mrr` once, at creation time — after that, the two fields drift completely independently. Every revenue number elsewhere in the app (Dashboard's Monthly Goal/Projected MRR, Pipeline Value's revenue-by-niche/tier breakdowns) is computed from `prospects.mrr`, not from `contracts.value` — so if a rep renegotiates a retainer and updates the contract but forgets the prospect's MRR field (or vice versa), every one of those numbers is silently wrong, with nothing catching it. Dashboard's existing "Zero-MRR Signed Prospects" check only catches `mrr = 0`, not "mrr disagrees with what was actually signed." Any signed contract whose `value` no longer matches its linked prospect's `mrr` now shows an "MRR mismatch" banner on its list card and inside its edit sheet, where a one-tap "Sync MRR to $X" button updates `prospects.mrr` to match the contract's value — same one-tap quick-action pattern already used for "Mark as Sent"/"Send Signature Reminder" elsewhere in this file. No schema change — reuses the existing `contracts.value` and `prospects.mrr` columns; the sync button is a normal `prospects` update, the same table other views already write to. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Sign a contract with a value different from its linked prospect's MRR → confirm the "MRR mismatch" banner appears on the contract's card and inside its edit sheet.
3. Tap "Sync MRR to $X" → confirm the prospect's MRR updates to match and the banner disappears.

---

## Step 64 — "Checklist Templates" on Projects

Every new project's checklist started completely blank — the team retyped the same recurring delivery steps by hand for every client, one deliverable at a time via the "Add a deliverable..." input, with different agents listing (or skipping) different steps since nothing standardized what a given engagement type actually involves. A project's detail sheet now has a "Use Template" link next to the Checklist section title, opening a small chip picker with three built-in templates relevant to a marketing agency's work — Client Onboarding, Monthly Content Batch, and Website/Launch — each a fixed list of 6 checklist-item titles baked directly into `projects.js` (`PROJECT_TEMPLATES`, no new table). Picking one confirms the item count via the existing `confirmModal`, then bulk-inserts those titles into `project_tasks` continuing the project's existing `sort_order` sequence, exactly like the manual "Add" button already does — items are still fully editable/removable afterward, this is just a faster starting point, not a locked template. No schema change — reuses the existing `project_tasks` table as-is. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open any project → tap "Use Template" → pick one of the three templates → confirm the prompt shows the right item count, and confirming adds all of them to the checklist in order.

---

## Step 65 — "Avg. Days to Get Paid" stat on Invoices

Invoices already surfaced Collected This Month, Outstanding, Overdue, and Stale Draft — all snapshots of money's current state. None of them answer the cash-flow question an owner actually asks: once a client is billed, how long does it typically take them to actually pay? Dashboard's Projected MRR is forward-looking, and Pipeline Value's Average Time in Stage measures funnel movement, not billing — neither covers this. Invoices now has a full-width "Avg. Days to Get Paid" card computed purely client-side from every paid invoice's `created_at` → `paid_date` gap, already loaded in `store.invoices`. Tapping the card (when there's at least one paid invoice) opens a "Slowest to Pay" modal ranking paid invoices worst-first by days-to-pay, so an owner can see exactly which clients are worth a conversation about payment terms — same click-through modal-list pattern Dashboard's own stat cards already use. No schema change — reuses existing `invoices.created_at`/`paid_date`. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open **Invoices** → confirm the "Avg. Days to Get Paid" card shows a day count (or "—" if nothing's been paid yet).
3. Tap the card → confirm a "Slowest to Pay" list opens, sorted worst-first, and tapping a row opens that invoice.

---

## Step 66 — "Delivery Not Started" gap flag on Dashboard

Revenue at Risk already watches billing (overdue invoice, no invoice after 30 days) and a blocked project, but it never checked the simpler, earlier failure: a client signed — maybe even got invoiced — and nobody ever created a `project` row for them at all, so delivery work isn't tracked anywhere. Nothing else surfaces this until the client asks "so when do we start?" Dashboard's Business Snapshot section now has a "Delivery Not Started" card counting signed clients (past a 3-day grace period, so a deal signed minutes ago doesn't get flagged before anyone's had a chance to react) with zero linked `projects` rows, using the same click-through `openProspectListModal` pattern every other Data Check card already uses — each row deep-links into that client's detail sheet, where the existing "+ Project" action lets a rep fix it in one tap. No schema change — reuses existing `prospects.status`/`updated_at` and `projects.prospect_id`, all already loaded into `store`. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Mark a prospect Signed and wait 3+ days without creating a project for them (or edit their `updated_at` back in Supabase to test sooner) → confirm the "Delivery Not Started" card counts them and tapping it lists them.
3. Create a project linked to that prospect → confirm the count drops.

---

## Step 67 — "Outstanding by Client" drill-down on Invoices

The "Outstanding" stat card has shown a single aggregate dollar figure since it was added — useful as a snapshot, but useless for deciding who to actually chase for payment; an owner had to manually scroll the invoice list and mentally tally per-client totals. The Outstanding card is now clickable (when non-zero) and opens an "Outstanding by Client" modal grouping every sent (unpaid) invoice by client, summing what each one owes, and sorting worst-first — invoices with no linked prospect group under "Unlinked invoices." Tapping a row opens that client's most recent outstanding invoice. Distinct from "Slowest to Pay" (which measures speed of already-paid invoices) and Dashboard's Revenue at Risk (which flags a signed client with no invoice at all) — this answers "who currently owes us the most, right now." No schema change — reuses existing `invoices.amount`/`status`/`prospect_id`, all already loaded into `store.invoices`. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open **Invoices** → tap the "Outstanding" stat card (only clickable when non-zero) → confirm a per-client breakdown appears, sorted highest-owed first.
3. Tap a client row → confirm it opens their most recent outstanding invoice.

---

## Step 68 — "Signed This Month" stat cards on Contracts

Invoices already has "Collected This Month" (cash received); Contracts had zero aggregate stats of its own. Dashboard's Projected MRR is a cumulative recurring-revenue snapshot, not tied to *when* a client signed, and the Leaderboard counts deals per rep with no dollar figure — neither answers the sales-ops question "how much new business did we actually close this month," the natural companion to Invoices' own monthly card. Contracts now shows two stat cards at the top — count and total dollar value of contracts marked Signed with a `signed_date` in the current calendar month (using the same `firstOfMonth()` helper Invoices already relies on). The value card is clickable and opens a "Signed This Month" drill-down listing each qualifying contract by client, title, and value, sorted highest-value-first — same click-through modal pattern already established by Invoices' "Outstanding by Client"/"Slowest to Pay" modals. No schema change — reuses existing `contracts.status`/`signed_date`/`value`. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Mark a contract Signed with today's date → confirm the "Signed This Month" count and value cards update.
3. Tap the value card → confirm a breakdown lists that contract, sorted by value, and tapping it opens the contract.

## Step 69 — "Due Soon" flag on Invoices

Overdue only ever fires once an invoice's due date has already passed — nothing nudged a client *before* the deadline, when a friendly heads-up reads as courteous rather than as a collections message. Sent invoices due within the next 3 days now get a "Due in Xd" pill (reusing the same amber `.status-pill.stale` styling as the Stale Draft flag) instead of the plain "Sent" pill, plus a stat card counting how many are coming due. The existing "Send Payment Reminder" quick-action button — previously shown only for overdue invoices — now also shows for due-soon ones; `sendPaymentReminder()` already branched its message wording on whether the due date had passed, so a due-soon reminder automatically uses the friendlier not-yet-due copy with no changes needed there. No schema change — reuses existing `invoices.status`/`due_date`. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Set a sent invoice's due date to 1-2 days from today → confirm it shows a "Due in Xd" pill, counts toward the new stat card, and shows a "Send Payment Reminder" button.
3. Tap that button → confirm the WhatsApp message uses the friendly not-yet-due wording, not the overdue wording.

## Step 70 — Niche Conversion Rate + sort toggle on Niche Strategy

The opportunity score on the Niche Strategy page is a hand-typed, gut-feel guess (Lead Value / Close Speed / Stickiness / Mkt Gap / Fit, all manually scored 1-5) made before any real outreach happens — there was no feedback loop showing whether a niche's actual pipeline results back up that score. Each niche card now shows a "Converting X% (signed/total)" line computed from its own prospects (`store.prospects` filtered by `niche_id`, `status === "signed"`); niches with 5+ prospects and under 10% conversion get the line rendered as an amber `.status-pill.stale` instead of plain text, matching the existing "needs attention" pattern already used for the "No opener template" flag. A new "Sort: Opportunity Score" / "Sort: Conversion Rate" chip toggle lets an owner instantly flip the ranked list to see which niches are actually converting best versus which ones just look good on paper — surfacing exactly the case where a niche ranked #1 by manual score is quietly converting worst in practice. No schema change — reuses existing `prospects.niche_id`/`prospects.status`. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open Niche Strategy → confirm each card shows a "Converting X%" line reflecting that niche's actual signed prospects.
3. Tap "Sort: Conversion Rate" → confirm the list re-sorts by conversion rate instead of opportunity score, and tapping "Sort: Opportunity Score" reverts it.
4. Find or create a niche with 5+ prospects and under 10% signed → confirm its conversion line renders as an amber pill instead of plain text.

## Step 71 — Outreach Streak on Daily Plan

Daily Plan already tracked *today's* checklist completion, but nothing rewarded showing up consistently day after day — only same-day progress was visible. The Daily Plan now opens with a "🔥 Day Streak" card counting consecutive days the logged-in agent fully completed their applicable checklist, computed by walking backward from today through `daily_task_completions` history (a direct query, since the store only holds today's completions) until a day is found where not every currently-applicable task was completed. Today itself never breaks the streak while it's still in progress — only a truly missed prior day resets the count to 0. No schema change — reuses existing `daily_task_completions` (`task_id`/`agent_id`/`work_date`/`completed`) and `daily_tasks`. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open Daily Plan → confirm the streak card appears above "Today's Outreach Rhythm" showing your current streak.
3. Complete every item on today's checklist → confirm the label updates to reflect today counting toward the streak.
4. As a sanity check, confirm an agent with no checklist items configured sees no streak card (rather than a broken 0).

## Step 72 — "No Personalization" flag on Message Kit

Message Kit had zero flags or stats of its own — agents could copy-paste a template that never uses any `{{business_name}}`/`{{area_clause}}`/`{{gap_clause}}`/`{{agent_name}}` token and it would send out identical to every prospect, reading as obviously generic, with nothing in the app calling that out. Templates with no personalization token now show a "No personalization" amber pill on their card, plus a stat card at the top of Message Kit counting how many templates need attention; tapping it opens a drill-down modal (same click-through pattern as Invoices'/Contracts' existing modals) listing each one, and tapping a row jumps straight into editing it. No schema change — reuses existing `message_templates.body`/`category`/`niche_id`, checked against the same four tokens `personalizeMessage()` already recognizes. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open Message Kit → confirm any template with no `{{...}}` token shows a "No personalization" pill and counts toward the new stat card.
3. Tap the stat card → confirm a drill-down lists those templates, and tapping one opens it for editing.
4. Add a `{{business_name}}` token to one flagged template and save → confirm its pill disappears and the count drops.

## Step 73 — "Avg. Delivery Time" stat card + "Slowest Deliveries" drill-down (Projects)

Projects already flagged in-flight problems (Overdue, Idle), but nothing answered the operational question of how long delivery actually takes once a project finishes. There's no dedicated `completed_at` column, but `updated_at` is already bumped by the existing `trg_projects_touch` trigger on every edit (the same "last touched" proxy the Idle flag already leans on) — so for a project sitting at `status = 'complete'`, `updated_at` stands in for "the day it finished." Projects now shows an "Avg. Delivery Time" stat card (average `created_at` → `updated_at` gap across completed projects, mirroring Invoices' own Avg. Days to Get Paid), clickable to open a "Slowest Deliveries" drill-down modal ranking completed projects slowest-first, each tappable straight into that project's detail sheet. No schema change — reuses existing `projects.status`/`created_at`/`updated_at`/`name`/`prospect_id`. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Mark a project Complete → confirm the "Avg. Delivery Time" stat card updates.
3. Tap the card → confirm a breakdown lists completed projects sorted slowest-first, with a red pill at 21+ days, and tapping one opens that project.

## Step 74 — "Last Active" indicator on Team Members

The team roster showed everyone's role but nothing about whether they're actually working the pipeline — an owner had to open Activity and filter per-person, one at a time, to find out who's gone quiet. Each member card now shows "Active {time ago}" under their name, derived from the org-wide `activity_log` (already loaded for every role, newest-first — the first row matching a person's `actor_id` is their most recent action). Anyone active but with no activity in the last 3 days gets an amber "Inactive · {time ago}" pill instead (or "No activity yet" if they've never logged one), matching the existing `.status-pill.stale` "needs attention" styling used elsewhere. Updates live as new activity streams in via the existing `activity_log` Realtime subscription. No schema change — reuses existing `activity_log.actor_id`/`created_at` and `profiles.active`. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open Team → confirm each active member shows "Active {time ago}" reflecting their most recent activity-log entry.
3. Have a teammate perform an action (send a message, change a prospect status, etc.) → confirm their card updates live without a manual refresh.
4. Confirm a teammate with no recent activity (3+ days, or none ever) shows the amber "Inactive"/"No activity yet" pill instead.

## Step 75 — "Recent Quotes" panel in the Deal Pricing Calculator

Every Deal Pricing Calculator quote was already saved as a `prospect_notes` row with a distinctive "💰 Deal Pricing Calculator quote —" marker prefix, but that data was invisible except by opening one prospect's Notes tab at a time — nobody could see what's been quoted recently across the whole pipeline, useful for an owner sanity-checking pricing consistency or an agent confirming they haven't already priced someone. The calculator sheet now has a "Recent Quotes" link that opens a drill-down modal (fetched on demand via an `ilike` filter on that marker prefix, not loaded into the main store) listing the last 20 saved quotes — business name, the quote summary, who quoted it, and when — and tapping one closes the modal and reopens the calculator pre-targeted at that prospect. No schema change — reuses existing `prospect_notes` (`prospect_id`/`body`/`created_at`/`author_id`). No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Save a Deal Pricing quote to a prospect, then open the calculator again and tap "Recent Quotes" → confirm it appears at the top of the list.
3. Tap that entry → confirm the modal closes and the calculator reopens pre-targeted at that same prospect.

## Step 76 — Export CSV on Team Activity

Every other list view (Pipeline, Contracts, Invoices, Projects) already had a CSV export; Team Activity was the one left without it, useful for handing a slice of the feed to someone outside the app or keeping an offline audit trail. Team Activity now has an "Export CSV" link that respects whatever agent chip and search text are currently active (the filtering logic is now shared between the on-screen list and the export, so what you see is exactly what you get), exporting Time/Actor/Message columns via the same `toCSV`/`downloadTextFile` helpers every other export already uses. No schema change — reuses existing `activity_log.created_at`/`actor_id`/`message`. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open Team Activity, optionally filter by an agent chip or search term, then tap "Export CSV" → confirm the downloaded file matches only what's currently shown.
3. With no activity in the loaded feed, confirm the export shows a "No activity to export" toast instead of downloading an empty file.

## Step 77 — "Team Pace Today" on Daily Plan

Existing team-visibility features on the Daily Plan only counted boolean checklist completion (Team Checklist Today) or raw activity counts — nothing compared each person's *actual numeric output* against their assigned target, aggregated across the whole team. Owners now see a "Team Pace Today" section above Manage Checklist with two stat cards — "Team Sends Today" and "Team Meetings This Week" — summing actual sends/meetings (from `status_history`, same query pattern the existing per-agent `loadTargetsProgress` already uses) against the sum of every active agent's `agent_targets` target, flagged with the accent color when team pace falls below 50%. Tapping either card opens a drill-down modal ranking every active agent worst-pace-first with a progress bar, so an owner can immediately see who's furthest behind without opening each person's own Daily Plan. No schema change — reuses existing `agent_targets.daily_sends_target`/`weekly_meetings_target`, `status_history.changed_by`/`new_status`/`changed_at`, and `profiles.active`. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. As an owner, open Daily Plan → confirm "Team Pace Today" shows two stat cards with combined actual/target numbers and percentages that look right against Manage Targets.
3. Tap either stat card → confirm a modal opens listing every active agent sorted worst-pace-first, each with their own actual/target and a progress bar.
4. Confirm a non-owner agent's Daily Plan does not show this section at all.

## Step 78 — "Download Sample CSV" on Bulk Import

The Bulk Import sheet only ever showed the column order as an inline text hint, so agents copying from ad-hoc spreadsheets had to manually re-order/rename their own columns by hand to match — exactly the kind of silent misalignment that produces bad imports (e.g. a rating landing in the tier column). There's now a "Download Sample CSV" link next to that hint that downloads a ready-made template file with the correct header row and one filled-in example row, which can be opened in Excel/Sheets, filled in, and pasted straight back into the paste box. No schema change — reuses the same `COLUMNS` list the paste parser already agrees on, and the same `toCSV`/`downloadTextFile` helpers every other CSV export already uses. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open Bulk Import → tap "Download Sample CSV" → confirm a `prospect-import-template.csv` file downloads with the correct 11-column header and one example row.
3. Open that file in a spreadsheet app, edit a row, and paste its contents back into the Bulk Import textarea → confirm Preview Import parses it correctly.

## Step 79 — "Unreachable" flag + filter on Pipeline

A prospect with no WhatsApp number, email, or Instagram handle is a lead nobody can actually act on — no opener to send, no way to reach them — yet it sits in the pipeline looking like normal backlog. `prospectDetail.js` only ever surfaced this passively, one prospect at a time, as a "No contact details saved" note. Pipeline now flags any active (non-signed, non-dead) prospect missing all three contact methods with an amber "No contact info" pill on its card, plus a new "Unreachable" filter chip next to Going Cold / No Follow-up so it can be isolated for an enrichment or cleanup pass. No schema change — reuses existing `prospects.whatsapp_number`/`email`/`instagram`/`status` already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. On Pipeline, find or create an active prospect with no WhatsApp/email/Instagram → confirm its card shows a "No contact info" pill.
3. Tap the "Unreachable" filter chip → confirm the list narrows to only prospects missing all three contact methods, and tapping again clears the filter.

## Step 80 — "Undo Import" on Bulk Import

A bulk paste import is exactly the kind of operation that goes wrong in a way you only notice after confirming — columns off by one, wrong niche mapped, pasted the wrong sheet range. Previously the only recovery was manually hunting down and deleting each newly-created prospect one at a time in Pipeline. The import confirmation now captures the IDs Supabase hands back from the insert, and the sheet stays open afterward showing "Imported N prospect(s)" with an "Undo Import" button next to "Done" — tapping Undo (after a confirm dialog) bulk-deletes exactly those newly-created rows and nothing else. No schema change — reuses the existing `prospects` table and its `id` column via `.select("id")` on the same insert call this file already made. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Bulk import a couple of test prospects → confirm the sheet shows "Imported N prospects" with "Undo Import" and "Done" buttons instead of closing automatically.
3. Tap "Undo Import", confirm the dialog → confirm those prospects are gone from Pipeline and a "Import undone" toast appears.
4. Import again and tap "Done" instead → confirm the sheet closes normally and the prospects remain.

## Step 81 — "Today's Priority Leads" on Daily Plan

Daily Plan's checklist and targets tell an agent *how much* to do today, but nothing told them *which specific leads* to work first — they had to go sort/scan the whole Pipeline themselves every morning. Daily Plan now opens with a "Today's Priority Leads" section showing the agent's own top 5 `not_contacted` prospects ranked by heat score (owners see the org's top 5 unassigned hot leads instead, since "my leads" doesn't apply to them here); tapping a card opens that prospect's detail sheet directly. No schema change — reuses existing `prospects.status`/`heat_score`/`assigned_to`/`tier`/`business_name`/`niche_id`, already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. As an agent with untouched prospects assigned, open Daily Plan → confirm "Today's Priority Leads" shows up to 5 cards sorted hottest-first, and tapping one opens that prospect's detail sheet.
3. As an owner, confirm the same section instead shows the top unassigned hot leads org-wide.
4. With no qualifying leads, confirm it shows "No untouched hot leads right now — nice work." instead of an empty section.

## Step 82 — "Unmatched Niche" fix-up in Bulk Import

Bulk Import's niche lookup did a case-insensitive exact-name match and silently fell back to `niche_id: null` when a pasted niche name didn't match anything (a typo, or a niche that's since been renamed) — the prospect still imported fine, but landed untagged with zero feedback, and niche tagging matters elsewhere (auto-personalized Opener templates, Niche Strategy conversion stats, template-coverage flags). The preview step now flags exactly which rows had an unrecognized niche name and shows a dropdown per row to pick the correct niche (or explicitly leave it blank) before confirming — fixing the gap at the point of entry instead of leaving it silently wrong. No schema change — reuses existing `niches.id`/`name` (already loaded in `store.niches`) and the existing `prospects.niche_id` column. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Paste a row with a niche name that doesn't match any existing niche (e.g. a typo) → confirm Preview Import shows an amber "niche name(s) didn't match" card with a dropdown for that row.
3. Pick a niche from the dropdown and confirm the import → open that prospect and confirm the niche was applied correctly.
4. Leave the dropdown on "— No niche —" and import → confirm the prospect imports with no niche tag, same as before this feature.

## Step 83 — "No Website" sales-opportunity flag + filter on Pipeline

Unlike the existing Going Cold / No Follow-up / Unreachable flags, which surface process or data-quality gaps, this one surfaces a sales opportunity: a prospect who visibly lacks the exact product the agency sells is a stronger pitch — "I noticed you don't have a website yet..." — and there was previously no way to spot or filter these across the pipeline. Active (non-signed, non-dead) prospects with no `website` value now get a "No Site" pill on their card, plus a new "No Website" filter chip next to the other Pipeline filters, so agents can build a targeted call-list. No schema change — reuses the existing `prospects.website`/`status` fields already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. On Pipeline, find or create an active prospect with no website saved → confirm its card shows a "No Site" pill.
3. Tap the "No Website" filter chip → confirm the list narrows to only prospects missing a website, and tapping again clears the filter.

## Step 84 — "My Performance" on Team page

Every existing performance surface was either time-boxed (Monthly Leaderboard — this month's signed count only, no dollar figure) or capacity-only (Team Workload — owner-only, active-lead count only, no revenue/win rate). Nothing answered "what have I actually closed, ever, and how good is my hit rate" for an individual agent. The Team page now opens with a "My Performance" section — four stat cards showing Active Leads, Signed (All-Time), MRR Won, and Win Rate (signed ÷ everyone actually engaged past Not Contacted) — giving agents a durable personal number to check and giving owners a quick read during a 1:1. Tapping the Signed or MRR card opens a drill-down listing every signed client with their MRR. No schema change — purely derived from existing `prospects.assigned_to`/`status`/`mrr`/`business_name`, already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open Team → confirm "My Performance" shows four stat cards with numbers that match your own assigned leads in Pipeline.
3. Tap the Signed or MRR card → confirm a modal lists your signed clients sorted by MRR descending.
4. Sign a new prospect assigned to you → confirm the numbers update live without a manual refresh.

## Step 85 — "Avg. Days to Sign" stat card on Contracts

Invoices already has "Avg. Days to Get Paid" and Projects has "Avg. Delivery Time," but Contracts only had a per-contract staleness flag ("Awaiting Signature 5+ days") with no aggregate view of the team's typical sales-cycle speed. Contracts now shows an "Avg. Days to Sign" card computed from `signed_date - sent_date` across every signed contract that has both dates, tappable into a "Slowest to Sign" drill-down ranking the slowest deals first — useful for spotting whether closes are speeding up or slowing down over time, and for reviewing specific deals that took unusually long. Also added a "Days to Sign" column to the existing Contracts CSV export. No schema change — reuses existing `contracts.status`/`sent_date`/`signed_date`/`title`/`prospect_id`, already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open Contracts → confirm "Avg. Days to Sign" shows a number (or "—" if no signed contracts have both dates set yet).
3. Tap that card → confirm a modal lists signed contracts sorted slowest-first, and tapping a row opens that contract.
4. Export Contracts CSV → confirm a "Days to Sign" column appears, populated only for signed contracts with both dates.

## Step 86 — "Top Rated" flag + filter on Pipeline

Every prospect can carry a public `rating` (captured in the Add/Edit form, e.g. from Google/Facebook reviews) but it was write-only — shown once in Prospect Detail's subheader and never used to prioritize outreach. A high public rating on a lead still sitting untouched is the strongest, most-proven kind of opportunity — an established business with real customer trust — so it's now surfaced the same way as the other Pipeline flags: a "★ Top Rated" pill on cards with `rating >= 4.5` still in `not_contacted` status, plus a matching "Top Rated" filter chip. No schema change — reuses the existing `prospects.rating`/`status` fields already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. On Pipeline, find or create a `not_contacted` prospect with a rating of 4.5 or higher → confirm its card shows a "★ Top Rated" pill.
3. Tap the "Top Rated" filter chip → confirm the list narrows to only those prospects, and tapping again clears the filter.

## Step 87 — "Untapped Niches" flag on Niche Strategy

The opener-template flag and conversion-rate stats on Niche Strategy only ever fire once a niche has active prospects logged against it — a niche the team rated a strong opportunity (high hand-typed score) but never actually worked can sit invisibly idle forever, with nothing on screen calling attention to it. Niche Strategy now flags this directly: any niche scoring 60+ (via the existing `overallScore()` calculation) with zero prospects ever logged against it gets an "Untapped — no prospects yet" pill on its card, plus a summary stat card at the top of the page ("N high-opportunity niches with zero prospects — tap to review") that opens a drill-down list sorted by score, tapping a row opens that niche for editing. No schema change — reuses the existing niche scoring dimension columns already used by `overallScore()` and `prospects.niche_id`, both already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. On Niche Strategy, find or create a niche scoring 60+ overall with no prospects assigned to it → confirm its card shows an "Untapped — no prospects yet" pill and the summary stat card count includes it.
3. Tap the summary stat card → confirm a modal lists untapped niches sorted by score, and tapping a row opens that niche's edit form.
4. Add a prospect tagged to that niche → confirm the pill and stat card update (niche no longer counted as untapped).

## Step 88 — Notes in Global Search

Global Search already covers prospects, contracts, invoices, projects, niches and message templates, but notably skipped `prospect_notes` — that table isn't preloaded org-wide (it's only lazy-loaded per prospect when someone opens Prospect Detail), so anything a rep wrote in a note — an objection raised, a price quoted, a call outcome, why a deal went cold — was completely unsearchable unless you already knew which prospect to open and scrolled through their notes tab. Every keystroke in the search box now also fires a small `ilike` query against `prospect_notes` and appends a "Notes" results group (showing the business name and a snippet) once it resolves, so any note across the whole org is instantly findable from the same search box everyone already uses — clicking a result opens that prospect. No schema change — reuses the existing `prospect_notes` table (`id`, `prospect_id`, `body`, `created_at`) already read elsewhere (Prospect Detail's notes tab, Deal Pricing's Recent Quotes panel). No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Add a note on any prospect containing a distinctive word (e.g. "budget concerns").
3. Search that word in the sidebar (desktop) or search icon (mobile) → confirm a "Notes" group appears with the matching prospect and a snippet, briefly after the other groups render.
4. Tap the note result → confirm it opens that prospect's detail sheet.

## Step 89 — "Churned Clients" widget on the Dashboard

Every existing dead-lead signal treats "dead" as one bucket — Win-Back Candidates (Step 23) flags any dormant dead lead purely as a re-engagement opportunity, and nothing distinguishes "never converted" from "we signed them and then lost them." Losing a paying client is a materially different (and costlier) event than a cold lead going nowhere, and it's a number an owner wants at a glance. The Dashboard's Business Snapshot section now shows a "Churned Clients" card — count of prospects that went signed → dead, plus the total MRR lost — tappable into a drill-down listing each one sorted by lost MRR, highest first. No schema change — reuses the existing `status_history` table (`old_status`, `new_status`, `prospect_id`, `changed_at`, already read the same way for the Leaderboard) and `prospects.mrr`, which is never reset when a client moves to `dead`. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Move a signed client with an MRR value set to Dead status.
3. Open the Dashboard → confirm the "Churned Clients" card count increases and shows the lost MRR total.
4. Tap the card → confirm a modal lists churned clients sorted by lost MRR, and tapping a row opens that client's detail sheet.

## Step 90 — "Goal Pace" indicator on the Monthly Revenue Goal card

The Monthly Revenue Goal card only ever showed a static "% of target" bar — 40% on day 5 and 40% on day 28 looked identical, even though one is on track and the other is a crisis already baked in. The card now also shows a small "On pace" / "Behind pace" pill, comparing actual progress against straight-line expected pacing (days elapsed ÷ days in the month), plus a "$X/day needed to catch up" hint when behind — so the team gets an early, actionable signal instead of discovering the miss on the last day. No schema change — purely a derived calculation from the existing `store.monthlyGoal.target_mrr` and the already-computed projected MRR from signed clients. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Set a Monthly Revenue Goal (via "Set Goal" on the Dashboard) higher than your current signed MRR.
3. Confirm the goal card shows an "On pace" or "Behind pace" pill beneath the progress bar, matching whether signed MRR is ahead of or behind where straight-line pacing expects it to be today.
4. If behind pace, confirm a "$X/day needed to catch up" hint appears alongside the pill.

## Step 91 — "Top Clients by Revenue" on Invoices

Nothing in the app ranked clients by how much revenue they've actually paid — "Outstanding by Client" (Step 67) is a collections tool for unpaid invoices, "Revenue by Niche/Tier" aggregates by category rather than individual client, and "Client Statement" is a per-client document you open one at a time. Invoices now shows a "Top client by revenue" card (highest lifetime paid total), tappable into a full ranked list of every client with at least one paid invoice, sorted highest-first — useful for prioritizing account-management attention, upsell/renewal conversations, and referral asks toward the accounts actually generating the most revenue. No schema change — reuses the existing `invoices.amount`/`status`/`prospect_id` fields already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Mark invoices for at least two different clients as Paid, with different total amounts.
3. Open Invoices → confirm a "Top client by revenue" card shows the client with the highest lifetime paid total.
4. Tap the card → confirm a modal ranks all paying clients highest-first, and tapping a row opens that client's Prospect Detail.

## Step 92 — "Value Awaiting Signature" stat card on Contracts

"Awaiting Signature 5+ days" already flags *how many* pending contracts are stale, but not what they're collectively worth — an owner could see "3 contracts are stale" with no sense of whether that's $500 or $50,000 on the table. Contracts now shows a "Value Awaiting Signature" card — the total dollar value of every contract currently in `sent` status, regardless of age — tappable into a drill-down ranking those pending deals by value, highest first, so the team can prioritize chasing the biggest deal rather than just the oldest one. No schema change — reuses the existing `contracts.value`/`status`/`sent_date` fields already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Send at least two contracts (mark them "Sent") with different values.
3. Open Contracts → confirm a "Value Awaiting Signature" card shows the combined total and contract count.
4. Tap the card → confirm a modal ranks pending contracts by value, highest first, and tapping a row opens that contract.

## Step 93 — "Reply Rate" stat card on the Team page

Win Rate (signed ÷ engaged) conflates two very different skills into one number: getting a reply at all, and closing once engaged. An agent with a low win rate but a high reply rate needs closing coaching; one with a low reply rate needs help with messaging or targeting — and nothing in the app isolated the first step per individual. The Team page's "My Performance" section now shows a "Reply Rate" card alongside Win Rate: of everyone you've actually contacted (same `engaged` denominator Win Rate already uses), what percent replied, booked a meeting, or signed. No schema change — reuses the existing `prospects.assigned_to`/`status` fields already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. As an assigned agent, move a few of your prospects from "Not Contacted" to "Sent", and move a couple of those to "Replied" or "Meeting Booked".
3. Open Team → confirm a "Reply Rate" card appears in My Performance next to Win Rate, showing the percent of contacted prospects that replied or moved further.

## Step 94 — "Outreach Message Origin" breakdown on Message Kit

The existing "No personalization" flag on Message Kit audits *templates* — it can't tell you what actually went out to real prospects. Pipeline shows a "REVIEW MESSAGE" pill and Prospect Detail shows an "AI-GENERATED" tag one prospect at a time, but nothing rolled either up across the whole team's outreach. Message Kit now shows three stat cards — AI-Generated, Auto-Template, Manual — counting every contacted prospect (`status !== "not_contacted"`) by their `message_source`, so an owner can answer "how much of our live outreach is actually AI-personalized vs. still raw auto-template vs. hand-written?" at a glance. Each card is tappable into a list of the prospects in that bucket, jumping straight into Prospect Detail. No schema change — `prospects.message_source` already exists (`manual` | `ai_generated` | `auto_template`) and is already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Make sure a few prospects have been contacted with different message origins (send at least one AI-researched prospect's message, one auto-template, one manual).
3. Open Message Kit → confirm three stat cards (AI-Generated / Auto-Template / Manual) appear above the templates list with correct counts.
4. Tap a card → confirm a modal lists the matching prospects, and tapping a row opens that prospect's detail sheet.

## Step 95 — "View Performance" drill-down on teammate cards (owner view)

"My Performance" (Step 84) only ever shows the logged-in agent their own Active Leads / Signed / MRR / Win Rate / Reply Rate — there was no way for anyone else to see it. Team Workload on the Dashboard is owner-only but only shows a raw active-lead count per agent, with no signed count, MRR, or rates. So an owner checking "how is this person actually doing" had no option but to manually filter Pipeline by assignee and eyeball it. Each teammate's card on the Team page now has an owner-only "View Performance" link (next to the existing "Remove access" control) that opens the same stat breakdown as My Performance, computed for that person. No schema change — reuses the existing `myPerformanceStats()` calculation (now parameterized by agent id instead of hardcoded to the logged-in user) against `prospects.assigned_to`/`status`/`mrr`, already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Sign in as an owner with at least one other active team member who has assigned prospects.
3. Open Team → confirm a "View Performance" link appears on that teammate's card (not on your own card, and not for removed/inactive members).
4. Tap it → confirm a modal shows their Active Leads / Signed / MRR Won / Win Rate / Reply Rate, and tapping the Signed or MRR card lists their signed clients.

## Step 96 — Global Search now matches contact details

Global Search only ever matched a prospect's business name, area, or city — not their WhatsApp number, email, or Instagram handle, even though all three are already loaded on every prospect record. Agents constantly have a raw contact detail in hand (from a reply, a referral, or before adding a new lead) and need a quick "is this prospect already in the pipeline?" check; previously that meant scrolling Pipeline by hand. Global Search's Prospects match now also checks `whatsapp_number`, `email`, and `instagram`, and when a result matched on a contact field rather than name/area/city, the result row shows which one matched so it's clear why it showed up. No schema change — reuses the existing `prospects.whatsapp_number`/`email`/`instagram` columns already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Note a prospect's WhatsApp number, email, or Instagram handle from an existing pipeline entry.
3. Open Global Search and type that value (at least the minimum character count) — confirm the prospect appears in the Prospects group even though the name/area don't match, and the row's subtitle shows the matched contact detail.

## Step 97 — "Due Soon" flag + stat card on Projects

Overdue only ever fires once a delivery deadline is already blown — a project due in 2 days looked visually identical to one due in 6 weeks right up until the moment it flipped to Overdue, giving the team no advance warning. Projects now flags any in-flight project (not complete, not already overdue) with a due date within the next 3 days as "Due in Xd," and a new stat card counts them, tappable into a soonest-first drill-down list. Mirrors the "Due Soon" idiom Invoices (Step 69) already uses for payment deadlines — same proactive-warning pattern, applied here to delivery deadlines instead, so it's not a duplicate. No schema change — reuses the existing `projects.due_date`/`status` columns already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Set a project's due date to 1–2 days from today, and make sure its status isn't Complete.
3. Open Projects → confirm a "Due within 3 days" stat card appears next to Avg. Delivery Time, and the project's card shows a "Due in Xd" pill instead of its usual status area.
4. Tap the stat card → confirm a modal lists projects due soonest-first, and tapping a row opens that project.

## Step 98 — Website link on Prospect Detail

The `website` field has been captured on every prospect form since the start, and Pipeline already flags its *absence* ("No Website," Step 83) — but nothing ever displayed the value when it *was* saved. An agent checking a lead's current site (to reference "your site looks outdated" in outreach, or just verify the business before a call) had to leave the app and search for it manually, even though the exact URL was already sitting on the record. The Contact card on Prospect Detail now shows a 🌐 row with a tappable link whenever `website` is set, alongside the existing WhatsApp/email/Instagram rows — normalizing to `https://` when the saved value has no protocol (the form's own placeholder, "www.business.co.zw," makes clear it's usually saved without one). No schema change — reuses the existing `prospects.website` column already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Add or edit a prospect and save a website value (with or without `https://`).
3. Open that prospect's detail sheet → confirm a 🌐 row appears in the Contact card and tapping it opens the site in a new tab.

## Step 99 — "Win Rate by Heat Score" on Pipeline Value

Heat Score is a hand-assigned 0–100 gut-feel rating used throughout the app to sort and prioritize leads (Pipeline's sort-by-heat, Daily Plan's priority leads) — but nothing has ever checked whether it's actually predictive. Win Rate by Niche and Win Rate by Agent already group conversion by category and by person; this adds heat score itself as a new grouping axis, bucketing engaged prospects into Cold (0-39), Warm (40-69), and Hot (70-100) bands and showing win rate for each. If Hot leads consistently outperform Cold ones, it validates every heat-score-driven prioritization elsewhere in the app; if they don't, it's a signal the scoring habit needs rethinking. No schema change — reuses the existing `prospects.heat_score`/`status` columns already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Make sure prospects across a range of heat scores have been contacted (moved past Not Contacted), with some signed.
3. Open Pipeline Value → confirm a "Win Rate by Heat Score" section appears below Win Rate by Agent, showing Cold/Warm/Hot bands each with a win % and signed/total count.

## Step 100 — "Billed With No Contract" flag on Invoices

Invoices can be created with no contract linked — the form's "Linked contract" dropdown defaults to none — and nothing today ever checked whether money actually billed or collected (`sent`/`paid` status) has any signed paperwork behind it. That's a real compliance gap: if a client disputes a bill, there's nothing to point to. Invoices now shows a stat card counting sent/paid invoices with no `contract_id`, tappable into a list of the offending invoices; tapping one opens its edit sheet where the existing contract dropdown lets a rep fix it in one tap. Distinct from every other Invoices flag (Stale Draft, Due Soon, Outstanding) — none of those inspect `contract_id`, and distinct from Contracts' "Draft First Invoice" prompt (Step 59), which nudges the opposite direction at signing time rather than auditing invoices already billed. No schema change — reuses the existing `invoices.contract_id`/`status` columns already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Create or edit an invoice, mark it Sent or Paid, and leave "Linked contract" set to none.
3. Open Invoices → confirm a "Billed with no contract on file" stat card appears with the correct count.
4. Tap it → confirm a modal lists the affected invoices, and tapping one opens its edit sheet.

## Step 101 — "Jump to Prospect" links on Team Activity

Team Activity already told you *what* happened ("Jane moved Acme Co. to Signed") but every row was dead text — no way to get from the feed to the actual record without leaving the tab and searching manually. Rows in the feed whose `activity_log` entry has a linked `prospect_id` are now clickable, opening that prospect's detail sheet directly (same click-through pattern used by every other drill-down list in the app). Rows with no linked prospect (general/system messages) stay plain, unclickable text — no visual change there. This closes a feed-to-record navigation gap that's existed since Step 43 added activity filtering/search. No schema change — reuses `activity_log.prospect_id`, a column already being fetched into `store.activityLog` but never read by the render logic until now. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Do something that logs activity against a specific prospect (move a stage, log an outreach, etc.).
3. Open Team Activity → confirm that row's cursor changes to a pointer on hover.
4. Tap the row → confirm it opens that prospect's detail sheet.
5. Confirm rows with no linked prospect (if any appear) remain plain and unclickable.

## Step 102 — "Revenue by City" breakdown on Pipeline Value

Pipeline Value already breaks signed revenue down by Niche and by Tier, but nothing showed which city is actually converting into paying clients — even though City is a first-class prospect field with its own filter chip on Pipeline (Step 9) and its own DB index. An agency prospecting across multiple cities (Harare, Bulawayo, and beyond) had no way to see "should we keep prospecting in X or double down on Y" at a glance. Pipeline Value now has a "Revenue by City" stat grid, same visual pattern as Revenue by Niche/Tier, sorted highest-revenue-first, showing each city's signed MRR and client count. No schema change — reuses the existing `prospects.city`/`mrr`/`status` columns already loaded into the client store (same data Revenue by Niche/Tier already reads). No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Make sure signed clients exist across more than one city (or set/change a prospect's City field before signing).
3. Open Pipeline Value → confirm a "Revenue by City" section appears below Revenue by Tier, showing each city's signed MRR and client count, sorted by revenue descending.

## Step 103 — "Hot Areas" win-rate breakdown on Niche Strategy

Niche Strategy already reality-checks conversion by niche, and Pipeline Value now does it by city — but neither looks at the `area` field, the actual neighborhood an agent typed while scouting a lead (e.g. "Borrowdale" vs "CBD"), which is a finer grain than the broad city field. Niche Strategy now shows a "Hot Areas" card listing the top areas by signed-conversion rate (minimum 3 prospects logged, so a single 1-for-1 lead can't look like a 100% hotspot), plus a "View All Areas" link opening a full sorted list — so the team can see which specific pockets of a city are actually converting and point new prospecting/door-knocking effort there instead of just wherever leads happen to get logged. No schema change — reuses the existing `prospects.area`/`status` columns already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Make sure at least 3 prospects share the same Area value, with at least one signed.
3. Open Niche Strategy → confirm a "Hot Areas" card appears above the niche list, showing each qualifying area with its signed/total count and win %.
4. Tap "View All Areas" → confirm a modal lists every area with at least one prospect, sorted by win rate.

## Step 104 — "Client Anniversaries" widget on the Dashboard

Churned Clients and Win-Back Candidates both react to leads already gone; Revenue at Risk watches for warning signs on clients already showing trouble. Nothing was forward-looking about the one relationship checkpoint every retainer agency cares about: the 1-year mark since a client signed. The Dashboard's Business Snapshot section now shows a "Client Anniversaries" card counting signed clients within 30 days of a yearly sign-up anniversary (before or after), based on their earliest signed contract — tapping it opens a list with each client's MRR, years signed, and days until/since the anniversary, sorted soonest-first, so it's a natural nudge to reach out for a renewal check-in before a happy client goes quiet or a competitor gets there first. No schema change — reuses `contracts.status`/`signed_date`/`prospect_id` and `prospects.status`/`mrr`, all already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Make sure a signed contract exists with a `signed_date` roughly 1 year ago (edit an existing contract's Signed Date if needed, within 30 days of today's date one year back).
3. Open Dashboard → confirm a "Client Anniversaries" card appears in the Business Snapshot section with the correct count.
4. Tap it → confirm a modal lists the affected client(s) with MRR, years signed, and days until/since their anniversary.

## Step 105 — "Share Weekly Recap" on the Dashboard

Every number a weekly update needs — new leads, contracts signed, cash collected, active pipeline MRR, top performer — already lives somewhere in the app, but pulling them together into a message today means visiting Contracts, Invoices, and Team separately and typing it out by hand. WhatsApp-share is already an established pattern here for individual records (payment reminders, contracts) — this applies the same idea to an aggregate weekly rollup. A new "Share Update" link next to the Dashboard title builds a plain-text recap (last 7 days) and opens WhatsApp's contact/group picker (`wa.me/?text=...`, no number attached) so it can be pasted into a team group, a client update, or anywhere else. No schema change — reuses `prospects.created_at`/`status`/`mrr`/`assigned_to`, `contracts.status`/`signed_date`/`value`, and `invoices.status`/`paid_date`/`amount`, all already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open Dashboard → confirm a "Share Update" link appears next to the page title.
3. Tap it → confirm WhatsApp opens (contact/group picker) with a pre-filled recap message covering new leads, signed contracts, collected cash, active MRR, and top performer for the last 7 days.

## Step 106 — "Ready to Close" flag + filter on Projects

The project checklist and the Status dropdown are two separate manual steps — a rep ticks off every deliverable but forgets the extra click to flip Status to "Complete." That leaves finished work permanently misclassified as in-progress: it never counts toward the existing Avg. Delivery Time stat (which only looks at `status = 'complete'` rows), so delivery-time numbers stay skewed, and an owner scanning "in progress" work has no way to tell it's actually done and ready to invoice. Projects now flags any non-complete project whose checklist has at least one item and every item is checked off with a green "All tasks done" badge, plus a "Ready to Close" filter chip and a matching CSV export label — same flag-it-don't-guess-why pattern as the existing Overdue/Idle flags. No schema change — reuses the existing `projects.status` and `project_tasks.done`/`project_id` columns already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open a project that isn't marked Complete, add a checklist item, and check it off (make sure every item on the checklist is checked).
3. Go back to the Projects list → confirm that project shows a green "All tasks done" badge and sorts near the top.
4. Tap the "Ready to Close" chip → confirm only qualifying projects show.
5. Export CSV with the chip active → confirm the Status column is prefixed "Ready to close —".

## Step 107 — "Research Failed" flag + filter on Pipeline

AI Research writes one of `pending` / `researching` / `done` / `failed` to `research_status` when a lookup finishes — but the client only ever checked "has it run," treating `failed` identically to a successful `done`. A crashed lookup rendered exactly like a real one that just came up empty, so a dead-end lead (no research summary, likely stuck with a weak generic outreach message) was invisible unless someone happened to open that exact card. Pipeline cards now show a red "RESEARCH FAILED" badge next to the researching/summary badges when `research_status = 'failed'`, plus a "Research Failed" filter chip to batch-triage and re-run them. Prospect Detail's research summary also now distinguishes a failed run ("AI research couldn't complete for this business — try again.") from a genuinely empty one ("No summary saved."). No schema change — reuses the existing `prospects.research_status` enum column, already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Get (or manually set) a prospect's `research_status` to `failed`.
3. Open Pipeline → confirm that prospect's card shows a red "RESEARCH FAILED" badge.
4. Tap the "Research Failed" chip → confirm only prospects with a failed research run show.
5. Open that prospect's detail sheet → confirm the research summary area shows "AI research couldn't complete for this business — try again." instead of "No summary saved."

## Step 108 — "Best Day to Send" breakdown on Pipeline Value

Every breakdown on Pipeline Value groups outcomes by *who/what* (niche, agent, heat score) or *how long* (Average Time in Stage) — nothing looked at *when* outreach actually goes out. Reps tend to guess "don't send on weekends" without ever checking their own team's numbers. Pipeline Value now shows a "Best Day to Send" grid: for each weekday, the reply rate of first-outreach messages sent on that day, computed by matching each prospect's "sent" status-history transition to the day of week and checking whether a later "replied" transition followed — so the team can see, from their own data, which days their outreach actually lands. Zero new Supabase query — it reuses the same 90-day `status_history` fetch already pulled in for Average Time in Stage. No schema change, no new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Make sure some prospects have been moved to "Sent" (and a few to "Replied") on different days of the week within the last 90 days.
3. Open Pipeline Value → confirm a "Best Day to Send" section appears below Average Time in Stage, showing each weekday's reply % and send count (days with no sends show "—").

## Step 109 — "Outstanding by Age" breakdown on Invoices

Invoices already shows a single "Outstanding" total and an "Outstanding by Client" drill-down (grouped by who owes it), but nothing said whether that total is healthy — mostly not-yet-due — or a real collections problem — mostly weeks late. Invoices now shows an "Outstanding by Age" stat grid, standard AR-aging buckets (Not Yet Due, 1–15 / 16–30 / 31+ Days Overdue, No Due Date), each showing the count and $ total of sent invoices in that band; tapping a bucket opens a worst-first list that jumps straight into an invoice's edit sheet. No schema change — reuses the existing `invoices.status`/`due_date`/`amount`/`prospect_id` columns already loaded into the client store, and the same `daysUntilDue()` helper the Due Soon flag already uses. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Make sure a few Sent invoices exist with different due dates (some future, some 1-15 days late, some 30+ days late, one with no due date).
3. Open Invoices → confirm an "Outstanding by Age" section appears below the other stat cards, with a card per non-empty age band showing the $ total and invoice count.
4. Tap a bucket → confirm a modal lists just that band's invoices, worst-overdue first, and tapping one opens its edit sheet.

## Step 110 — "Win Rate by Tier" breakdown on Pipeline Value

Pipeline Value already checks whether the team's hand-assigned Heat Score actually predicts outcomes (Step 99) — but the other hand-assigned prioritization field, Tier (A/B/C), only ever showed up as a revenue total (Revenue by Tier, Step 15), never as a conversion check. Pipeline Value now shows a "Win Rate by Tier" grid alongside the existing Win Rate by Niche/Agent/Heat Score breakdowns, so the team can see whether their top-priority "A" tier leads actually close more often, or whether tiering habits need a rethink. No schema change — reuses the existing `prospects.tier`/`status` columns already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Make sure prospects across different tiers (A/B/C) have been moved past Not Contacted, with at least one signed.
3. Open Pipeline Value → confirm a "Win Rate by Tier" section appears below Win Rate by Heat Score, showing each tier's win % and signed/total count.

## Step 111 — "Assign at Creation" on the Add Prospect form

Assignment only ever happened after the fact — Prospect Detail's Reassign dropdown, or Pipeline's bulk-assign/Distribute Evenly — so an owner hand-entering a lead they already know the right agent for (a phone call, a walk-in referral) had to save it, then reopen it just to hand it off. An agent adding their own found lead had no way to explicitly claim it either. The Add Prospect form (`prospectForm.js`, creation only — editing still uses Prospect Detail's existing Reassign control) now shows an "Assign to" dropdown for owners, or an "Assign this prospect to me" checkbox for agents, right where every other prospect detail is being entered. No schema change — reuses the existing `prospects.assigned_to` column and its existing insert RLS policy (owner → anyone or unassigned; agent → self or unassigned), so no permission changes are needed. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. As an owner, tap "+ New Prospect" → confirm an "Assign to" dropdown appears, listing active teammates → pick one, save, and confirm the new prospect shows that teammate as assigned.
3. As a non-owner agent, tap "+ New Prospect" → confirm an "Assign this prospect to me" checkbox appears instead → check it, save, and confirm the prospect is assigned to you.
4. Edit an existing prospect → confirm no assignment field appears on the Edit form (unchanged from before — reassignment still happens from Prospect Detail).

## Step 112 — "Notes Catch-Up" on Daily Plan

A rep's real context on a lead ("asked for a discount", "wants samples first") lives in prospect notes, but the only way to see it was opening one prospect's detail sheet at a time — Team Activity logs *that* a note was left, never its content, and scrolls fast since it mixes in every status change and assignment too. Daily Plan now shows a "Notes Catch-Up" section, the most recent notes logged across the leads a rep can see (their own, or the whole org for an owner — same RLS scoping the Deal Pricing Calculator's "Recent Quotes" panel already relies on), so anyone opening the app can catch up on what happened without hunting prospect by prospect. Tapping a note opens that prospect's detail sheet. No schema change — reuses the existing `prospect_notes` table and its existing read RLS policy. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Add a note to a prospect from its detail sheet.
3. Open Daily Plan → confirm a "Notes Catch-Up" section appears below Today's Priority Leads, showing that note with the business name, a preview of the text, who left it, and how long ago.
4. Tap the note → confirm it opens that prospect's detail sheet.

## Step 113 — "Avg. Deal Size" on Contracts

Contracts already showed "Avg. Days to Sign" (how fast deals close) but nothing about how big they are — an owner sizing up the pipeline or coaching an agent on pricing had no quick read on typical deal value, only a Total Contract Value figure with no per-deal sense of it. Contracts now shows an "Avg. Deal Size" stat card (average of every signed contract's value, skipping any signed contract left at $0/blank), and tapping it opens a "Biggest Signed Deals" list sorted largest-first so the team can see which wins are driving that average and jump straight to any one of them. No schema change — reuses the existing `contracts.value` column already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Make sure a few contracts are marked Signed with different dollar values entered, and (optionally) one signed contract with no value set.
3. Open Contracts → confirm an "Avg. Deal Size" stat card appears below Avg. Days to Sign, showing the average across signed contracts with a value.
4. Tap the card → confirm a modal lists signed contracts largest-value-first, and tapping one opens its contract sheet.

## Step 114 — "Lost Reasons" capture + breakdown

Every other stage of the funnel gets analyzed for what's working — win rate by niche, agent, heat score, tier — but the moment a prospect gets marked Dead, the reason why vanishes. Nobody could tell if the team was losing on price, going quiet on follow-up, or losing to competitors, so nothing ever got fixed at the root. Moving a prospect to Dead on its detail sheet now pops a one-tap reason picker (Price too high, Went quiet, Chose a competitor, Not a good fit, Bad timing, or a free-text "Other") — skippable by tapping the backdrop — and Pipeline Value now shows a "Lost Reasons" tally rolled up from whatever's been picked. No schema change — reuses the existing `prospect_notes` table the same way the Deal Pricing Calculator's "Recent Quotes" panel (Step 75) already stores structured data as a marker-prefixed note, so it inherits that table's existing RLS scoping for free. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open a prospect and change its status to Dead → confirm a "Why did this one die?" prompt appears with reason chips and an "Other" text box.
3. Tap a reason (or type one into Other and save) → confirm a toast confirms it saved, and it now shows up in that prospect's own Notes tab.
4. Move a prospect to Dead and tap the backdrop instead of picking a reason → confirm it's skippable with no error.
5. Open Pipeline Value → confirm a "Lost Reasons" section appears below Best Day to Send, tallying the reasons picked so far.

## Step 115 — "Void Rate" stat card + drill-down on Contracts

Contracts has had a `void` status alongside draft/sent/signed since the schema was first written, and it's fully wired as a manual filter chip — but nothing anywhere aggregates it. A deal that gets drafted, or even sent, and then falls through is a materially different signal than one that simply never got sent, yet it's been invisible unless someone manually clicked the "Void" chip and counted by eye. Contracts already tracks speed (Avg. Days to Sign) and size (Avg. Deal Size) — this adds the missing "how often does a committed deal actually fall through" health check as a "Void Rate" stat card, with a drill-down listing the voided contracts themselves, most-recent first. No schema change — reuses the existing `contracts.status`/`value`/`updated_at` columns already loaded into the client store. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Make sure at least one contract is marked Void (and at least one Signed, so there's a denominator).
3. Open Contracts → confirm a "Void Rate" stat card appears below Avg. Days to Sign / Avg. Deal Size / Awaiting Signature, showing the % of signed-or-void contracts that were voided.
4. Tap the card → confirm a modal lists the voided contracts, most-recently-voided first, and tapping one opens its contract sheet.

## Step 116 — "Quote Conversion Rate" breakdown on Pipeline Value

The Deal Pricing Calculator's "Save Quote to Prospect" button (Step 75's Recent Quotes panel) has quietly been tagging prospect notes every time a rep quotes a lead a real number — but nothing ever checked whether that actually correlates with closing. Every other lens on Pipeline Value groups win rate by a hand-assigned attribute (niche, agent, heat score, tier); this is the first that groups it by an actual sales action. Pipeline Value now shows a "Quote Conversion Rate" grid splitting contacted prospects into "Got a Quote" vs. "No Quote Saved" and comparing their win rates, so the team can see whether pitching with a firm number helps close deals or scares price-sensitive leads off. No schema change — reuses the existing `prospect_notes` table via the same marker-prefixed-note trick Lost Reasons (Step 114) and the calculator's own Recent Quotes panel (Step 75) already established, plus the existing `prospects.status` column. No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Save at least one quote to a prospect from the Deal Pricing Calculator, and make sure some contacted prospects have never had a quote saved.
3. Open Pipeline Value → confirm a "Quote Conversion Rate" section appears below Lost Reasons, showing win % and signed/total counts for "Got a Quote" vs. "No Quote Saved".

## Step 117 — "No Contact Info" heads-up on Bulk Import preview

Pipeline already flags a prospect with no WhatsApp, email, or Instagram as "Unreachable" (Step 79) — but only after it's already been imported and is sitting in the pipeline looking like normal backlog. Bulk Import's preview screen already warns about possible duplicates and unmatched niche names before you commit, but said nothing if a pasted row has zero contact methods at all. It now reuses that exact same check at preview time, so whoever's pasting a scraped list catches "this lead has no way to be contacted" before it's committed, not days later when it turns up under Pipeline's Unreachable filter. Purely a heads-up, not a block — a business with no contact info today might still be worth having on file for later enrichment. No schema change — reuses the existing `prospects.whatsapp_number`/`email`/`instagram` columns and Pipeline's own `hasNoContactMethod()` check (now exported so both views share one source of truth instead of duplicating the logic). No new secrets.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Paste a batch of rows into Bulk Import where at least one row has no WhatsApp, email, or Instagram column filled in.
3. Tap Preview → confirm a "⚠ N row(s) have no WhatsApp, email, or Instagram" card appears listing those rows by name, and importing still works normally.

## Step 118 — Client Grid Plan Review (Slice 1: data model + team roles)

First slice of a bigger feature: the agency builds a grid of upcoming social posts, sends a client a private link, and the client reviews/comments/approves in-browser with no login — with everything syncing live back to the team. This slice is **database only** — it adds the tables and widens team roles, but nothing in the app UI uses them yet, so there is nothing to click-test. It exists so later slices (the agency plan builder, then the public review page, then live sync) have a foundation to build on without changing the data model out from under them.

What it adds: four new tables — `grid_plans` (one per client review), `grid_posts` (one per grid tile: caption, a *separate* short client-note field, status, position), `grid_post_media` (images/video per post), and `grid_activity` (an audit trail mirroring the existing `activity_log` pattern, auto-logging every caption/note/status/position change plus who made it) — all scoped by the existing `organizations`/`org_id` multi-tenancy, with RLS enabled and **no public/anon policy on any of them**. It also adds a private Storage bucket, `grid-media` (unlike the public `avatars` bucket, this one only ever serves files via signed URLs). Team roles widen from just owner/agent to also allow `manager`, `designer`, and `contributor` — existing owner/agent behavior is unchanged everywhere else in the app; the new roles only gate grid-plan permissions (designers can edit content but not send a plan to a client; contributors are read-only). The public, no-login client review page that comes in a later slice will never talk to Supabase directly with the anon key — it'll go through dedicated Edge Functions using the service-role key, which is why these tables have no public policies at all.

1. Open **`supabase/migration_grid_roles.sql`**, select all, copy, paste into the SQL Editor, click **Run**. You should see "Success. No rows returned."
2. Open **`supabase/migration_grid_plans.sql`**, select all, copy, paste into the SQL Editor, click **Run**. You should see "Success. No rows returned."
3. In the Supabase dashboard, Table Editor → confirm `grid_plans`, `grid_posts`, `grid_post_media`, and `grid_activity` now exist, each with RLS enabled (shield icon).
4. Storage → confirm a `grid-media` bucket exists and is marked **Private** (not Public), unlike `avatars`.
5. Nothing to redeploy yet — no frontend files changed in this slice.

## Step 119 — Client Grid Plan Review (Slice 2: Team role picker)

Second slice: lets an owner actually assign the three new grid-plan roles from Step 118 (Manager, Designer, Contributor) to a teammate, instead of them only existing in the database. The Team screen's existing role dropdown (owner-only, same one already used to promote someone to Owner) now offers all five roles, and picking one of the three new ones shows a one-line hint under that person's card explaining what it unlocks, so an owner doesn't have to go look up the permission matrix. No behavior changes for existing Agent/Owner roles — every other screen in the app still only checks "is this the owner or not," so this is purely additive. Nothing to test yet on the grid-plan side itself (Slice 3 is the first screen that actually reads these roles) — this step is just so an owner can pre-assign roles to their team before that screen ships.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. Open Team as the owner → pick a teammate → change their role to Manager, Designer, or Contributor in the dropdown → confirm it saves ("Role updated" toast) and a short explanation of what that role can do appears under their name.
3. Confirm switching someone back to Agent or Owner removes that hint and everything else about them (their pipeline access, performance stats, etc.) is unaffected.

## Step 120 — Client Grid Plan Review (Slice 3: Agency grid plan builder)

Third slice: the actual screen your team uses to build a client's grid. A new **Grid Plans** entry in the sidebar (under Business, right below Projects) opens a plans list — Owner/Manager/Agent see a "+ New Plan" link; Designers can open and edit an existing plan's posts but can't create or delete a plan or send it to a client; Contributors can only look. Opening a plan shows a drag-reorderable grid of post tiles (tap a tile to edit its caption, upload photos/video, set a platform and post date). Every post also has a separate **Client note** field, deliberately styled with a dashed gold border and a warning label so it can never be mistaken for the caption — the spec called this out explicitly after a client once pasted an entire rewritten caption into the wrong box by accident. A "Share with Client" button generates a private link and flips the plan to "Shared" status.

**Important — the share link doesn't work yet.** It's real (a long random token gets saved to the plan), but the public page a client would land on (`review.html`, no login required) hasn't been built — that's the next slice. Clicking "Share with Client" or "Copy Share Link" right now just says so in the confirmation toast. Nothing is broken; there's just nothing live to click through to yet. Don't send a real client a link generated at this step.

No schema changes — this slice only adds the screen itself (`app/js/views/gridPlans.js`), wired into the sidebar and the app's view-switcher, using the tables and roles from Steps 118–119 and the drag-reorder helper added to `app/js/utils.js` alongside them.

1. Redeploy the frontend (`app/` folder) via Netlify Drop.
2. As Owner, Manager, or Agent: open **Grid Plans** in the sidebar → **+ New Plan** → enter a client name and pick an accent color → **Create Plan**. Confirm it appears in the list with that color dot and "0 posts."
3. Open the plan → **+ Add Post** → confirm an edit screen opens. Type a caption, type something in **Client note** (confirm it visually looks different — dashed gold border, warning line above it), pick a platform and a date, tap **+ Add Media** and upload a photo, then **Save Changes**. Confirm the tile now shows the photo and caption preview back on the grid.
4. Add a second post the same way, then press-and-drag the small handle icon in a tile's corner to reorder the two tiles. Confirm the new order sticks after you leave and reopen the plan.
5. Tap **Share with Client** → confirm a toast appears explaining the client page isn't live yet, and the plan's status pill changes to "Shared."
6. As a teammate set to **Designer** (Step 119): confirm you can open the plan and edit/reorder posts, but there's no "+ New Plan," "Share with Client," or "Delete Plan" option anywhere.
7. As a teammate set to **Contributor**: confirm you can see the plan list and open a plan to look at it, but every tile and button that would change something is hidden.

## Step 121 — Client Grid Plan Review (Slice 4: the public review page goes live)

Fourth slice, and the one that makes the share link from Step 120 actually work: a brand-new page, **`review.html`**, that a client opens with no login at all — just the link the agency sends them. It shows their grid, lets them drag to reorder, tap a tile to edit its caption or approve/request changes, and a **Submit My Review** button at the bottom that marks the whole plan approved (if every post is approved) or "changes requested" (if even one isn't).

That page never talks to the database directly — it only knows how to call four new small server-side functions (Supabase calls these **Edge Functions**): `review-load` (loads the plan + posts + photos), `review-update` (saves a caption or approve/request-changes on one post), `review-reorder` (saves a new tile order), and `review-complete` (the Submit button). This is deliberate: a public page with no login is the one part of this whole app a stranger on the internet can reach without an account, so instead of trusting it with the same direct database access the team's app has, it's boxed into exactly four narrow actions and nothing else — it can't see other clients' plans, can't create or delete posts, can't touch anything except the plan its own link points to. Each function is also rate-limited (capped at a handful of requests per minute per link) so a dropped connection stuck retrying, or someone poking at the link out of curiosity, can't hammer your database.

**This step has two parts: a database change, and four new server functions.** Both are one-time setup — you won't need to touch this again for future plans.

**Part A — the rate-limit table:**

1. Open **`supabase/migration_grid_rate_limit.sql`**, select all, copy, paste into the Supabase SQL Editor, click **Run**. You should see "Success. No rows returned."

**Part B — the four Edge Functions.** These use the same "Create a new function → paste → Deploy" process as every other Edge Function this app already uses (`manage-team-member`, `send-push`, etc.), so if you've done that before this will feel familiar. Repeat these steps four times, once per function:

2. In the Supabase dashboard, go to **Edge Functions** → **Create a new function**.
3. Name it **exactly** `review-load` (all lowercase, with the dash) → create it.
4. Delete whatever placeholder code is there, then open `supabase/functions/review-load/index.ts` in this project folder, select all, copy, and paste it in.
5. Click **Deploy**.
6. Repeat steps 2–5 three more times for `review-update`, `review-reorder`, and `review-complete` — each one's code lives in the matching `supabase/functions/<name>/index.ts` file. The function name in the dashboard must match the folder name exactly each time.
7. Redeploy the frontend (`app/` folder) via Netlify Drop — this ships `app/review.html` and `app/js/review.js`.

**Now the share link actually works.** Test it end-to-end:

8. As Owner/Manager/Agent, open a grid plan with at least one post that has a caption and a photo (from Step 120's test plan works fine) → tap **Share with Client** (or **Copy Share Link** if you already shared it before this step) → confirm the toast no longer says "coming soon."
9. Paste that link into a **different browser** than the one you're signed into Studio X Command with (or a private/incognito window) — this proves it truly needs no login. Confirm the plan loads: client name, accent color, and every post tile with its photo and caption.
10. On that page, drag a tile to a new position → confirm it stays there after refreshing the page.
11. Tap a tile → change the caption, tap **Save Caption** → confirm a "Caption saved" toast. If that post has a client note, confirm it shows with the same dashed-gold styling as the agency side, and that the note's textarea can't actually be typed into (it's the agency talking to the client, not the other way).
12. Tap **Approve** on every post, then tap **Submit My Review** at the bottom → add an optional note → **Submit Review** → confirm a "Plan approved!" screen appears.
13. Back in Studio X Command (the agency side), open that same plan again → confirm its status pill now reads **Approved**, and check **Activity** (or the plan's own activity, if shown) for a "Client approved the plan" entry.
14. Try the reverse: on a fresh plan, request changes on at least one post before submitting → confirm the agency side shows **Changes Requested** instead.
15. As a final check, edit the link in your browser's address bar (change a character in the `?t=` code at the end) and reload → confirm you get a plain "Can't open this review" message, not an error page or someone else's plan.

## Step 122 — Client Grid Plan Review (Slice 5: live sync, "someone's editing" indicators, and conflict protection)

Fifth slice. Two things this adds on top of Step 121:

- **Live sync both ways.** If a teammate opens a plan while the client also has the review link open (or two teammates have the same plan open), edits on either side now show up for the other automatically — no manual refresh needed. This didn't fully work before: the agency side already saw teammates' edits live, but never saw the *client's* edits without a manual refresh, and the client's page never saw the agency's edits at all.
- **"Someone's editing this" + conflict protection.** If two people open the exact same post at the exact same time, each now sees a small badge saying who else is looking at it (advisory only — it doesn't lock anyone out). And if both actually save a change to the same post around the same time, whoever saves second gets a clear choice — "Save Anyway" (your version wins, theirs is safely logged in the plan's activity history, nothing is silently lost) or "Reload Latest" (see their version first, then decide) — instead of one person's change silently overwriting the other's without either of them knowing.

No database changes this time — just two of the four Edge Functions from Step 121 need redeploying (their code changed), plus the usual frontend redeploy.

**Part A — redeploy the two changed Edge Functions:**

1. In the Supabase dashboard, go to **Edge Functions** → open **`review-load`** → replace its code with the current contents of `supabase/functions/review-load/index.ts` in this project folder → **Deploy**.
2. Do the same for **`review-update`**: open it in the dashboard → replace its code with the current contents of `supabase/functions/review-update/index.ts` → **Deploy**. (`review-reorder` and `review-complete` are unchanged this time — no need to touch those two.)

⚠️ **Before clicking Deploy, scroll to the very bottom of the pasted code and confirm it ends with the closing `function json(...) { ... }` block.** If a paste gets cut short partway through (easy to do when copying a long file by hand-selecting text), the function will either fail to deploy with a parse error, or — worse — deploy an incomplete version that silently never saves anything, even though the client-facing page still shows "saved" (this happened once during testing: the page said the edit succeeded, but the database never actually changed, because the live function was an older/incomplete copy). The safest way to copy the whole file cleanly: open the actual `index.ts` file from this project folder in a plain text editor (e.g. Finder → right-click the file → Open With → TextEdit) and copy from there, rather than selecting text out of a chat window or PDF.

**Part B — redeploy the frontend:**

3. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it end-to-end.** This one's easiest with two browser windows side by side — one signed into Studio X Command as normal, one on the client review link (private/incognito window works well for the second one):

4. In the agency window, open a grid plan and tap into a post to edit it. In the client window (same plan's review link), tap into that **same** post → confirm you see a small badge like "✎ Someone from the agency is also viewing this post right now." Close the agency side's editor and confirm that badge disappears within about 10 seconds.
5. Reverse it: have the client window editing a post, and confirm the agency side's grid shows a "✎ [name] editing" badge on that post's tile.
6. With both windows on the same plan but *not* the same post, edit a caption on the client side and save → confirm the agency side's view updates on its own within a few seconds, with no manual refresh.
7. Now the conflict test: in both windows, open the **same post's** editor at the same time. In the agency window, change the caption and save (should succeed normally). Then, in the client window — without reloading first — change the caption to something different and tap **Save Caption** → confirm you get a "This post just changed" prompt with **Reload Latest** and **Save Anyway** choices, instead of it silently overwriting the agency's edit. Try **Save Anyway** once and confirm your version sticks; on a second attempt, try **Reload Latest** and confirm it discards your local edit and shows the current version instead.
8. Drag-reorder should still work exactly as before on both sides (reordering intentionally has no conflict check — last-write-wins is correct there).

## Step 123 — Client Grid Plan Review (Slice 6: JSON export/import + a WhatsApp-ready text export)

Sixth slice. This adds three new buttons to the top of a grid plan's builder screen (next to "Share with Client" / "Delete Plan"), all agency-side only — nothing on the client's review page changed this time:

- **Export JSON** — downloads a `.json` file with the plan's name/color and every post's caption, client note, platform, and date (in order). This is a clean backup/copy of the plan's content — think of it as "save this plan to a file."
- **Export for WhatsApp** — copies a plain-text, numbered list of the plan (caption + date + platform per post) straight to your clipboard, ready to paste into a WhatsApp chat, so you can send a client a readable rundown without giving them the review link at all. If your browser blocks clipboard access it automatically downloads a `.txt` file instead.
- **Import JSON** — lets you pick a previously exported `.json` file (or a hand-written one in the same shape) and adds its posts onto the end of the current plan. Nothing is written to the database until you review a preview list and tap **Import** to confirm, and right after importing you get a one-tap **Undo Import** button in case the file was wrong.

A few deliberate limits, worth knowing about:
- **No images/video in the export/import.** Media lives in private cloud storage, not something a JSON file can carry — export/import only ever covers captions, notes, platform, and date. Add media the normal way (the "+ Add Media" button on each post) after importing.
- **Status isn't imported.** Every imported post starts as a normal new "Pending" post, even if the file says otherwise — status is meant to reflect the *client's* actual review decision, not something a file should be able to set.
- **Import needs edit access** (Owner/Manager/Agent/Designer) — same permission level as adding or editing a post normally. Export has no such restriction; anyone who can open the plan can export it.

No database changes and no Edge Function changes this time — this is entirely inside the main app's frontend code (`app/js/views/gridPlans.js`, plus one small addition already living in `app/js/utils.js`). Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. Open any grid plan with a couple of posts on it. Tap **Export JSON** → confirm a `.json` file downloads, and open it in any text editor to sanity-check it lists your posts' captions/dates/platforms.
3. Tap **Export for WhatsApp** → confirm you get a "Copied" toast, then paste (Cmd+V / Ctrl+V) into any text field (a WhatsApp chat, Notes, wherever) → confirm it reads as a clean numbered list, not raw code.
4. Tap **Import JSON** and pick the `.json` file you downloaded in step 2 → confirm a preview screen appears showing the posts about to be added, without anything saved yet → tap **Import** → confirm the posts appear at the end of the plan's grid as new "Pending" tiles.
5. Immediately tap **Undo Import** on the confirmation screen → confirm those newly-added posts disappear again from the grid.
6. Try importing that same file again, but this time tap **Done** instead of **Undo Import** → close the plan and reopen it → confirm the imported posts are still there (i.e. the import really did save, "Done" just dismisses the box without undoing anything).

## Step 124 — Client Grid Plan Review: automated security tests

This is different from every step above — there's nothing to redeploy here. This is a script that automatically double-checks the parts of this feature you told me you can't verify yourself just by clicking around: that a client's private link for one plan can never be used to see or change a *different* plan, that the "designer" team role really is blocked from manager-only actions (sharing/deleting a plan) even if someone tried to call the API directly instead of using the app, and that one agency can never see or touch another agency's data.

It lives at `scripts/security-tests.sh`. It builds two brand-new, throwaway test agencies, tries to break each of those three rules in several ways, prints PASS or FAIL for every attempt, and then deletes everything it created. It never touches your real agency's data.

**One-time setup:**

1. In Finder, go to the `scripts` folder inside this project and duplicate `security-tests.env.example`. Rename the copy to exactly `security-tests.env` (same folder).
2. In your Supabase project dashboard: **Project Settings** (gear icon, bottom left) → **API**. Under "Project API keys," find the one labeled **service_role** (NOT "anon"/"public" — this is the powerful one that must stay secret). Click reveal, and copy it.
3. Open `security-tests.env` in TextEdit and replace `paste-your-service-role-secret-key-here` with the key you just copied. Save and close.
4. **Keep `security-tests.env` private** — never paste that key into a chat, email, or anywhere else. It only needs to live in that one file on your Mac.

**Running it (every time you want to re-check this feature's security):**

5. Open the **Terminal** app (Spotlight search → type "Terminal" → Enter).
6. Type this and press Return:
   ```
   cd "/Users/kirmireelectronics/Studio X Lead Command Center/scripts"
   ```
7. Type this and press Return:
   ```
   ./security-tests.sh
   ```
8. It takes about 10-20 seconds. Read the summary at the bottom — every line should say **PASS**. If anything says **FAIL**, copy the entire Terminal output and send it over rather than trying to interpret it yourself.

Nothing in this script requires the Supabase CLI or any programming tools beyond what's already on a Mac (`curl`/`jq`, both already confirmed present on this machine).

## Step 125 — Team Leaderboard

Back to the small ongoing feature drip, on the **Team** tab this time. Owners already had "My Performance" (their own numbers only) and a one-at-a-time "View Performance" link per teammate — there was nowhere to see everyone side by side and know at a glance who's actually leading.

This adds a **Team Leaderboard** card, visible to owners only, right under "My Performance." It ranks every active teammate by **MRR won** (highest first — ties broken by win rate, then signed count), and each row shows their rank, name, avatar, signed count, win rate, and MRR. Tap any row to open that person's full performance breakdown (or your own signed-clients list, for your own row) — same drill-down that already existed, just one tap closer now.

It's built entirely from data already loaded in the app (the same numbers "My Performance" and "View Performance" already calculate) — no new database table, no new query, nothing to change in Supabase. Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. Sign in as the owner account and open the **Team** tab → confirm a "Team Leaderboard" section appears under "My Performance," listing every active teammate ranked highest-MRR-first, with your own row marked "(You)."
3. Tap a teammate's row → confirm it opens their performance breakdown (same as the existing "View Performance" link).
4. Tap your own row → confirm it opens your signed-clients list.
5. Sign in as a non-owner (agent/manager/designer/contributor) account → confirm the Team Leaderboard section does **not** appear for them — only "My Performance" (their own numbers) shows.

## Step 126 — Task Type Completion (Daily Plan)

Another small owner-only addition, this time on the **Daily Plan** tab. "Team Checklist Today" already shows which *people* are behind on their checklist, but nothing showed which *kind* of task the team tends to skip — a low completion percentage could mean everyone's scattered, or it could mean nobody ever ticks off "Follow-up" specifically. That second case is a checklist design problem, not a people problem, and there was no way to see it.

This adds a **Task Type Completion** card, owner-only, right under "Team Checklist Today." It groups today's checklist items by type (Send, Reply, Follow-up, Deposit, General) and shows a completion percentage for each, worst-first — so if one type is consistently the one left unchecked across the whole team, it jumps out immediately.

Built entirely from data already loaded in the app (the same checklist/completion records "Team Checklist Today" already uses) — no new database table, no new query. Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. Sign in as the owner → open **Daily Plan** → confirm a "Task Type Completion" section appears under "Team Checklist Today," listing each task type in use with a completion percentage and progress bar, worst-percentage type at the top.
3. Tick a checklist item off (any account) → refresh the owner's Daily Plan → confirm that type's percentage moved up accordingly.
4. Sign in as a non-owner account → confirm the "Task Type Completion" section does **not** appear for them.

## Step 127 — Quote Accuracy (Deal Pricing Calculator)

A third small addition, this time inside the **Deal Pricing Calculator** (the pricing tool opened from the More menu or from a prospect's Details screen). "Recent Quotes" already let you see every quote saved across the team — but nothing checked a quote against what a client actually signed for once the deal closed, so systematic under-pricing (agents caving on price under pressure) or over-quoting (losing deals over an unrealistic number) was invisible.

This adds a **Quote Accuracy** link next to "Recent Quotes" at the top of the calculator. It looks at every currently-**signed** client who has a saved quote, and shows "Quoted $X/mo → Signed $Y/mo" with the percentage difference — worst-first, so a client who signed well below what was quoted jumps to the top with a highlighted flag. Tapping any row opens that client's Prospect Detail.

Built from data already loaded/saved (quotes are already stored as notes, signed price is already on the prospect record) — no new database table, no new query pattern (same style query "Recent Quotes" already uses, just filtered to signed clients instead of the last 20). Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. Open the Deal Pricing Calculator for a client that's already **signed** and has a saved quote from before (or save a fresh quote to a signed client to create one) → tap **Quote Accuracy** → confirm that client appears, showing "Quoted $X/mo → Signed $Y/mo" and a percentage.
3. If the signed price is notably lower than the quote (15% or more below), confirm that row shows a highlighted flag rather than plain text.
4. Tap a row → confirm it closes the calculator and opens that client's Prospect Detail.
5. Open Quote Accuracy for an org with no signed clients (or a fresh test client with no saved quote) → confirm it shows a plain "nothing to compare yet" message instead of an error.

## Step 128 — Lifetime Value (Prospect Detail)

A fourth small addition, this time on a single prospect's own **Details** screen, in the "Business Ops" card. Invoices already has a "Top Clients by Revenue" list org-wide, but when you're looking at *one specific client*, there was no total — you had to eyeball each invoice row in their list and add it up in your head.

This adds one line right under "Business Ops": **"$X,XXX collected to date"** — the sum of every invoice for that client marked **paid** (not sent/overdue, since this is meant to answer "what have they actually paid us," not what's billed). It only appears once there's a real paid amount to show; a brand-new client with no paid invoices yet sees nothing extra.

Built entirely from data already loaded for that screen (the same invoice list already shown just below it) — no new database table, no new query. Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. Open the Details screen for a signed client who has at least one invoice marked **Paid** → confirm "$X,XXX collected to date" appears under "Business Ops," and the dollar figure matches adding up just their paid invoices (not sent/overdue ones).
3. Open a client with invoices that are all still "Sent" or "Overdue" (none paid yet) → confirm the line does **not** appear.
4. Open a client with no invoices at all → confirm nothing breaks and the Business Ops card looks the same as before this change.

## Step 129 — Grid Plans Needing Changes (Dashboard)

A fifth small addition, this time on the **Dashboard**. Client Grid Plan Review (the content-calendar tool clients approve/request changes on) has had a "changes requested" status for a while, but nothing surfaced that anywhere outside the Grid Plans screen itself — a plan a client sent back only got noticed if someone happened to open Grid Plans and spot the status pill. Everything else that needs attention (overdue projects, stale leads, at-risk clients) already has a Dashboard card; Grid Plans didn't.

This adds a **Grid Plans Needing Changes** card to the Dashboard, right after the other business cards. It counts every grid plan currently marked "Changes Requested" by a client, with a highlighted flag when there's at least one. Tapping the card lists each plan by client name, and tapping a plan takes you straight into that plan in Grid Plans (same "jump straight to it" shortcut the other Dashboard cards already use). The card only appears at all for organizations that actually use Grid Plans — it's invisible if no grid plans exist yet.

Built entirely from data already loaded for the Dashboard (the same grid plan list Grid Plans itself uses) — no new database table, no new query. Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. Open a grid plan in Grid Plans, submit it for review, then (as if you were the client) mark it "Changes Requested" → go to the Dashboard → confirm a **Grid Plans Needing Changes** card appears showing a count of at least 1, with a highlighted flag.
3. Tap that card → confirm it lists the plan by client name → tap the plan row → confirm it closes the list and takes you straight into that plan inside Grid Plans.
4. Mark that plan back to "Approved" (or resolve the changes) → return to the Dashboard → confirm the count drops and, once it's the last one, the flag disappears and the message reads "No grid plans currently waiting on changes."
5. If your organization has zero grid plans created yet, confirm the whole card is hidden rather than showing a "0."

## Step 130 — Today at a Glance (Team Activity)

A sixth small addition, on the **Team Activity** tab (visible to everyone, not just owners). The feed already lists every recent action across the team, but there was no quick way to answer "who's actually been working today" without scrolling and reading timestamps one by one.

This adds a **Today at a Glance** row right at the top of the tab: a small chip for each teammate who has logged at least one activity today, showing their name and a count, busiest person first. If nobody's logged anything yet today, it just says so.

Built entirely from the same activity feed already loaded for this screen — no new database table, no new query. One thing worth knowing: the feed only ever holds the most recent 60 actions team-wide (this was already true before this change, and every other filter on this tab already works within that same limit) — so on an unusually busy day, someone's earliest activity from that morning could get pushed out by everyone else's more recent actions and undercount slightly. It's meant as a "who's active right now" glance, not a precise daily tally. Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. Have a couple of different teammates each do something that logs activity (move a lead's status, add a note, etc.) → open **Team Activity** → confirm **Today at a Glance** shows a chip for each of them with the right count, busiest person's chip listed first.
3. Open Team Activity first thing in the morning before anyone's done anything today → confirm it shows "No activity logged yet today" instead of an empty row or an error.
4. Confirm this new row appears the same way for a non-owner teammate as it does for an owner (Team Activity isn't an owner-only tab).

## Step 131 — Status Chips (Grid Plans)

A seventh small addition, on the **Grid Plans** list itself. Every other list in the app (Contracts, Invoices, Projects) already has a row of status chips at the top showing how many are in each status, and letting you tap one to filter the list. Grid Plans was the one list left without this — it was just a bare stack of client cards, each with its own tiny status pill, and no way to see "how many plans are stuck in review" without scrolling through and eyeballing every card.

This adds that same chip row to the top of the Grid Plans list: **All**, plus one chip per status that actually has at least one plan (Draft, Shared, In Review, Changes Requested, Approved), each showing a count. Tap any chip to filter the list down to just that status; tap **All** to see everything again.

Built entirely from the grid plans already loaded for this screen — no new database table, no new query. Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. Open **Grid Plans** with a few plans in different statuses (Draft, Shared, In Review, etc.) → confirm a row of chips appears at the top, each with a count, and only for statuses that actually have plans (no chip for a status with zero plans).
3. Tap a status chip → confirm the list below filters down to just that status, and the chip highlights as active.
4. Tap **All** → confirm the full list comes back.
5. If a filtered status has zero results after some change (e.g. you just approved the only "Changes Requested" plan), confirm it shows a friendly "No grid plans match this filter" message rather than breaking, and tapping **All** still works.

## Step 132 — Common Bottlenecks (Projects)

An eighth small addition, on the **Projects** tab. Each project's checklist already shows whether *that one* project is on track — but nothing looked across every active project at once to spot a deliverable that keeps stalling team-wide. A step like "Client review round" could be sitting unchecked on three different clients' projects simultaneously and nobody would notice, since each project's own checklist looks fine in isolation.

This adds a **Common bottlenecks** card next to the existing Avg. Delivery Time / Due Soon cards. It only appears once a checklist item is unchecked on 2 or more active (not-yet-complete) projects at the same time — a one-off item on a single client's custom checklist never counts, so this only ever flags a real recurring pattern. Tapping the card opens a ranked list (worst first); tapping any item in that list expands it to show exactly which projects still have it open, and tapping one of those takes you straight to that project.

Built entirely from the project checklists already loaded for this screen — no new database table, no new query. Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. Add the same checklist item title (e.g. "Client review round") to two or more active projects, and leave it unchecked on both → open **Projects** → confirm a **Common bottlenecks** card appears.
3. Tap the card → confirm it lists that item with a count of how many projects still have it open.
4. Tap that item in the list → confirm it expands to show the specific project names → tap one → confirm it closes the list and opens that project.
5. Check that item off on all but one of those projects → refresh Projects → confirm the count drops, and once it's down to just 1 project, the item disappears from the list entirely (needs 2+ to count as a "common" bottleneck).
6. If no checklist item is currently stuck on 2+ active projects, confirm the whole card is hidden rather than showing a "0."

## Step 133 — Follow-up Overdue (Pipeline)

A ninth small addition, on the **Pipeline** list itself. "No Follow-up" already flags leads where nobody ever set a reminder date — but once a date IS set and then quietly passes, nothing in the working list catches it; it silently looks the same as a lead that's on track. The only place a blown-past date shows up today is the bell icon's "Due Today" list — a separate, read-only popup, not something you see while actually scrolling and working the Pipeline list itself.

This adds a **Follow-up Overdue** chip next to "No Follow-up" in Pipeline's filter row, plus a red flag directly on any lead card whose follow-up date has passed (today's date still counts as on-time — it only flags once the date is actually in the past, same "not yet, but about to be" cutoff Projects already uses for overdue deliveries). Tap the chip to filter the list down to just the overdue ones.

Built entirely from the same follow-up date already loaded for every lead — no new database table, no new query. Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. Open a lead in Pipeline, set its **Follow-up date** to yesterday (or any past date) → back on the Pipeline list, confirm that lead's card now shows a red "Follow-up overdue" flag.
3. Tap the new **Follow-up Overdue** chip at the top → confirm the list filters down to just leads with a passed follow-up date, and the chip highlights as active.
4. Set that same lead's follow-up date to today or a future date → confirm the flag disappears and it drops out of the Follow-up Overdue filter.
5. Confirm a lead marked **Signed** or **Dead** never shows this flag even with an old follow-up date sitting on it (those are done, not overdue).

## Step 134 — No-Website Rate (Niche Strategy)

A tenth small addition, on the **Niche Strategy** cards. Pipeline already has a "No Website" filter chip for finding leads who don't have a website yet — a strong pitch angle ("I noticed you don't have a website..."). But it's one flat, agency-wide list; nothing ever broke that down by niche, even though Niche Strategy is exactly the screen that already answers "where should the team focus outreach."

This adds a small line to each niche's card, right under its conversion rate: **"X% have no website (Y/Z) — strong opener angle"**. It only appears once a niche has at least 3 active (not signed/dead) prospects, so one lonely lead can't read as a false "100% have no website."

Built entirely from data already loaded (the same `website` field Pipeline's own "No Website" chip already checks) — no new database table, no new query. Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. Open **Niche Strategy** for a niche with at least 3 active prospects, some with a website saved and some without → confirm the new line appears with the right percentage and count.
3. Open a niche with fewer than 3 active prospects → confirm the line does **not** appear (too small a sample to be meaningful).
4. Open a niche with zero prospects at all → confirm nothing breaks and the card looks the same as before this change.

## Step 135 — Personalization by Agent (Message Kit)

An eleventh small addition, on the **Message Kit** tab, owner-only. The AI-Generated/Auto-Template/Manual stat cards there already show how much of the team's outreach is personalized agency-wide — but nothing broke that down by *who* is sending raw, un-personalized template messages versus actually customizing their outreach.

This adds a **Personalization by Agent** section (owner-only, same idiom as Team Leaderboard) ranking every agent with at least 3 contacted leads by how much of their outreach is still raw auto-template, worst first — so whoever needs a nudge to personalize their messages more surfaces at the top. An agent at 50% or higher gets a highlighted flag.

Built entirely from data already loaded (the same `message_source`/`assigned_to` fields the existing stat cards already use) — no new database table, no new query. Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. As the owner, open **Message Kit** → confirm a **Personalization by Agent** section appears, listing agents who've contacted at least 3 leads, with their raw-auto-template percentage.
3. Confirm the agent with the highest raw-template percentage appears first, and anyone at 50%+ shows a highlighted flag.
4. Log in as a non-owner agent → confirm this section does **not** appear for them.
5. If no agent has contacted at least 3 leads yet, confirm it shows a friendly "not enough data yet" message instead of an empty list or an error.

## Step 136 — Leads Sourced (Team)

A twelfth small addition, on the **Team** tab, owner-only. Every existing performance number in the app — Team Leaderboard's MRR/win-rate, Team Workload, Personalization by Agent — is keyed off who a lead is *assigned to* (who owns/closes it). Nothing ever tracked who actually *found* a lead in the first place — who added it via Bulk Import or the New Prospect form. Those can easily be different people (an owner imports a list, then hands it out to reps), and that split was completely invisible.

This adds a **Leads Sourced** ranked list right under Team Leaderboard, same rank/avatar/count style, showing how many prospects each person has personally logged into the system, all-time — busiest sourcer first.

Built entirely from data already saved on every prospect (whoever added it was already being recorded) — no new database table, no new query. Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. As the owner, open the **Team** tab → confirm a **Leads Sourced** section appears under Team Leaderboard, ranking teammates by how many leads they've added.
3. Add a new prospect yourself (via + New or Bulk Import) → refresh Team → confirm your count went up by exactly the number you added.
4. Log in as a non-owner agent → confirm this section does **not** appear for them.
5. On a fresh organization with zero leads logged yet, confirm it shows a friendly "No leads logged yet" message instead of an empty section or an error.

## Step 137 — Assigned to a Removed Teammate (Dashboard)

A thirteenth small addition, on the **Dashboard**, owner-only. When someone's access is removed from the team, any leads still assigned to them don't get automatically reassigned — they just quietly stay put. `prospectDetail.js`'s reassignment dropdown already labels that person "(removed)" if you happen to open that one lead, but there was no way to see, at a glance, how many leads across the whole pipeline are currently stuck like this.

This adds a new flagged card right under "Unassigned Leads" on the Dashboard, counting active (not signed/dead) leads still assigned to a teammate whose profile is now marked inactive. Tapping it opens the same click-through list style used everywhere else, so you can jump straight to each lead and reassign it.

Built entirely from data already loaded (`prospects.assigned_to` cross-referenced with `profiles.active`, both already fetched on every load) — no new database table, no new query. Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. As the owner, open the **Dashboard** → if no removed teammate currently has active leads assigned, confirm the card simply doesn't appear (no empty/zero card clutter).
3. To actually test the flagged state: in Team settings, mark a teammate who has at least one active (non-signed/dead) lead assigned to them as inactive/removed. Refresh the Dashboard → confirm the "Assigned to a Removed Teammate" card now appears with the correct count.
4. Tap the card → confirm it opens a list of exactly those leads, and tapping a lead in the list jumps into that prospect's detail page.
5. Reassign that lead to an active teammate (or restore the removed teammate) → refresh Dashboard → confirm the card count drops or the card disappears accordingly.
6. Log in as a non-owner agent → confirm this card never appears for them, even if one of their own leads is affected.

## Step 138 — Grid Plans in Global Search

A fourteenth small addition. Every other client-facing record — prospects, contracts, invoices, projects — has been searchable from the global search box for a while now. Grid plans were the one exception: if you typed a client's name hoping to jump straight to their content calendar, it simply wasn't there.

This adds a **Grid Plans** results group to the same search box (both the sidebar dropdown on desktop and the search sheet on phone), matching on client name exactly like contracts/invoices/projects already do. Tapping a result switches straight to the Grid Plans tab with that plan open, the same deep-link trick Dashboard already uses.

Built entirely from data already loaded (`store.gridPlans`, already fetched on every load) — no new database table, no new query. Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. Open the search box (sidebar on desktop, search icon in the topbar on phone) and type part of a grid plan client's name → confirm a **Grid Plans** group appears in the results.
3. Tap that result → confirm it switches to the Grid Plans tab with that exact plan open (not the list view).
4. Type something that matches a prospect, a contract, AND a grid plan for the same client name → confirm all three groups appear together, each still capped at 5 results.
5. Type a search term with no matches anywhere → confirm the "No matches" message still shows correctly.

## Step 139 — Stale Grid Plans Flag

A fifteenth small addition, on the **Grid Plans** tab. Contracts flags a deal that's been "Awaiting Signature" too long, and Invoices flags a draft that's been sitting too long — but a grid plan stuck in "Draft" or "Shared" with nobody touching it had no equivalent warning. It could sit there for weeks without anyone noticing until the client asked what happened to their content plan.

This adds a flagged summary card at the top of the Grid Plans list (visible to everyone who can see the list, same as the existing status chips) counting plans in Draft or Shared status that haven't been touched in 5+ days, plus an inline "Untouched Xd" flag on each affected plan's own card in place of its normal status pill.

Built entirely from data already loaded (`grid_plans.status` and `.updated_at`, the latter already auto-updated by the database whenever a plan or its posts change) — no new database table, no new query. Just the usual frontend redeploy:

1. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

2. Open **Grid Plans** → if nothing is currently stale, confirm no flagged card appears at the top (no empty/zero clutter).
3. Find (or create) a plan in Draft or Shared status that hasn't been edited in 5+ days → confirm it shows an "Untouched Xd" pill instead of its normal status pill, and confirm it's counted in the flagged card at the top.
4. Open that plan and make any small edit (move a post, change a caption) → go back to the list → confirm the flag clears immediately, since editing bumps `updated_at`.
5. Confirm a plan already marked "Approved" or "In Review" never shows the stale flag, even if it's old — only Draft/Shared plans count, since those are the ones actually waiting on someone.

## Step 140 — Services & Packages

A brand new tab, not a small addition — the first in a series of features inspired by a competitor product ("Biblo") that runs a full agency operation. **This is a schema-changing feature**, unlike every Step since 125 — it needs a one-time database update before it'll work, not just a frontend redeploy.

**What it is:** a fixed, named catalog of what the agency actually sells — "Starter Social Package — $500/mo, 5-day turnaround," "Website Refresh — $1,200 one-time," etc. This is different from the existing **Deal Pricing Calculator**, which is a market-band pricing *tool* keyed on a client's segment (small/SME/pro/large) — it doesn't know about your specific named packages at all. Services & Packages is the actual sellable menu; Deal Pricing is a sanity-check calculator. Both stay, and they don't overlap.

**Permission model:** everyone on the team can browse the catalog (so anyone quoting a client is working off the same numbers), but only the **owner** can add, edit, or delete a package — same split as the Niche Strategy Matrix, since a service catalog is a pricing/positioning decision, not day-to-day delivery work.

**What's on the new tab:**
- Active Packages / Total in Catalog counts, plus average monthly and average one-time price across active packages (whichever apply)
- Category filter chips (built automatically from whatever categories you type in — no fixed list to maintain) and a "Show Inactive" toggle
- Each package card: name, category, description, price + price type (Monthly / One-Time), turnaround estimate, and an Active/Inactive status pill
- Export CSV, same convention as Contracts/Invoices
- Owner-only "+ New Package" and tap-to-edit, with delete gated behind the same confirm-and-danger-button pattern as everywhere else

**Setup — do this first, before redeploying:**

1. Open your **Supabase Dashboard → SQL Editor**, paste in the entire contents of the new file `supabase/migration_services_packages.sql`, and click **Run**. It's safe to re-run if you're ever unsure whether it already applied. If you skip this step, the app will fail to load your data at all (it now expects a `service_packages` table to exist), so don't redeploy the frontend until this has run successfully.
2. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

3. Reload the app on your phone/browser (hard refresh if it still looks old — the service worker's cache version was bumped, but a stubborn tab can occasionally need one manual refresh).
4. As the **owner**: open the new **Services & Packages** link in the sidebar (desktop) or the **More** menu (phone) → confirm the page loads with an empty catalog and a "+ New Package" link.
5. Tap **+ New Package** → fill in a name, category, price, price type, and turnaround → save → confirm it appears in the list immediately with the right price formatting (`$X/mo` for Monthly, `$X one-time` for One-Time).
6. Tap that package again → change its price and uncheck "Active" → save → confirm it disappears from the default (active-only) view, then tap "Show Inactive" → confirm it reappears, dimmed, with an "Inactive" pill.
7. Add a second package in a different category → confirm a new category chip appears automatically, and tapping it filters the list to just that category.
8. Tap **Export CSV** → confirm a file downloads with your package(s) listed correctly.
9. Delete one of the test packages → confirm the delete confirmation dialog appears, and the package is gone after confirming.
10. Log in as (or switch to) a **non-owner** teammate → confirm they can see the full catalog and use the category/inactive filters and Export CSV, but there's no "+ New Package" link and tapping a package card does nothing (no edit sheet opens).
11. On another device (or have a teammate check), confirm a package you just added shows up there too within a second or two — this is Realtime doing its job, same as every other tab.

## Step 141 — Portfolio Studio

A brand new tab, second in the Biblo-inspired series. **This is a schema-changing feature** — it needs a one-time database update before it'll work, not just a frontend redeploy.

**What it is:** a public case-study showcase the agency can send prospects a link to — past work, results, client names, screenshots — the kind of thing that currently lives in a deck or a separate website. Inside the app, the owner curates a catalog of case studies (image, title, category, client, summary, results, an optional external link) and flips a single "Public" switch on the whole showcase. Anyone with the link — no login required — sees a clean, read-only page of whichever case studies are individually marked "Published."

**Why this one works differently under the hood:** every other shareable link in this app (the Grid Plan review page) is *private client data*, so it's protected by a random per-plan token that an Edge Function checks server-side — the database itself has no public policy at all for that table. A portfolio is the opposite: it's marketing material, meant to be found and shared. So instead of a token, this uses Supabase's own row-level security as the gate directly: the public page talks straight to the database with the read-only public key, and the database itself only ever hands back a case study if its `is_published` flag is on *and* the agency's showcase is switched to `is_public`. Flip either switch off and that content simply stops being visible to anyone outside the team — no link rotation needed. Full reasoning is in the comments at the top of `supabase/migration_portfolio.sql`.

**Permission model:** everyone on the team can browse the internal catalog read-only (so the whole team knows what's being shown off), but only the **owner** can add, edit, publish, or delete a case study, or change the showcase's headline/tagline/public switch — same split as Niches and Services & Packages, since this is a curated brand/marketing decision, not day-to-day delivery work.

**What's on the new tab:**
- A settings card showing the showcase's Public/Private status, how many case studies are currently published, and (once public) a copyable public link in the form `portfolio.html?org=<your org id>` — share that link with prospects directly
- Owner-only "Edit Showcase Settings" (headline, tagline, the public/private switch) and "+ New Case Study"
- Status filter chips (All / Published / Draft)
- Each case study card: thumbnail, title, Published/Draft pill, category/client line, and a short preview of the summary
- The case study editor supports uploading an image straight from your phone or computer (same upload flow as team avatars), plus title, category, client name, summary, results, an optional external link, and a Published on/off checkbox

**The public page itself** (`portfolio.html?org=...`) needs no login: it shows the headline/tagline and every published case study as a clean card — image, title, category/client, summary, a highlighted "Results" box if filled in, and a "View Project" button if an external link was set. If the showcase isn't public, or the link is missing/wrong, it shows a plain "not available" message instead of an error.

**Setup — do this first, before redeploying:**

1. Open your **Supabase Dashboard → SQL Editor**, paste in the entire contents of the new file `supabase/migration_portfolio.sql`, and click **Run**. It's safe to re-run if you're ever unsure whether it already applied. This creates two new tables (`portfolio_settings`, `portfolio_items`) and a new public storage bucket (`portfolio-media`) for case study images. If you skip this step, the app will fail to load your data at all, so don't redeploy the frontend until this has run successfully.
2. Redeploy the `app/` folder via Netlify Drop, same as always. Note that `portfolio.html` and `js/portfolioPublic.js` need to go up along with everything else — they're new files in the `app/` folder, not part of the installable app shell, so make sure your redeploy includes the whole folder rather than just the changed files you know about.

**Now test it:**

3. Reload the app on your phone/browser (hard refresh if it still looks old — the service worker's cache version was bumped).
4. As the **owner**: open the new **Portfolio Studio** link in the sidebar (desktop) or the **More** menu (phone) → confirm the page loads with "Set Up Showcase" and "+ New Case Study" links, and a Private status pill.
5. Tap **Set Up Showcase** → fill in a headline and tagline, leave "Public" unchecked for now → save → confirm the settings card updates.
6. Tap **+ New Case Study** → upload an image, fill in title/category/client/summary/results, leave "Published" unchecked → save → confirm it appears in the list with a Draft pill.
7. Open that case study again, check "Published" → save → confirm the pill switches to Published, and the settings card's published count goes up by one.
8. Go back to showcase settings and check "Public" → save → confirm the settings card now shows a Public status pill and a copyable public link. Tap to copy it.
9. Open that copied link (`portfolio.html?org=...`) in an incognito/private browser window (or just log out first) → confirm it loads without needing to sign in, shows your headline/tagline, and shows only the case study you published — not any drafts.
10. Go back into the app, uncheck "Public" in showcase settings → save → reload the incognito public link → confirm it now shows a "Portfolio not available" message instead of your case studies.
11. Turn "Public" back on, then in the case study editor uncheck "Published" → save → reload the public link → confirm that case study disappears from the public page (assuming it was the only one — otherwise confirm just that one is gone).
12. Log in as (or switch to) a **non-owner** teammate → confirm they can browse the internal catalog (including draft/unpublished items) read-only, but there's no "+ New Case Study" link and tapping a card does nothing (no edit sheet opens), and the showcase settings card has no "Edit" link for them either.
13. On another device (or have a teammate check), confirm a case study you just added or edited shows up there too within a second or two — this is Realtime doing its job, same as every other tab.

## Step 142 — Community Feed

A brand new tab, third in the Biblo-inspired series. **This is a schema-changing feature** — it needs a one-time database update before it'll work, not just a frontend redeploy.

**What it is:** a team-only social feed — wins, quick updates, announcements, shout-outs — the kind of thing that currently happens in a WhatsApp group with no record of it inside the app. Anyone posts, everyone can comment and like, with an optional image attached to a post.

**Permission model — deliberately the OPPOSITE of Niches/Services & Packages/Portfolio Studio:** those three are curated business/marketing decisions, so only the owner writes and the team reads. A community feed where only the owner could post wouldn't be a community, so this follows the Contracts/Invoices/Projects convention instead — **everyone posts**. The specifics:
- **Posts:** anyone can create one; the owner or the original poster can edit it; only the **owner** can delete one outright or pin/unpin it (keeps moderation in one place, discourages rage-deletes — same reasoning as Contracts/Invoices/Projects)
- **Comments:** anyone can post one; a comment's own author (or the owner) can delete it immediately — a comment is more like a chat message than a business record, so you shouldn't have to wait on the owner to remove your own typo or reply
- **Likes:** a simple one-per-person toggle per post — you can only ever like on your own behalf and only ever remove your own like

Post images use a **private, org-scoped storage bucket** (`community-media`) with signed URLs — the same pattern as Grid Plans' media, not Portfolio Studio's public bucket, since this is internal team chatter with no reason to ever leave the building.

New posts also get a single line in the Team Activity Feed ("Jane posted in the Community Feed") — comments and likes deliberately do NOT, to keep that feed from drowning in noise; the Community Feed itself is already the place to watch that traffic.

**What's on the new tab:**
- A composer at the top — write something and/or attach an image, then Post
- A reverse-chronological feed, with any pinned post(s) always at the top
- Each post shows the author's avatar/name, a relative timestamp, the text, and the image if there is one
- A heart (like) toggle with a live count, and a comment toggle with a live count that expands a thread right under the post — read and reply inline, no separate page
- Owner-only "Pin"/"Unpin" and "Delete" links on every post

**Setup — do this first, before redeploying:**

1. Open your **Supabase Dashboard → SQL Editor**, paste in the entire contents of the new file `supabase/migration_community.sql`, and click **Run**. It's safe to re-run if you're ever unsure whether it already applied. This creates three new tables (`community_posts`, `community_comments`, `community_reactions`) and a new private storage bucket (`community-media`) for post images. If you skip this step, the app will fail to load your data at all, so don't redeploy the frontend until this has run successfully.
2. Redeploy the `app/` folder via Netlify Drop, same as always.

**Now test it:**

3. Reload the app on your phone/browser (hard refresh if it still looks old — the service worker's cache version was bumped).
4. Open the new **Community Feed** link in the sidebar (desktop) or the **More** menu (phone) → confirm it loads with an empty-feed message and a composer at the top.
5. Write a short post and hit **Post** → confirm it appears at the top of the feed immediately with your name, avatar, and "just now".
6. Create a second post, this time attaching an image → confirm the image shows up once the upload finishes.
7. Tap the heart on a post → confirm it fills in and the count goes up by one; tap it again → confirm it unlikes and the count drops.
8. Tap the comment icon on a post → confirm a comment thread expands inline; write a comment and send it → confirm it appears immediately with your name and timestamp, and the count on the collapsed icon reflects it.
9. As the **owner**: tap **Pin** on an older post → confirm it jumps to the very top of the feed above newer, unpinned posts. Tap **Unpin** → confirm it drops back into normal chronological order.
10. As the **owner**: tap **Delete** on a post → confirm the delete confirmation appears, and once confirmed, the post (and its comments/likes) are gone from the feed.
11. Log in as (or switch to) a **non-owner** teammate → confirm they can post, comment, and like freely, but there's no "Pin" or "Delete" link on any post — including their own.
12. As a non-owner, confirm you CAN delete your own comment (but not someone else's), and confirm the owner can delete anyone's comment.
13. Check the **Team Activity Feed** → confirm each new post you made shows up there as a single line, but comments and likes do not.
14. On another device (or have a teammate check), confirm a new post, comment, or like shows up there too within a second or two — this is Realtime doing its job, same as every other tab.

---

## Step 143 — Lead Discovery (search Google Maps for real businesses)

A new **Discovery** tab, right next to **Prospects**. Instead of only adding prospects one-by-one or via Bulk Import, you can now search Google Maps for real businesses by niche + area (e.g. "Solar Installers in Borrowdale") and add the ones worth pursuing straight into the pipeline with one tap. **This one has a real, ongoing cost** — Google charges per search — so read the cost section before turning it on.

**What it does:** you pick a niche and (optionally) type an area, tap **Search Google Maps**, and get back a list of real businesses with their address, phone number, rating, and whether they already have a website — pulled live from Google. Anything already in your pipeline (matched by the exact Google listing) shows greyed out as **"In pipeline"** so you never add the same business twice. Check the ones worth pursuing, tap **Add Selected**, and they're added and automatically sent to AI Research (Step 8) if that's set up — same as adding a prospect by hand.

Each niche also gets an optional **"Discovery search phrase"** field (Niche Strategy → Edit Niche) — leave it blank and Discovery searches for the niche's name as-is (e.g. "Fitness & Gyms"); fill it in if you want Google to search something shorter/more natural instead (e.g. "gym").

### 143.1 — Add the new database fields

1. In Supabase, click **SQL Editor** → **New query**.
2. Open **`supabase/migration_lead_discovery.sql`** from this project folder, select all, copy it, paste into the SQL Editor, click **Run**. You should see "Success. No rows returned." Safe to run even twice.

If you're setting this up on a brand-new/empty Supabase project instead, you don't need this file separately — `supabase/schema.sql` (Step 2) already includes these fields and tables.

### 143.2 — Get a Google Maps API key (this one costs money — read this first)

Unlike the free Supabase and free-tier Anthropic setup, **Google Places API is not free** beyond a small monthly credit. You'll need a Google Cloud account with billing (a real card) attached.

1. Go to **console.cloud.google.com** and sign in with any Google account. Create a new project if you don't already have one (top-left project picker → **New Project** → give it any name, e.g. "Studio X Command").
2. In the search bar at the top, search for **"Places API (New)"** and click **Enable** on it.
3. You'll be prompted to attach a **Billing account** if you don't have one — this requires a real card. Google gives new accounts **$300 in free credit for 90 days**, and separately, Places API (New) has its own small monthly free allowance — realistically this feature is very cheap at Studio X's scale (see cost section below), but billing must still be turned on for it to work at all.
4. Go to **APIs & Services → Credentials** → **Create Credentials → API key**. Copy the key that appears.
5. **Strongly recommended:** click **Edit** on the key you just made → under **API restrictions**, choose **Restrict key** and select only **Places API (New)** → **Save**. This means even if the key ever leaked, it couldn't be used for anything except business searches.

**This key never goes into the app or any file in this project** — it only ever lives inside Supabase's secure backend, in the next step.

### 143.3 — Deploy the discover-places function

1. In Supabase, click **Edge Functions** → **Create a new function** (or **Deploy a new function**).
2. Name it exactly: `discover-places`
3. Open **`supabase/functions/discover-places/index.ts`** from this project folder, select all, copy it, and paste it into the code editor, replacing the placeholder.
4. Click **Deploy**.

### 143.4 — Add your API key as a secret

1. Still in **Edge Functions**, find **Secrets** (sometimes **Manage secrets**).
2. Add a new secret:
   - **Name**: `GOOGLE_MAPS_API_KEY`
   - **Value**: the key you copied in Step 143.2.
3. Save.

### 143.5 — Redeploy and try it

1. Redeploy the `app/` folder via Netlify Drop, same as any other update — the service worker's cache version was bumped so every phone picks up the new tab automatically.
2. Reload the app. Open **Discovery** in the sidebar (desktop) or **More → Discovery** (phone).
3. Pick a niche, optionally type an area (e.g. "Avondale"), tap **Search Google Maps**. Within a few seconds you should see a list of real businesses.
4. Check a few, tap **Add Selected** → confirm they show up in **Prospects** and (if AI Research is set up) start researching automatically.
5. Search the same niche/area again → confirm the ones you just added now show greyed out as **"In pipeline"**.

### What this costs, plainly

- Google's Places Text Search (New) costs roughly **$32 per 1,000 searches** (a "search" = one tap of the Search button, regardless of how many results come back, up to 20).
- **Safety cap**: no single teammate can trigger more than **12 searches per hour** — built into the backend function, not adjustable from the app.
- Adding a prospect from Discovery results costs nothing extra beyond the search itself — the search is the only billed step.
- You can watch actual spend anytime in Google Cloud Console under **Billing → Reports**.

If you'd rather skip this feature entirely, that's fine — everything else in the app works exactly as before, and prospects can still be added one at a time or via Bulk Import.

## Step 144 — Copilot (AI chat assistant for your team's data)

A new **Copilot** tab, right at the top of the sidebar. It's a chat box — type a question in plain English like *"who hasn't been followed up with this week?"*, *"what's our signed MRR right now?"*, or *"show me tier A prospects in the Fitness niche"*, and it answers using your team's real, current data. It's built on the same Claude AI that powers AI Research (Step 8), just given the ability to look things up instead of writing outreach messages.

**What it can see:** the same things the app already shows that teammate — an owner's Copilot can answer about the whole pipeline, an agent's Copilot only answers about prospects assigned to or added by that agent (contracts, invoices, and tasks are visible to everyone, same as elsewhere in the app). It never makes anything up — if it doesn't have a tool to look something up, it says so instead of guessing.

**Known limitation (by design, for now):** chat history is **not saved** — it resets if you reload the page or switch tabs and come back. This keeps the first version simple. If your team ends up using Copilot heavily and wants it to remember past conversations, that can be added later (ask for it).

### 144.1 — Add the new database table

1. In Supabase, click **SQL Editor** → **New query**.
2. Open **`supabase/migration_copilot.sql`** from this project folder, select all, copy it, paste into the SQL Editor, click **Run**. You should see "Success. No rows returned." Safe to run even twice.

If you're setting this up on a brand-new/empty Supabase project instead, you don't need this file separately — `supabase/schema.sql` (Step 2) already includes this table.

### 144.2 — Deploy the copilot-chat function

1. In Supabase, click **Edge Functions** → **Create a new function** (or **Deploy a new function**).
2. Name it exactly: `copilot-chat`
3. Open **`supabase/functions/copilot-chat/index.ts`** from this project folder, select all, copy it, and paste it into the code editor, replacing the placeholder.
4. Click **Deploy**.

### 144.3 — No new API key needed

Copilot reuses the **same** `ANTHROPIC_API_KEY` secret you already set up for AI Research in Step 8. If you've already done Step 8, there's nothing else to add here — skip straight to redeploying below. If you haven't done Step 8 yet, Copilot will show a friendly "not set up yet" message until you add that key.

### 144.4 — Redeploy and try it

1. Redeploy the `app/` folder via Netlify Drop, same as any other update — the service worker's cache version was bumped so every phone picks up the new tab automatically.
2. Reload the app. Open **Copilot** in the sidebar (desktop) or **More → Copilot** (phone).
3. Try a question like "what's in my pipeline right now?" — within a few seconds you should get a real answer built from your actual data.

### What this costs, plainly

- Uses **claude-sonnet-4-6**, a mid-tier Claude model — chosen deliberately over the more expensive top-tier model since chat questions are short and this keeps ongoing cost low without a noticeable quality drop for this kind of lookup-and-answer task.
- Typical cost is a fraction of a cent per message, similar in spirit to AI Research (Step 8).
- **Safety cap**: no single teammate can send more than **30 messages per hour** — built into the backend function, not adjustable from the app.
- You can watch actual spend anytime at **console.anthropic.com → Usage**.

If you'd rather skip this feature entirely, that's fine — everything else in the app works exactly as before.

## Step 145 — Email Notifications

Alongside pop-up (push) notifications from Step "Notifications" in Team settings, teammates can now also get an **email** for the same three moments: a new prospect is added (owners get emailed), a prospect is assigned to someone (that teammate gets emailed), and an invoice goes overdue (owners and whoever created the invoice get emailed — see Step "overdue invoice alerts" for that cron job). Each teammate can turn email notifications on or off for themselves from a new **Email Notifications** toggle in Team settings, right under the existing pop-up notifications card — on by default.

This uses **Resend**, an email-sending service with a free tier that doesn't require a credit card to start.

### 145.1 — Add the new database field

1. In Supabase, click **SQL Editor** → **New query**.
2. Open **`supabase/migration_email_notifications.sql`** from this project folder, select all, copy it, paste into the SQL Editor, click **Run**. You should see "Success. No rows returned." Safe to run even twice.

If you're setting this up on a brand-new/empty Supabase project instead, you don't need this file separately — `supabase/schema.sql` (Step 2) already includes this field.

### 145.2 — Get a Resend API key

1. Go to **resend.com** and sign up (no card needed for the free tier).
2. Once in, go to **API Keys** → **Create API Key**. Give it any name (e.g. "Studio X Command"), leave permissions at default (Full access is fine), click **Create**.
3. Copy the key that appears — you won't be able to see it again after you leave the page.

**This key never goes into the app or any file in this project** — it only ever lives inside Supabase's secure backend, in the next step.

### 145.3 — Deploy the send-email function

1. In Supabase, click **Edge Functions** → **Create a new function** (or **Deploy a new function**).
2. Name it exactly: `send-email`
3. Open **`supabase/functions/send-email/index.ts`** from this project folder, select all, copy it, and paste it into the code editor, replacing the placeholder.
4. Click **Deploy**.

### 145.4 — Add your API key as a secret

1. Still in **Edge Functions**, find **Secrets** (sometimes **Manage secrets**).
2. Add a new secret:
   - **Name**: `RESEND_API_KEY`
   - **Value**: the key you copied in Step 145.2.
3. Save.

That's enough to get emails sending. Two more secrets are optional:

- `RESEND_FROM_EMAIL` — without a verified domain (see the note below), leave this unset; it defaults to Resend's built-in testing address.
- `APP_URL` — the web address your team opens Studio X Command from (e.g. your Netlify URL). If set, emails include an "Open Studio X Command" button. If unset, emails just skip the button — nothing breaks.

### 145.5 — Redeploy the changed overdue-invoices function too

Step "overdue invoice alerts" (the daily cron job) was updated to also send emails, not just pop-ups. Since that function already exists in your Supabase project, you need to **replace** its code, not create it fresh:

1. In Supabase, click **Edge Functions** → open the existing `check-overdue-invoices` function.
2. Open **`supabase/functions/check-overdue-invoices/index.ts`** from this project folder, select all, copy it, and paste it into the code editor, replacing what's there.
3. Click **Deploy** (or **Save & Deploy**).

If you never set up overdue invoice alerts in the first place, skip this — it'll just work once you do set it up later.

### 145.6 — Redeploy and try it

1. Redeploy the `app/` folder via Netlify Drop, same as any other update — the service worker's cache version was bumped so every phone picks up the change automatically.
2. Reload the app. Open **Team** → confirm you see the new **Email Notifications** toggle (on by default) under the pop-up Notifications card.
3. Add a new prospect (or have a teammate add one) → confirm owners receive an email within a minute or two.

### An important catch with the free testing address

If you leave `RESEND_FROM_EMAIL` unset, Resend's default sender (`onboarding@resend.dev`) can only deliver to **the email address you signed up to Resend with** — emails to anyone else will silently fail to arrive. This is a Resend anti-spam restriction, not a bug in this app. To email your whole team properly, you'll need to verify a domain you own in Resend (**Domains → Add Domain**, then add a couple of DNS records at wherever you bought the domain) and set `RESEND_FROM_EMAIL` to an address at that domain (e.g. `"Studio X Command <notifications@studioxmarketing.com>"`). This is a bit more setup — ask if you want a hand with it once you have a domain in mind.

### What this costs, plainly

- Resend's free tier is generous for a small team: roughly **3,000 emails a month, up to 100 a day**, no card required. Studio X's realistic notification volume is far below that.
- If you ever outgrow the free tier, Resend's paid plans start cheap and scale with usage — you'd see a clear warning in your Resend dashboard before anything stops working.
- You can watch usage anytime at **resend.com → your dashboard**.

## Step 146 — WhatsApp Integration (Twilio) — real two-way conversations in the app

Up to now, "Send WhatsApp" on a prospect has always been a shortcut that hands off to *your own* WhatsApp app to send the first message — free, and it always will be, no setup needed. This step adds something new on top of that: once a prospect **replies**, a real conversation thread appears right inside their prospect card, and your team can read and reply to them without ever leaving Studio X Command.

**Why it's a separate, optional step:** this uses Twilio, a paid messaging service (small per-message cost, see below), and WhatsApp's own rules for businesses. It's entirely optional — if you skip this step, the free "Send WhatsApp" button keeps working exactly as it always has.

**The one rule to know going in:** WhatsApp only allows a business to send free-form text replies within **24 hours** of the customer's last message to you. Outside that window, WhatsApp requires a pre-approved message template (a whole separate Meta approval process this app doesn't set up for you). So in Studio X Command: the in-app reply box only appears while you're inside that 24-hour window. Once it closes, the card falls back to the same free "Send WhatsApp" cold-open button to restart the conversation — nothing breaks, it just changes how you reply.

### 146.1 — Add the new database tables

1. In Supabase, click **SQL Editor** → **New query**.
2. Open **`supabase/migration_whatsapp.sql`** from this project folder, select all, copy it, paste into the SQL Editor, click **Run**. You should see "Success. No rows returned." Safe to run even twice.

If you're setting this up on a brand-new/empty Supabase project instead, you don't need this file separately — `supabase/schema.sql` (Step 2) already includes these tables.

### 146.2 — Create a Twilio account and get your credentials

1. Go to **twilio.com** and sign up. Unlike Resend, Twilio does require a credit/debit card on file before it'll send real messages — that's how Twilio itself charges per message (see costs below).
2. Once in, your **Account SID** and **Auth Token** are shown right on the Twilio Console home page. Copy both somewhere safe for a moment — you'll paste them into Supabase in Step 146.4, and nowhere else. They never go into any file in this project.
3. Twilio gives every new account some free trial credit, enough to test this whole setup without spending real money first.

### 146.3 — Get a WhatsApp sending number: Sandbox (free, for testing) or Production (real prospects)

Twilio offers two ways to send WhatsApp messages, and it's worth understanding both before you pick:

- **WhatsApp Sandbox** — free, ready in minutes, meant for testing. The catch: every phone number you want to message (including your own, for testing) has to first send a specific "join" code to a shared Twilio number on WhatsApp before Twilio will deliver anything to it. That's fine for you and your team to try this out, but it's **not usable for real prospects** — you can't ask a prospect to text a secret code before you're allowed to message them.
- **Production WhatsApp Sender** — a real WhatsApp Business number tied to your own agency, approved through Meta (WhatsApp's parent company) via Twilio. This is what you need before using this feature on real prospects. It requires a Meta Business verification that can take anywhere from a few hours to a few days, and Twilio walks you through it in-console (**Messaging → Try it out → Send a WhatsApp message**, then look for **"Register a WhatsApp sender"** or similar — Twilio's onboarding flow changes shape occasionally, so follow whatever it shows you there).

**Recommendation:** start with the Sandbox to test the whole flow end-to-end with your own phone this week; apply for the Production sender in parallel since it takes time to get approved, then switch over once it's live (just update one secret — Step 146.4 — nothing else changes).

Either way, once you have a WhatsApp-enabled number (sandbox or production), note it down in the exact format Twilio shows it, e.g. `whatsapp:+14155238886`.

### 146.4 — Deploy the two new functions and add your secrets

This feature needs two backend functions: one that sends a message when your team types a reply, and one that receives messages/delivery updates from Twilio.

1. In Supabase, click **Edge Functions** → **Create a new function**, name it exactly `send-whatsapp`. Open **`supabase/functions/send-whatsapp/index.ts`** from this project folder, select all, copy it, paste it into the code editor replacing the placeholder, click **Deploy**.
2. Create a second function named exactly `whatsapp-webhook`. Open **`supabase/functions/whatsapp-webhook/index.ts`**, copy its contents in the same way, click **Deploy**.
3. Still in **Edge Functions**, find **Secrets** and add:
   - `TWILIO_ACCOUNT_SID` — from Step 146.2.
   - `TWILIO_AUTH_TOKEN` — from Step 146.2.
   - `TWILIO_WHATSAPP_FROM` — the number from Step 146.3, e.g. `whatsapp:+14155238886`.
4. Save.

The push (pop-up) and email notifications this feature sends when a prospect replies reuse whatever you already set up in earlier steps (VAPID keys for push, `RESEND_API_KEY` for email) — nothing new to add there if you've already done those steps. If you haven't, this feature still works fine; the person assigned just won't get pinged automatically.

### 146.5 — Point Twilio's webhook at your new function

Twilio needs to know where to send incoming WhatsApp messages and delivery updates. Both functions live at:

```
https://YOUR-PROJECT-REF.supabase.co/functions/v1/whatsapp-webhook
```

(swap in your actual Supabase project reference — the same one your app already connects to; find it in Supabase → **Settings → API**).

1. **If you're using the Sandbox:** go to **Messaging → Try it out → Send a WhatsApp message → Sandbox settings**, and paste that URL into **"WHEN A MESSAGE COMES IN"**, method `HTTP POST`. Save.
2. **If you're using a Production sender:** find your WhatsApp sender under **Messaging → Senders**, open it, and set the same URL as its incoming-message webhook (and, if offered separately, its status-callback URL — this same function handles both).

Twilio signs every request it sends here with a secret signature so this function can tell a real Twilio request apart from anyone else who happens to find the URL — that check happens automatically using the `TWILIO_AUTH_TOKEN` secret you already added, nothing more to configure. (If Studio X Command is ever reached through a custom domain that's different from the default `supabase.co` address above, add one more secret, `TWILIO_WEBHOOK_URL`, set to the exact URL you entered into Twilio in this step — otherwise skip it.)

### 146.6 — Redeploy and test

1. Redeploy the `app/` folder via Netlify Drop, same as any other update — the service worker's cache version was bumped so every phone picks up the change automatically.
2. **If testing with the Sandbox:** from your own phone, send the Sandbox's "join &lt;code&gt;" message to Twilio's Sandbox number on WhatsApp first (Twilio shows you the exact code to send).
3. Add yourself as a test prospect with your own WhatsApp number, then send yourself the cold-open "Send WhatsApp" message as usual.
4. Reply to it from your phone. Within a few seconds, that reply should appear in the new conversation thread on that prospect's card in Studio X Command, and whoever's assigned should get a push/email notification.
5. Type a reply in the thread and send it — it should arrive on your phone within the 24-hour window. Confirm it shows a status (sent/delivered/read) that updates live as WhatsApp reports it back.

### What this costs, plainly

- Twilio charges **per message**, and the exact rate depends on your country and the type of conversation (business-initiated vs. customer-initiated) — this changes often enough that quoting a number here would likely be stale. Check Twilio's own live pricing page (**twilio.com/whatsapp/pricing**) for current rates before relying on this for volume.
- A safety cap is already built in: no single teammate can send more than **30 WhatsApp messages an hour** through the in-app thread, regardless of plan — this just protects against an accidental runaway cost, not a limit you should expect to hit in normal day-to-day use.
- The free cold-open "Send WhatsApp" button (unchanged, from before this step) never touches Twilio and never costs anything — only replies sent *from inside the app's conversation thread* go through Twilio and incur a cost.
- Twilio's trial credit covers a meaningful amount of Sandbox testing before you need to add real funds.

If you'd rather skip this feature entirely, that's fine — everything else in the app works exactly as before, and pop-up notifications (Step "Notifications") still work on their own.

---

## Step 147 — Public landing page, now made the homepage at your root domain

Requested after you shared screenshots of Biiblo's marketing site as inspiration for "a landing page and the other UI like a similar system," then a follow-up request to make that landing page the actual homepage at your root domain, instead of a second, separate page.

**What changed:** the app used to have one front door — `app/index.html` — which was both "the marketing pitch" and "the sign-in screen" at once (there wasn't really a pitch at all; visiting the site just dropped you straight onto sign-in). Now there are two files doing two separate jobs:

- **`app/index.html`** — the new homepage. This is what loads at your bare root domain now (`your-site.netlify.app/`). It's the marketing page built in Step 147's original work: hero section, "see it in action" tabbed mockup (Pipeline / WhatsApp / Contracts & Invoices), feature cards, a comparison table, an FAQ, and "Sign in" / "Get started free" buttons.
- **`app/app.html`** — the real app. This is the old `index.html`, renamed — the actual sign-in screen and, once logged in, the entire installable app itself. Every "Sign in" / "Get started free" button on the new homepage links here.

**Why this is safe for everyone who already has the app installed:** an installed home-screen icon or bookmark remembers the exact URL that was on screen the moment it was created — usually your bare root domain. Without any safety net, that would now open the marketing page instead of dropping people straight into their sign-in screen or dashboard. To prevent that, `app/index.html` has a tiny script at the very top of the page, before anything else loads, that checks "am I being opened as an installed app right now?" — if yes, it silently and instantly sends you to `app.html` instead, so nobody who already has the app installed sees the marketing page or has to do anything differently. Only people opening the bare link in a normal browser tab (i.e. someone who doesn't have it installed yet) actually sees the new homepage. This means **no one needs to reinstall or re-add the icon to their home screen** — it fixes itself the next time they open it.

Everything else that used to point at "the app at the root of the site" was updated to point at `app.html` instead, so links keep working exactly as before:
- The installable-app config (`manifest.json`) now launches straight into `app.html` when someone taps an installed icon.
- Push notifications (new prospect assigned, WhatsApp reply, overdue invoice, etc.) now open `app.html` when tapped, not the homepage.
- The "Open Studio X Command" button in every notification email now links to `app.html` too.
- Offline support (the service worker) now knows about both pages — if you're offline and open the homepage or the app, each shows its own last-saved version correctly, instead of one overwriting the other.

No new tables, no new secrets — just the rename, the safety-net redirect script, and updating every internal link that assumed "the root of the site" meant "the app."

1. Redeploy the `app/` folder via Netlify Drop, exactly as usual.
2. **Redeploy 4 edge functions** via the Supabase Dashboard, since their source changed to link to `app.html` instead of the root: `send-push`, `send-email`, `check-overdue-invoices`, `whatsapp-webhook`. For each one: open it in the Supabase Dashboard's Edge Functions editor, paste in the updated code from this project, and deploy — same copy-paste process as every other edge function update in this guide.
3. Visit your bare root domain (`your-site.netlify.app/`) in a normal browser tab (not from an installed icon) and confirm you see the new marketing homepage, the tabs under "See it in action" switch between Pipeline/WhatsApp/Contracts, the FAQ items expand, and both "Sign in" and "Get started free" buttons take you to the real app.
4. Visit `your-site.netlify.app/app.html` directly and confirm it's the familiar sign-in screen.
5. If you already have the app installed on your phone (home screen icon), open it once after redeploying — confirm it still drops you straight into sign-in/dashboard as always, not the new marketing page. You don't need to reinstall anything; this should just work.

## Step 148 — Landing page motion, and a minimize button for the sidebar

Two small, unrelated polish requests bundled together since neither touches your data or setup.

**"See it in action" now plays itself.** The tabbed mockup on the homepage (Step 147) used to just sit there until someone clicked a tab. Now it auto-advances through Pipeline → WhatsApp → Contracts & Invoices on its own, with a thin line filling in under the active tab as a countdown to the next switch. The moment a visitor clicks a tab themselves, it stops auto-advancing — they're in control from that point on, and it won't yank the mockup away mid-read. Each pane's content also fades/staggers in instead of just appearing, and the WhatsApp pane shows a little bouncing "typing…" bubble before each reply, so it reads more like a live chat than a screenshot. Anyone with "reduce motion" turned on in their device settings just sees each pane's finished state instantly — none of this applies to them.

**The sidebar can now minimize to icons only.** In the real app (not the homepage), the desktop-width sidebar on the left now has a small circular arrow button on its top-right edge. Clicking it shrinks the sidebar down to just the icons (hover over one — or tap it, on a touchscreen with a mouse-like pointer — and you'll still see which page it is, since the icon itself doubles as a tooltip label). Click the arrow again to bring the labels back. Whichever state you leave it in is remembered on that device (same idea as the light/dark mode switch — it's a personal screen preference, not something that syncs to your teammates). Phone-width screens are unaffected — they never had this sidebar to begin with; they use the bottom tab bar exactly as before.

No new tables, no new secrets, no edge functions touched — pure front-end polish.

1. Redeploy the `app/` folder via Netlify Drop.
2. On a wide/desktop browser window, open the app and confirm the small circular arrow sits on the sidebar's edge; click it and confirm the sidebar shrinks to icons, the page content shifts over to fill the extra space, and clicking again brings the full sidebar back.
3. Reload the page after minimizing it — confirm it stays minimized (the preference is remembered).
4. Visit the homepage and watch the "See it in action" mockup for 15–20 seconds without touching it — confirm it cycles through all three tabs on its own.

## Step 149 — Icons on the phone "More" menu

On a phone, tapping "More" in the bottom bar opens a list of every other page in the app (Copilot, Contracts, Invoices, and so on). Until now that list was plain text — every row looked the same, so you had to read each label to find what you wanted. Two rows ("Get the App" and "Keyboard Shortcuts") had an emoji in front, but nothing else did.

Every row now has a small tinted icon, using the exact same icon shapes as the matching item in the desktop sidebar (Step 148) and the icons on the homepage — so the same feature looks the same everywhere in the app. The color follows the same grouping as the homepage: day-to-day sales items (Copilot, Discovery, Niche Matrix, calculators, Team, etc.) get the purple icon treatment, and the client-facing/paperwork group (Contracts, Invoices, Projects, Grid Plans, Services & Packages, Portfolio Studio) gets the gold treatment. The two emoji ("📲" and "⌨️") were replaced with proper icons in the same style so the whole list is consistent.

Nothing about what happens when you tap a row changed — same pages open, same buttons underneath. This is a visual-only change: no new tables, no new secrets, no edge functions touched.

1. Redeploy the `app/` folder via Netlify Drop.
2. On a phone (or a narrow browser window), sign in and tap "More" in the bottom bar.
3. Confirm every row now shows a small icon in a tinted rounded-square box to the left of its label, and that "Get the App" / "Keyboard Shortcuts" no longer show emoji.
4. Tap a couple of rows and confirm they still open the right page, same as before.

## Step 150 — Points & a Team Leaderboard everyone can see

A first step toward making the day-to-day work a bit more fun. The app now quietly keeps score: doing things — adding a prospect, sending a follow-up, finishing your daily tasks, drafting a contract, getting an invoice paid, and of course signing a client — earns points. There's a new **Points Leaderboard** on the Team page that ranks everyone by their total, and it's visible to the whole team, not just you — unlike the existing revenue-based "Team Leaderboard" further down that page, which stays owner-only on purpose (money numbers are still private to you). Tapping anyone's name (including your own "Points" card near the top of the page) shows a short list of what they've earned points for recently.

**Current point values** (all of this can be rebalanced later just by asking — nothing about the app's data changes, only these numbers):
- Adding a prospect: 5
- Prospect replies: 5 · Meeting booked: 10 · Signing a client: 30
- Leaving a note: 2
- Finishing a daily task: 3
- Posting in the Community Feed: 3
- Drafting a contract: 8 · Contract signed: 15
- Creating an invoice: 5 · Invoice paid: 15
- Starting a project: 5 · Finishing a project: 10

Points are worked out entirely on the server, from things that already happen in the app — there's no button anyone can tap to "claim" points, and toggling something back and forth (like checking a daily task off and back on) doesn't pay out twice. This is a genuinely new feature (a new database table plus some new "watch for this happening" rules), so it needs the setup step below before you redeploy — skipping it won't break anything, but nobody will earn any points until it's run.

**Setup — do this first, before redeploying:**

1. Open your **Supabase Dashboard → SQL Editor**, paste in the entire contents of the new file `supabase/migration_points.sql`, and click **Run**. It's safe to re-run if you're ever unsure whether it already applied. This creates a new `points_log` table (a running record of who earned what and why) and teaches the database to award points automatically when the events above happen.
2. Redeploy the `app/` folder via Netlify Drop.

**Now test it:**

3. Reload the app on your phone/browser (hard refresh if it still looks old — the service worker's cache version was bumped).
4. Open **Team & Settings** — confirm you see a gold "Points" card near the top (probably showing 0 if this is brand new) and a "🏆 Points Leaderboard" section listing everyone on the team, ranked highest points first.
5. Add a test prospect, then check the Points Leaderboard again — your number should have gone up by 5, and it should update for a teammate on another device/phone without them refreshing (same real-time sync as everything else in the app).
6. Tap your own Points card (or anyone's row on the leaderboard) — confirm a short list pops up showing what earned those points and when.
7. Have a non-owner teammate check their own Team page — confirm they can see the Points Leaderboard too (this one isn't restricted like the revenue leaderboard below it is).

## Step 151 — Badges & Achievements

Builds directly on the points system above (Step 150 must already be applied). Everyone's Team page now has a "🎖️ My Badges" section — a wall of 14 achievement badges that unlock automatically as the team works. Locked ones show up dimmed/greyed-out; unlocked ones light up in full color. Tapping any badge (locked or unlocked) pops up what it is, what it takes to earn it, and — if earned — when you got it. This is visible to everyone, same as the Points Leaderboard, since achievements aren't sensitive the way revenue numbers are.

**The 14 badges:**
- First Prospect (add 1) · Prospector (add 25)
- First Deal (sign 1) · Closer (sign 5) · Rainmaker (sign 10)
- Paperwork (draft 1 contract) · Ink Master (5 contracts signed)
- Getting Paid (5 invoices paid)
- Note Taker (10 notes) · Team Player (10 Community Feed posts) · Consistent (30 daily tasks completed)
- Century Club (100 total points) · High Roller (500 total points) · Legend (1000 total points)

Same as points, this is entirely automatic and server-side — the moment someone crosses a threshold, the badge unlocks itself and a celebratory line appears in the Activity Feed ("X earned the 'Closer' badge 🏅") so the whole team sees it happen. Nobody can hand themselves a badge early; there's no button for it anywhere.

**Setup — do this first, before redeploying:**

1. Open your **Supabase Dashboard → SQL Editor**, paste in the entire contents of the new file `supabase/migration_badges.sql`, and click **Run**. Safe to re-run if you're ever unsure. This creates a new `badges_earned` table and teaches the database to check for newly-earned badges every time someone earns points.
2. Redeploy the `app/` folder via Netlify Drop.

**Now test it:**

3. Reload the app on your phone/browser (hard refresh if it still looks old — the service worker's cache version was bumped).
4. Open **Team & Settings** — confirm you see a "🎖️ My Badges" section below the Points Leaderboard, showing all 14 badges (dimmed/grey if you haven't earned them yet).
5. Tap a locked badge — confirm a pop-up explains what it is and what you need to do to earn it.
6. Add a prospect (or do anything else that earns points) and check back — the matching badge (e.g. "First Prospect") should light up in color, and a note should appear in the Activity Feed announcing it.
7. Tap a teammate's name on the Points Leaderboard — confirm their badge wall shows there too, alongside their points breakdown.

## Step 152 — Celebratory pop-ups for big wins and badges

A small follow-up to points + badges above (no SQL to run this time — pure front-end, since it just reacts to things the last two steps already track). Two new pop-ups, bigger and longer-lasting than the app's normal little status toasts:

- **Any badge you unlock** — always pops up, right when it happens, wherever you are in the app (not just if you happen to be on the Team page). Shows the badge's icon, name, and what it means.
- **A decent chunk of points** — pops up for the bigger wins only (booking a meeting, signing a deal, a contract getting signed, an invoice getting paid, finishing a project — 10 points or more). Small everyday stuff (a note, a daily task, adding a prospect) stays quiet so this doesn't get annoying.

These only pop up for YOUR OWN wins, on your own device — you won't see a pop-up every time a teammate does something, only when it's actually you.

**Setup:** just redeploy the `app/` folder via Netlify Drop — nothing to run in Supabase.

**Now test it:**

1. Reload the app on your phone/browser (hard refresh if it still looks old).
2. Do something worth 10+ points (e.g. mark a prospect as a signed client, or a contract as signed) and confirm a gold pop-up with a star appears near the top of the screen for a few seconds.
3. If it also happens to unlock a badge you didn't have yet, confirm a second pop-up appears for that too.
4. Do something small (like adding a note) and confirm nothing pops up — only the bigger wins do.

## Step 153 — AI avatar picker on your Profile, and a nicer sign-in/sign-up screen

Two visual upgrades, inspired by screenshots you shared of another app's design. No SQL to run — pure front-end, just redeploy.

**1. Pick an AI avatar instead of uploading a photo.** Open **Team & Settings → Edit Profile** (tap your own name/avatar). Below the existing "Upload Custom Photo" option there's now a grid of 12 ready-made cartoon avatars — tap any one and it's saved as your profile picture instantly, no file upload needed. There's also a "Type a name to generate one..." box: type anything (your name, a nickname, anything) and hit **Generate** to get a unique cartoon avatar based on that text — same input always makes the same picture, so you can experiment and come back to a favorite. Your profile card also now shows your email and role as a quick reference, same idea as the "Personal Information" panel in the screenshots you sent.

These avatars come from a free public avatar-generator service (DiceBear) — nothing to sign up for, no account needed, and no cost.

**2. A friendlier sign-in/sign-up screen.** On a phone, sign-in/sign-up looks exactly the same as before — same fields, same buttons, nothing to relearn. On a wider screen (a laptop or desktop browser — e.g. if you ever set up the team from a computer instead of your phone), the screen now splits in two: your familiar sign-in/sign-up form stays on the left, and a new decorative panel appears on the right showing a few of what the app does (a mini mock pipeline board, bullet points about WhatsApp outreach, real-time team activity, and points/badges) — purely cosmetic, matching the split-screen style from the screenshots you sent. No new login method was added (no "Sign in with Google" — that would need a separate integration we haven't set up).

**Setup:** just redeploy the `app/` folder via Netlify Drop.

**Now test it:**

1. Reload the app (hard refresh if it still looks old — the service worker's cache version was bumped).
2. Open **Team & Settings → Edit Profile** and confirm the "Or pick an AI avatar" grid appears with 12 avatars, plus the email/role info boxes.
3. Tap one of the preset avatars — confirm your avatar updates everywhere (top bar, Team roster, etc.) within a second or two.
4. Try the "Type a name..." + Generate box with your own name — confirm a new avatar appears and gets saved the same way.
5. Sign out, then view the sign-in screen on your phone — confirm it looks the same as before (single column, no layout changes).
6. If you have a laptop/desktop handy, open the app there at a wide browser width — confirm the sign-in/sign-up card now sits on the left with a decorative panel on the right.

## Step 154 — Landing page animations, and a fuller sign-up form

More polish for the public marketing page (`index.html`) and the sign-up screen, continuing the "another app's design" inspiration from Step 153. No SQL to run — pure front-end, just redeploy.

**1. The landing page has subtle motion now.** The two soft background glows drift slowly in the background the whole time. As you scroll down the marketing page, each section (feature cards, the "why a dedicated command center" table, the FAQ, the final call-to-action) gently fades and slides into place the first time it comes into view, instead of just sitting there statically. The three feature-card grids also lift slightly when you hover over a card with a mouse. The hero section at the very top now animates in piece by piece when the page first loads (badge, then headline, then the "See it in action" device mockup). Anyone with "reduce motion" turned on in their phone/computer settings sees none of this — everything just appears normally, fully visible, with no animation at all — same accessibility approach as everything else already on this page.

**2. A new "What running your agency this way looks like" section.** Sits between the "built for how agencies actually work" section and the comparison table. It shows three short example quotes about what using Agency Command day-to-day could feel like (a team not double-messaging the same lead, opening the app on weak signal, a signed deal turning into a project same-day). These are clearly labeled **"Illustrative examples"** right above the heading, and each one says "Example: [role]" rather than a real person's name — because Studio X doesn't have real customer testimonials yet, and it would be dishonest to present made-up quotes as if they were real ones. Swap these out for genuine client quotes once you have some — just ask me to update that section.

**3. Sign-up now shows the same "why sign up" checklist inside the form itself** (not just in the decorative side panel on wide screens) — three bullet points about the pipeline, WhatsApp outreach, and it being free for the whole team — plus a short line under the "Create Account" button about using the app responsibly. Sign-in mode is unchanged (no checklist, no fine print — that's sign-up only).

**Setup:** just redeploy the `app/` folder via Netlify Drop.

**Now test it:**

1. Reload the app (hard refresh if it still looks old — the service worker's cache version was bumped).
2. Open the public landing page and scroll down slowly — confirm each section fades/slides into view as it appears, rather than everything already being visible on load.
3. Hover your mouse over a feature card (desktop) — confirm it lifts slightly.
4. Scroll to the new "What running your agency this way looks like" section and confirm it's clearly labeled "Illustrative examples" and reads as example scenarios, not real reviews.
5. Go to sign-up (not sign-in) — confirm the three-item checklist appears above the form fields, and the responsible-use line appears under "Create Account". Switch back to sign-in — confirm both disappear.
6. If your phone/computer has "reduce motion" turned on in its accessibility settings, confirm the landing page still looks and works fine, just without the fade/slide/drift effects.

## Step 155 — A "Getting Started" checklist on the Dashboard

Inspired by the same "another app's design" folder as Step 153/154 — this one had a gamified onboarding checklist on its dashboard. Built a version that fits how this app actually works. No SQL to run — pure front-end, just redeploy.

**What it is:** a new "Getting Started" card at the very top of the Dashboard (above "Pipeline Overview") for any team that hasn't finished basic setup yet. It lists a handful of first actions — add a profile photo, add a prospect, reach out to a lead, create a contract, create an invoice, and (owners only) set a monthly revenue goal and invite a teammate — each with a checkbox that fills in automatically once you've actually done that thing elsewhere in the app. A progress bar at the top shows "X of Y done." Tapping any unfinished item jumps you straight to the right screen to go do it (or opens the "set a goal" pop-up for that one).

Nothing new to track in the database for this — every checkbox is just reading data that's already there (do you have any prospects, any contracts, etc.), so there's nothing that can get out of sync.

**"Hide"** in the top-right of the card dismisses it — useful for an established team that doesn't need the nudges. That choice is remembered on that phone/browser for that person, and the card disappears on its own anyway once every item on it is checked off, even without tapping Hide.

**Setup:** just redeploy the `app/` folder via Netlify Drop.

**Now test it:**

1. Reload the app (hard refresh if it still looks old — the service worker's cache version was bumped).
2. On the Dashboard, confirm the "Getting Started" card appears above "Pipeline Overview" if your team hasn't finished all the items yet.
3. Confirm the items that are already true for your team (e.g. you already have prospects) show as checked off with a strikethrough, and the progress bar/count reflects that.
4. Tap an unfinished item (e.g. "Create your first invoice") — confirm it takes you straight to that screen. Tap "Set your monthly revenue goal" (owners only) — confirm it opens the goal pop-up instead of navigating away.
5. Tap "Hide" — confirm the card disappears, and reload the page to confirm it stays hidden.
6. If you're testing as a non-owner team member, confirm you only see 5 items (no "set revenue goal" or "invite a teammate" — those stay owner-only, same as elsewhere in the app).

## Step 156 — A short welcome wizard after signing up, and the Team page split into tabs

Two more pieces from the same "another app's design" folder as Steps 153–155. No SQL to run — pure front-end, just redeploy.

**1. A short welcome wizard, shown once, right after someone creates a brand-new account** (not shown on an ordinary sign-in, and never shown again after the first time). It's deliberately short — just two or three screens:
   - **Pick an avatar** — the same AI-avatar picker already on the Profile tab, front and center on day one instead of something to stumble on later.
   - **Invite your team** (only shown to whoever just created the agency, not someone who joined an existing one) — the invite code, front and center, with a Copy button, so it's shared before it's forgotten about.
   - **You're all set** — a quick pointer to the Dashboard's "Getting Started" checklist (Step 155) for what to actually do next.

   There's a "Skip" link at all times, and a progress bar at the top. It doesn't try to repeat everything the Getting Started checklist already covers — it's about making the workspace feel set up, not about the day-to-day tasks.

**2. The Team page is now three tabs instead of one long scroll** — **Profile**, **Team**, and **Settings** — using the same pill-style tab switcher already on the sign-up screen ("New agency / Join a team"), so it should feel familiar rather than new.
   - **Profile**: your own profile card, My Performance, and My Badges.
   - **Team**: the Points Leaderboard, (owners only) the Team Leaderboard and Leads Sourced, the invite code, and the Team Members roster.
   - **Settings**: Appearance (dark/light), Notifications, Email Notifications, and Sign Out.

   Nothing was removed — everything that used to be on the Team page is still there, just sorted into the tab it actually belongs under. Whichever tab someone's on stays selected even if the page quietly refreshes in the background (e.g. a teammate adds a prospect elsewhere).

**Setup:** just redeploy the `app/` folder via Netlify Drop.

**Now test it:**

1. Reload the app (hard refresh if it still looks old — the service worker's cache version was bumped).
2. Sign up for a brand-new test account — confirm the welcome wizard appears right after, with the avatar step first. Pick an avatar and confirm it applies. Continue through — if you created a new agency, confirm you see an "Invite your team" step with the correct code; if you joined an existing one via invite code instead, confirm that step is skipped. Confirm the final "You're all set" step's button closes the wizard onto the Dashboard.
3. Sign out and sign back in with that same account — confirm the wizard does **not** appear again.
4. Go to the Team page — confirm you land on "Profile" by default, and confirm "Team" and "Settings" show the right content each (compare against the list above — nothing should be missing).
5. Switch to "Settings", then do something elsewhere that would normally refresh the Team page in the background (or just wait) — confirm it doesn't jump back to "Profile" on its own.

## Step 157 — Full-screen fix, sidebar arrow fix, "+" button moved, dashboard greeting, and a mobile keyboard bug fix

A round of polish fixes from a screenshot of the sign-in screen showing a dead black strip on the right side on a wide browser window, plus a few other things reported at the same time. No SQL to run — pure front-end, just redeploy.

**1. The sign-in screen (and the whole app) now actually fills the screen.** On a wide/desktop window, the sign-in screen used to leave a blank black strip down the right edge instead of using the full width. Cause: one line of code was telling the screen to lay itself out sideways ("row" layout) instead of letting the actual sign-in card stretch to fill the space. Fixed — the sign-in screen and the rest of the app now always fill the full width and height of whatever screen or window it's opened on, phone or desktop.

**2. The little arrow that collapses/expands the sidebar (desktop only) was getting visually clipped** by the top bar overlapping it. Fixed by telling the sidebar to draw itself above the top bar instead of underneath it. The arrow is now fully visible and clickable.

**3. The floating "+" button (for adding a new prospect) used to float on top of every single screen** — Dashboard, Messages, Team, Settings, all of them — which made it feel like a stray button rather than a clear action. It now only appears on the **Pipeline** ("Prospects") screen, where it's obvious what tapping it does. Nothing about what it does changed, just where it shows up.

**4. Removed every plain-text "—" dash anywhere in the app**, from the public landing page through every screen inside the app (toasts, hints, empty-state messages, placeholders, the PWA install text, contracts/invoices, everything). Replaced with plainer punctuation or reworded sentences, whichever read better in each spot.

**5. The Dashboard now greets you by name** — a bold "Welcome back, [Your Name]." headline at the top with a soft glowing gradient effect, above the usual "Here's how the pipeline is doing" line.

**6. Fixed a mobile bug where tapping into the Pipeline tab from the bottom nav bar would instantly pop up the on-screen keyboard**, even though you hadn't tapped the search box. Cause: the search box was being told to grab focus every single time the Pipeline screen redrew itself, including on a fresh tap into the tab, not just while you were actually typing. Fixed so it only keeps/restores focus if you were genuinely already typing in the search box — tapping into Pipeline fresh no longer pops the keyboard, but typing still works exactly as before (no lost cursor position, no interruptions).

**Setup:** just redeploy the `app/` folder via Netlify Drop.

**Now test it:**

1. Reload the app (hard refresh if it still looks old — the service worker's cache version was bumped).
2. On a desktop/wide browser window, open the sign-in screen — confirm it fills the entire window with no blank strip on either side. Resize the window narrower and wider a few times to confirm it keeps filling correctly.
3. On your phone (or a narrow browser window), confirm the sign-in screen and the app after logging in both fill the whole screen edge to edge.
4. On desktop, find the small arrow that collapses the sidebar (near the top of the sidebar) — confirm you can see it fully and click it, and that it actually collapses/expands the sidebar.
5. Go to the Dashboard, Messages, and Team screens — confirm the floating "+" button does **not** appear on any of them. Go to Pipeline ("Prospects") — confirm the "+" button appears there and still opens "Add Prospect" when tapped.
6. Look around the app (landing page, toasts, empty states, contracts/invoices) for any leftover "—" dash — there shouldn't be any left.
7. On the Dashboard, confirm you see a bold "Welcome back, [your name]." headline with a subtle glow, above the "Here's how the pipeline is doing" line.
8. On your phone, tap from another tab straight into the **Pipeline** tab in the bottom nav — confirm the on-screen keyboard does **not** pop up automatically. Then tap into the Pipeline search box yourself and type something — confirm the keyboard behaves normally and your cursor position isn't lost while the list filters.

## Step 158 — Pitch Practice (a card game your team builds), and a tidier Dashboard

Two changes: a new practice game for the sales team, and a Dashboard that stops burying you in cards.

### The idea behind it

You asked for a game people can *play and build*. The important word there is **build** — the game isn't a quiz someone at head office wrote once. The team fills the deck themselves, out of the objections they actually hear on real calls in Harare. Every card added makes the deck better for whoever joins next month.

Two deliberate decisions about how it works, because they're the difference between something people use and something people quietly resent:

- **There is no score.** Not a mark out of ten, not points, not a percentage, not a rank. The AI coach is specifically instructed never to give one. The moment practising produces a number, it stops being practice and becomes an assessment, and people start playing it safe instead of trying the answer they're unsure about.
- **Nobody can see anyone else's answers — including you.** This is enforced by the database itself, not just hidden in the app. An agent fumbling an objection in practice is the entire point of practice; it only works if it's genuinely private. What *is* shared is the deck: everyone sees every card the team adds.

There's a small weekly progress ring ("2 / 5 cards practised this week"). It's not a target anyone is measured against and nothing happens if it isn't filled — it just gives the week somewhere to end. And deliberately **not** a streak: a streak punishes people for being sick, on leave, or having a genuinely busy week, which is a rotten thing to do to staff.

### 1. Pitch Practice — what your team sees

A new **Pitch Practice** item in the sidebar (desktop) or under **More** (phone).

- **Draw a card.** A face-down card flips over to reveal something a real prospect said, e.g. *"We already have someone doing our social media"* or *"Send me an email and I'll get back to you."* The app shows who on the team added that card.
- **Type how you'd answer it** in your own words, the way you'd actually say it on a call.
- **Get a coach note back** within a few seconds: what specifically worked in your answer, then one concrete thing to try instead, with a sample line. Written for Zimbabwean small-business selling — USD pricing, tight budgets, the owner is usually the decision maker, most follow-up happens on WhatsApp.
- **Skip** if a card isn't relevant to you. The deck prefers cards you haven't tried yet, so it doesn't hand you the same one over and over.
- **Add a card** — anyone on the team can, not just owners. The people taking the calls are the ones who know which objections actually come up. You type what the prospect said and optionally tag which niche it came from.
- **Your own history** is on the same screen: your past answers and the coach notes on them, visible only to you.

**Starter cards, so day one isn't a blank screen.** While the deck is empty, there's a link under the "Add the first card" button: **"Or load [number] common ones to start"**. Tapping it drops in a set of objections that come up constantly when selling marketing to small businesses in Zimbabwe, written the blunt way a prospect actually says them.

There are two kinds:

- **Twelve general ones**, untagged, that you'll hear from almost any business — *"My nephew does it for me for free"*, *"Can you guarantee me how many customers I'll get?"*, *"Are you charging in USD?"*, *"Just do one post first and let me see."* Everyone gets these.
- **Niche packs**, each tagged with the niche name, because different businesses push back in completely different ways. A gym says *"January is when people join, there's no point marketing now."* A lodge says *"It's low season."* A law firm says *"What would we even post? Our work is confidential."* A salon says *"I don't have time to be taking pictures while I'm doing someone's hair."* An answer that lands on a car yard falls flat in a clinic, so they're kept apart.

**You only get the niche packs for niches you actually work.** The app checks your **Niches** tab and loads only the matching packs, so a team that has never pitched a hotel doesn't spend practice reps on hotel objections. There are packs for salons, real estate, car dealerships, solar installers, restaurants and cafes, gyms, hotels and lodges, private healthcare, professional services, fashion and boutiques, and events and weddings. If you have all ten of the app's built-in niches set up you'll get 52 cards; a team with two niches might get around 22. (If you haven't set up any niches at all, you get everything, 58 cards, since filtering to nothing would be worse.)

Cards are labelled with **your own** wording for the niche, so if your niche is called "Private Healthcare & Clinics" that's what appears on the card, not some generic name. And if you work a niche the app doesn't have a pack for, nothing breaks — you just get the twelve general cards plus whatever else matches, and you write the rest yourself, which is the point of the feature anyway.

Those cards are labelled **"Starter card"** rather than credited to whoever tapped the button, and they behave like any other card — you can edit or delete them. Only one person needs to tap it; if a teammate has already loaded them, the app notices and won't add a second copy. While the deck is *still* nothing but starter cards, a small line under the draw card points out that it gets sharper once the team adds their own. That's the real goal — the starter deck is a starting point, not the product.

### 2. A tidier Dashboard

The Dashboard had grown to around twenty separate cards for an owner, which meant the important things were competing with the merely useful ones.

Ten of those cards — Win-Back Candidates, missing MRR, no follow-up date, unassigned prospects, orphaned prospects, at-risk clients, overdue projects, signed-with-no-project, client anniversaries, and grid plans needing attention — are now folded into **one** section called **Data Health**, collapsed by default. Tap it to open, tap again to close.

**Nothing was removed or hidden from you.** The collapsed header shows a **count** of how many things are actually in there, so a real warning can never be silently buried — if it says "0 Nothing needs attention, everything's tidy," there's genuinely nothing to open. Every card behaves exactly as it did before once you expand it. Your monthly Business Snapshot was moved *above* the fold so it stays visible.

### 158.1 — Add the new database tables

1. In Supabase, click **SQL Editor** → **New query**.
2. Open **`supabase/migration_pitch_practice.sql`** from this project folder, select all, copy it, paste into the SQL Editor, click **Run**. You should see "Success. No rows returned." Safe to run twice.

This adds three tables: `pitch_scenarios` (the deck), `pitch_attempts` (private practice answers), and `pitch_coach_requests` (an internal counter for the safety cap below).

**If you already ran this file once before the starter cards were added**, run it again — it now also adds an `is_starter` column to `pitch_scenarios`, and re-running is safe (it skips everything that already exists). If you skip this, the "load 18 common ones" link will show a message telling you to re-run the SQL.

### 158.2 — Deploy the pitch-coach function

1. In Supabase, click **Edge Functions** → **Create a new function** (or **Deploy a new function**).
2. Name it exactly: `pitch-coach`
3. Open **`supabase/functions/pitch-coach/index.ts`** from this project folder, select all, copy it, paste it into the code editor replacing the placeholder.
4. Click **Deploy**.

### 158.3 — No new API key needed

This reuses the **same** `ANTHROPIC_API_KEY` secret already set up for AI Research (Step 8) and Copilot (Step 144). Nothing new to add. If that key isn't set, Pitch Practice will show a plain "not set up yet" message rather than an error.

### 158.4 — Redeploy

Redeploy the `app/` folder via Netlify Drop as usual. The service worker cache version was bumped to `sxc-v165`, so every phone picks up the new screen automatically. (You can confirm which version a phone is on at the bottom of the **Team** page.)

### What this costs, plainly

- Uses **claude-sonnet-4-6**, the same mid-tier Claude model Copilot uses (Step 144). Coach notes are short (3-4 sentences of plain advice), which this model handles well, and keeping both AI features on the same tier keeps the monthly bill predictable. Typical cost is a fraction of a cent per practice answer.
- If the coach notes ever start feeling shallow, swapping to the top-tier model is a one-word change: replace `claude-sonnet-4-6` with `claude-opus-4-7` in `supabase/functions/pitch-coach/index.ts` and redeploy that one function. Nothing else changes.
- **Safety cap**: no single teammate can get more than **40 coach notes per hour**, built into the backend function.
- Watch actual spend anytime at **console.anthropic.com → Usage**.

### Now test it

1. Run the SQL from 158.1 and deploy the function from 158.2, then redeploy `app/` and hard-refresh the app.
2. Open **Pitch Practice** (sidebar on desktop, **More** on phone). With an empty deck, confirm it invites you to add the first card rather than showing an error.
3. Tap **"Or load [number] common ones to start"** — confirm the deck fills up and you see a note that they're all starter cards. The number depends on how many niches you have set up; with all ten built-in niches it's 52.
4. Tap **Add a card**, type an objection you've genuinely heard (e.g. "It's too expensive"), pick a niche or leave it on "Any niche", and save. Confirm the deck count goes up by one and the "all starter cards" note disappears.
5. Tap **Draw a card** a few times — confirm a card reveals with the objection, that a starter card says "Starter card" while your own says "Card by [your name]", and that niche cards show a small tag in the top-right (using your own niche names) while the general ones show no tag.
6. Check that the niche tags you're seeing are ones you actually work. You should **not** be getting, say, hotel objections if you have no hotel niche set up.
7. Type an answer and tap the coach button. Within a few seconds you should get a short note that praises something specific and suggests one improvement. **Confirm it does not give you a score or a mark out of anything** — if it ever does, that's a bug worth reporting.
8. Draw and answer a second card, then check the history section lower down — confirm both your answers and their coach notes are listed.
9. Sign in as a different teammate. Confirm they can see the **cards** you added, but **not** your answers or coach notes. Confirm the starter cards aren't duplicated for them (the deck count should be the same as what you saw, not double).
10. Go to the **Dashboard**. Confirm you now see a **Data Health** section, closed, with a number on it. Tap it — confirm it opens to reveal the Win-Back / unassigned / at-risk / overdue cards you're used to, and that tapping any of those still takes you to the right screen. Tap the header again to close it.
11. Confirm your monthly **Business Snapshot** is still visible above Data Health without needing to expand anything.
12. Do steps 10 and 11 again on your phone to confirm the section opens and closes properly on a narrow screen.

## Step 159 — A calmer Pipeline screen on the phone

Follow-on to the Dashboard tidy-up in Step 158, applied to the screen the team actually lives in all day. No SQL to run, no edge functions, no new secrets. Ships with the same `sxc-v165` version bump as Step 158, so if you haven't redeployed since then, one redeploy covers both.

**The problem, measured.** On a phone (375 pixels wide), the Pipeline screen was spending **380 of the first 812 pixels on filter controls** before the first prospect: a search box, then five separate rows of filter chips, a niche dropdown, a sort button, and eight more toggle chips. Twenty-three chips in total. An agent opening the app to make calls saw **two leads and a wall of buttons**.

**What changed.** The search box and the status chips (All / Not Contacted / Sent / Replied / Meeting / Signed / Dead) stay exactly where they were, because those are the ones used constantly. Everything else — saved views, tier, city, niche, sort, and the eight extras like "Going Cold" and "No Website" — now sits behind a single **"More filters"** row that you tap to open.

That drops it to **184 pixels before the first lead**, so you see more leads and less furniture the moment the screen opens.

**Nothing was removed, and nothing can hide from you.** Two safeguards, both worth knowing about because they're the difference between "tidier" and "confusing":

1. **A filter that's switched on always announces itself.** The closed row changes from "More filters" to **"Filters: 2 on"**, so a short list is never a mystery.
2. **The panel refuses to close while a filter is on.** Turn on "Going Cold" and the panel stays open. Turn everything off and it collapses again on its own. You can't end up staring at an empty prospect list wondering where everyone went, because the filter doing it is always on screen.

**Setup:** just redeploy the `app/` folder via Netlify Drop.

**Now test it:**

1. Reload the app on your phone (hard refresh if it still looks old).
2. Go to **Prospects**. Confirm you see the search box, the status chips, then a **"More filters"** row, then your leads — and that you can see more leads without scrolling than before.
3. Tap **"More filters"** — confirm it opens to reveal saved views, tier, city, niche, sort, and the eight extra chips, all exactly as they were.
4. With the panel open, tap **"Going Cold"**. Confirm the list filters, the header now reads **"Filters: 1 on"**, and the panel stays open.
5. Tap **"Top Rated"** as well — confirm it now reads **"Filters: 2 on"**.
6. Turn both off. Confirm the header goes back to "More filters" and the panel collapses on its own.
7. Confirm the search box still works and still filters as you type, and that tapping into the Prospects tab from the bottom nav still does **not** pop the keyboard up (the Step 157 fix).
8. Check the same screen on a desktop browser to confirm it looks right there too.
