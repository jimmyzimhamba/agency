import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const CONFIGURED = !SUPABASE_URL.startsWith("PASTE_") && !SUPABASE_ANON_KEY.startsWith("PASTE_");

// The Supabase library is loaded globally via the <script> tag in app.html
// (no build step needed, it just attaches itself as `window.supabase`).
// Guarded so the placeholder config values (before setup) don't crash the
// app before we get a chance to show the "connect your database" message.
export const sb = CONFIGURED
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
