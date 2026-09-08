// Desktop sidebar collapse ("minimize to icons"), a personal, per-device
// layout preference, not an org-wide setting, so it lives in localStorage
// rather than the profiles table (same reasoning as theme.js: no reason
// for one teammate's screen layout choice to sync to everyone else's).
//
// app.html has a tiny inline script (before the stylesheet loads) that
// reads the same localStorage key and sets data-sidebar on <html> before
// first paint, so a returning user never sees the sidebar flash full-width
// then snap to collapsed on load. Everything here just needs to stay in
// sync with that same key/values.
const KEY = "sxc-sidebar-collapsed";

export function isSidebarCollapsed() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed) {
  if (collapsed) document.documentElement.setAttribute("data-sidebar", "collapsed");
  else document.documentElement.removeAttribute("data-sidebar");

  try {
    localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    // Private browsing / storage disabled, still applies for this page
    // load, it just won't be remembered next time. Not worth a toast.
  }
}

export function toggleSidebarCollapsed() {
  setSidebarCollapsed(!isSidebarCollapsed());
}

// Called once on boot (after the inline head script has already set the
// attribute pre-paint) so anything reflecting "current sidebar state" is
// correct from the first render, even though the attribute itself is
// typically already right by the time this runs. Mirrors initTheme().
export function initSidebarCollapse() {
  setSidebarCollapsed(isSidebarCollapsed());
}
