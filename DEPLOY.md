# Studio X Command — Deploying to a Live Link

The app is a set of plain files (no build step needed), so putting it online is just "upload the `app` folder." We'll use **Netlify Drop** — a free service where you literally drag a folder into a browser tab and get a live link in seconds.

Do this **after** you've finished [SETUP.md](SETUP.md) (Supabase project created, keys pasted into `app/js/config.js`).

---

## Step 1 — Go to Netlify Drop

1. Open **app.netlify.com/drop** in your browser.
2. You don't even need to create an account for the first deploy (though creating a free account, using the "Sign up" button, means you can update the same link later instead of getting a new random one each time — recommended).

## Step 2 — Drag in the folder

1. Open Finder and go to the project folder: **Studio X Lead Command Center**.
2. Drag the **`app`** folder (just that folder, not the whole project) onto the Netlify Drop page in your browser.
3. Wait a few seconds — Netlify uploads and publishes it.
4. You'll get a live link that looks like `https://random-name-123abc.netlify.app`.

## Step 3 — (Recommended) Claim the site with a free account

If you dragged the folder in without being logged in:
1. Click **Sign up** on Netlify (free — email or GitHub).
2. Follow the prompt to **claim** the site you just deployed.
3. This lets you rename the link to something nicer (e.g. `studio-x-command.netlify.app`) via **Site settings → Change site name**, and makes future re-deploys go to the same link.

## Step 4 — Test it

1. Open the live link on your phone.
2. You should see the Studio X Command sign-in screen (not the "Almost there" message — if you still see that, double check `app/js/config.js` has your real Supabase URL and key, and that you dragged the updated `app` folder).

---

## Re-deploying after future changes

Whenever I make a change to the app for you (new feature, fix, etc.), redeploying is the same drag-and-drop:
1. Go to your site's page on **app.netlify.com**.
2. Go to the **Deploys** tab.
3. Drag the updated `app` folder onto the deploy area (it says "Drag and drop your site output folder here").
4. Same link updates automatically — no new link, nothing for your team to re-download. They'll get the new version next time they open the app (the service worker fetches fresh files in the background).

---

## Installing on phones (after you have the live link)

**iPhone (Safari):**
1. Open the link in **Safari** (must be Safari, not Chrome, for this to work on iPhone).
2. Tap the **Share** icon (square with an arrow) at the bottom.
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**. The Studio X Command icon now appears on the home screen like a real app.

**Android (Chrome):**
1. Open the link in **Chrome**.
2. Tap the **⋮** menu (top right).
3. Tap **Install app** (or **Add to Home screen**).
4. Confirm. The icon appears on the home screen and opens full-screen, no browser bar.

Once installed, it opens instantly (even on weak signal) and syncs live data whenever there's a connection.
