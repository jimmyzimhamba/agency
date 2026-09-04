/* Dashboard view */

async function loadDashboard() {
  const el = document.getElementById('view-dashboard');
  try {
    const [stats, settings] = await Promise.all([api.prospects.stats(), api.settings.get()]);
    const studioName = settings?.studio_x?.name || 'Studio X Marketing';

    const pipeline = stats.by_status || {};
    const niches = stats.by_niche || {};

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px">
        <div>
          <h2 style="font-size:22px;margin-bottom:4px">${studioName}</h2>
          <p class="text-muted text-sm">Lead Command Center &bull; ${new Date().toLocaleDateString('en-ZW', {weekday:'long', day:'numeric', month:'long'})}</p>
        </div>
        <button class="btn btn-primary" onclick="showView('discover')">+ Find More Leads</button>
      </div>

      <div class="stats-grid">
        <div class="stat-card stat-total">
          <div class="stat-number">${stats.total || 0}</div>
          <div class="stat-label">Total Prospects</div>
        </div>
        <div class="stat-card stat-HOT">
          <div class="stat-number">${stats.hot || 0}</div>
          <div class="stat-label">🔥 HOT</div>
        </div>
        <div class="stat-card stat-WARM">
          <div class="stat-number">${stats.warm || 0}</div>
          <div class="stat-label">🌡 WARM</div>
        </div>
        <div class="stat-card stat-COLD">
          <div class="stat-number">${stats.cold || 0}</div>
          <div class="stat-label">❄ COLD</div>
        </div>
        <div class="stat-card stat-green">
          <div class="stat-number">${stats.contacted_today || 0}</div>
          <div class="stat-label">Contacted Today</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" style="color:var(--gold)">${pipeline.won || 0}</div>
          <div class="stat-label">Won</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card">
          <div class="section-title">Pipeline</div>
          ${renderMiniPipeline(pipeline)}
        </div>
        <div class="card">
          <div class="section-title">By Niche</div>
          ${renderNicheBreakdown(niches)}
        </div>
      </div>

      <div class="card">
        <div class="section-title" style="margin-bottom:14px">HOT Leads — Act Now</div>
        <div id="hot-leads-list">Loading...</div>
      </div>
    `;

    // Load hot leads
    const hot = await api.prospects.list({ score: 'HOT', limit: 10 });
    const hotEl = document.getElementById('hot-leads-list');
    if (!hotEl) return;
    if (!hot.length) { hotEl.innerHTML = '<p class="text-muted text-sm">No HOT leads yet. Run discovery to find your first ones.</p>'; return; }
    hotEl.innerHTML = hot.map(p => `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer"
           onclick="openProspect(${p.id})">
        <span class="badge badge-HOT"><span class="badge-dot"></span>HOT</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;truncate">${p.business_name}</div>
          <div class="text-muted text-sm">${p.suburb || p.city || ''} &bull; ${p.niche}</div>
        </div>
        <span style="font-size:18px">${channelIcon(p.recommended_channel)}</span>
        <span style="color:var(--text-muted);font-size:18px">›</span>
      </div>`).join('');

  } catch (e) {
    el.innerHTML = `<div class="card"><p class="text-muted">Failed to load dashboard: ${e.message}</p></div>`;
  }
}

function renderMiniPipeline(pipeline) {
  const stages = [
    { key: 'new', label: 'New', color: '#9333ea' },
    { key: 'contacted', label: 'Contacted', color: '#ff9500' },
    { key: 'replied', label: 'Replied', color: '#39ff14' },
    { key: 'call_booked', label: 'Call Booked', color: '#ffd700' },
    { key: 'won', label: 'Won', color: '#00ff88' },
    { key: 'lost', label: 'Lost', color: '#ff3b3b' },
  ];
  return stages.map(s => `
    <div style="display:flex;align-items:center;gap:10px;padding:5px 0">
      <div style="width:8px;height:8px;border-radius:50%;background:${s.color};flex-shrink:0"></div>
      <div style="flex:1;font-size:13px">${s.label}</div>
      <div style="font-family:'Space Mono';font-size:13px;color:var(--text-muted)">${pipeline[s.key] || 0}</div>
    </div>`).join('');
}

function renderNicheBreakdown(niches) {
  if (!Object.keys(niches).length) return '<p class="text-muted text-sm">No data yet.</p>';
  return Object.entries(niches).map(([k, v]) => `
    <div style="display:flex;align-items:center;gap:10px;padding:5px 0">
      <div style="flex:1;font-size:13px;text-transform:capitalize">${k}</div>
      <div style="font-family:'Space Mono';font-size:13px;color:var(--purple-pale)">${v}</div>
    </div>`).join('');
}
