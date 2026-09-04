// Light/dark mode — a personal, per-device display preference, not an
// org-wide setting, so it lives in localStorage rather than the profiles
// table (no reason for a teammate's screen brightness preference to sync
// to everyone else's phone, and no migration/RLS needed for it either).
//
// index.html has a tiny inline script (before the stylesheet loads) that
// reads the same localStorage key and sets data-theme on <html> before
// first paint, so the app never flashes dark-then-light on load. Everything
// here just needs to stay in sync with that same key/values.
const KEY = "sxc-theme";
const THEME_COLOR = { dark: "#0a0a0d", light: "#f4f3f7" };

export function getTheme() {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function setTheme(mode) {
  const theme = mode === "light" ? "light" : "dark";
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");

  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private browsing / storage disabled — theme still applies for this
    // page load, it just won't be remembered next time. Not worth a toast.
  }

  // Keeps the browser/OS chrome (status bar, task switcher card) matching
  // the app's own background instead of staying stuck on the dark value
  // baked into index.html's <meta name="theme-color">.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[theme]);
}

export function toggleTheme() {
  setTheme(getTheme() === "light" ? "dark" : "light");
}

// Called once on boot (after the inline head script has already set the
// attribute pre-paint) so the theme-color meta tag and any UI reflecting
// "current theme" are correct from the first render, even though the
// attribute itself is typically already right by the time this runs.
export function initTheme() {
  setTheme(getTheme());
}
