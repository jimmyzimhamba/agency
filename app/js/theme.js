// Light/dark mode, a personal, per-device display preference, not an
// org-wide setting, so it lives in localStorage rather than the profiles
// table (no reason for a teammate's screen brightness preference to sync
// to everyone else's phone, and no migration/RLS needed for it either).
//
// app.html has a tiny inline script (before the stylesheet loads) that
// reads the same localStorage key and sets data-theme on <html> before
// first paint, so the app never flashes dark-then-light on load. Everything
// here just needs to stay in sync with that same key/values.
//
// By default the theme follows the clock: light during the day, dark after
// sunset. Harare sits at latitude -17.8, so sunrise and sunset stay within
// about half an hour of 06:00 and 18:00 all year round. That makes a pair of
// hardcoded boundaries genuinely accurate here, and saves pulling in a solar
// position library to compute something that never moves.
//
// Tapping the theme button still wins, but only until the next time the sun
// comes up or goes down. Someone who forces light mode at 8pm in a bright
// room gets light mode for that evening, and wakes up to an app that has gone
// back to following the clock. That way an explicit choice is always honoured
// and the automatic behaviour is never permanently switched off by one tap.
const KEY = "sxc-theme";
const THEME_COLOR = { dark: "#0a0a0d", light: "#f4f3f7" };
const DAY_START = 6;   // sunrise, near enough, every day of the year
const DAY_END = 18;    // sunset
const PIN_MAX_MS = 12 * 60 * 60 * 1000;

// What the clock alone says the theme should be, ignoring any manual choice.
export function clockTheme(date) {
  const h = (date || new Date()).getHours();
  return h >= DAY_START && h < DAY_END ? "light" : "dark";
}

// The theme actually showing right now: a manual choice if one is still in
// force, otherwise whatever the clock says.
export function getTheme() {
  let raw = "";
  try {
    raw = localStorage.getItem(KEY) || "";
  } catch {
    return clockTheme();
  }

  const at = raw.indexOf("@");
  // A bare "light"/"dark" is the old format from before this was automatic.
  // Those are treated as no choice at all rather than as a permanent pin,   // otherwise everyone who ever touched the toggle would be locked out of the
  // new behaviour and would never see it work.
  if (at < 0) return clockTheme();

  const mode = raw.slice(0, at) === "light" ? "light" : "dark";
  const when = Number(raw.slice(at + 1));
  if (!when) return clockTheme();

  const now = Date.now();
  const elapsed = now - when;
  // The pin lapses when the sun next moves. The elapsed check catches the case
  // where it is 8pm again exactly one day later, same side of the clock, but
  // obviously a stale choice.
  if (elapsed < 0 || elapsed > PIN_MAX_MS) return clockTheme();
  if (clockTheme(new Date(when)) !== clockTheme(new Date(now))) return clockTheme();
  return mode;
}

// Paints a theme without recording it as a choice.
function applyTheme(theme) {
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");

  // Keeps the browser/OS chrome (status bar, task switcher card) matching
  // the app's own background instead of staying stuck on the dark value
  // baked into app.html's <meta name="theme-color">.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[theme]);
}

// Records a deliberate choice and paints it.
export function setTheme(mode) {
  const theme = mode === "light" ? "light" : "dark";
  applyTheme(theme);

  try {
    localStorage.setItem(KEY, theme + "@" + Date.now());
  } catch {
    // Private browsing / storage disabled, theme still applies for this
    // page load, it just won't be remembered next time. Not worth a toast.
  }
}

export function toggleTheme() {
  setTheme(getTheme() === "light" ? "dark" : "light");
}

// Called once on boot (after the inline head script has already set the
// attribute pre-paint) so the theme-color meta tag and any UI reflecting
// "current theme" are correct from the first render, even though the
// attribute itself is typically already right by the time this runs.
//
// The interval is what makes the app change over while it is sitting open.
// Someone doing evening outreach should watch it go dark at six rather than
// find out tomorrow. It only writes to the DOM when the answer has actually
// changed, so most ticks cost one getHours() call and nothing else.
export function initTheme() {
  let current = getTheme();
  applyTheme(current);

  setInterval(() => {
    const next = getTheme();
    if (next === current) return;
    current = next;
    applyTheme(next);
    document.dispatchEvent(new CustomEvent("sxc:themechange", { detail: next }));
  }, 60000);
}
