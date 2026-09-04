/* Main app — navigation, routing, init */

const VIEWS = {
  dashboard: { label: 'Dashboard',   icon: '⚡', load: loadDashboard },
  discover:  { label: 'Find Leads',  icon: '🔍', load: loadDiscoverView },
  map:       { label: 'Map',         icon: '🗺',  load: loadMapView },
  pipeline:  { label: 'Pipeline',    icon: '📊', load: loadPipelineView },
  table:     { label: 'Prospects',   icon: '📋', load: loadTableView },
  library:   { label: 'Library',     icon: '📚', load: loadLibraryView },
  settings:  { label: 'Settings',    icon: '⚙️',  load: loadSettingsView },
};

let _currentView = 'dashboard';

function showView(view) {
  if (!VIEWS[view]) return;
  _currentView = view;

  // Update nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });

  // Show/hide view panels
  document.querySelectorAll('.view').forEach(el => {
    el.classList.toggle('active', el.id === 'view-' + view);
  });

  // Update topbar title
  document.getElementById('topbar-title').textContent = VIEWS[view].label;

  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');

  // Load view
  VIEWS[view].load();
}

// Allow views to trigger a refresh of current view
window.refreshCurrentView = () => {
  if (_currentView && VIEWS[_currentView]) {
    VIEWS[_currentView].load();
  }
};

function buildNav() {
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = Object.entries(VIEWS).map(([key, v]) => `
    <div class="nav-item" data-view="${key}" onclick="showView('${key}')">
      <span class="nav-icon">${v.icon}</span>
      <span>${v.label}</span>
    </div>`).join('');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// Close sidebar when clicking outside on mobile
document.addEventListener('click', (e) => {
  const sidebar = document.getElementById('sidebar');
  const hamburger = document.querySelector('.btn-hamburger');
  if (sidebar.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      e.target !== hamburger) {
    sidebar.classList.remove('open');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  buildNav();
  showView('dashboard');
});
