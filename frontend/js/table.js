/* Table / list view */

let _tableProspects = [];
let _sortCol = 'date_added';
let _sortDir = -1;

async function loadTableView() {
  const el = document.getElementById('view-table');
  const niches = await api.settings.niches();

  el.innerHTML = `
    <div class="table-filters">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input class="form-control" id="tbl-search" placeholder="Search businesses..." oninput="applyTableFilters()">
      </div>
      <select class="form-control" id="tbl-niche" onchange="applyTableFilters()" style="min-width:140px">
        <option value="">All niches</option>
        ${niches.map(n => `<option value="${n.id}">${n.icon} ${n.label}</option>`).join('')}
      </select>
      <select class="form-control" id="tbl-score" onchange="applyTableFilters()">
        <option value="">All scores</option>
        <option value="HOT">🔥 HOT</option>
        <option value="WARM">🌡 WARM</option>
        <option value="COLD">❄ COLD</option>
      </select>
      <select class="form-control" id="tbl-status" onchange="applyTableFilters()">
        <option value="">All statuses</option>
        <option value="new">New</option>
        <option value="contacted">Contacted</option>
        <option value="replied">Replied</option>
        <option value="call_booked">Call Booked</option>
        <option value="won">Won</option>
        <option value="lost">Lost</option>
      </select>
      <select class="form-control" id="tbl-has_whatsapp" onchange="applyTableFilters()">
        <option value="">Any contact</option>
        <option value="true">Has WhatsApp</option>
        <option value="false">No WhatsApp</option>
      </select>
      <button class="btn btn-ghost btn-sm" onclick="loadTableData()">↻ Refresh</button>
    </div>
    <div class="table-wrap">
      <table id="prospects-table">
        <thead>
          <tr>
            <th onclick="sortTable('business_name')">Business ↕</th>
            <th onclick="sortTable('niche')">Niche ↕</th>
            <th onclick="sortTable('score')">Score ↕</th>
            <th>Channel</th>
            <th onclick="sortTable('google_rating')">Rating ↕</th>
            <th onclick="sortTable('status')">Status ↕</th>
            <th onclick="sortTable('date_added')">Added ↕</th>
            <th>Weaknesses</th>
          </tr>
        </thead>
        <tbody id="table-body">
          <tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted)">Loading...</td></tr>
        </tbody>
      </table>
    </div>
    <div id="table-footer" class="text-muted text-sm mt-2"></div>
  `;

  await loadTableData();
}

async function loadTableData() {
  const params = {
    niche: document.getElementById('tbl-niche')?.value || '',
    score: document.getElementById('tbl-score')?.value || '',
    status: document.getElementById('tbl-status')?.value || '',
    has_whatsapp: document.getElementById('tbl-has_whatsapp')?.value || '',
    q: document.getElementById('tbl-search')?.value || '',
    limit: 300,
  };
  try {
    _tableProspects = await api.prospects.list(params);
    renderTable(_tableProspects);
  } catch (e) { toast('Failed to load prospects: ' + e.message, 'error'); }
}

function renderTable(prospects) {
  const tbody = document.getElementById('table-body');
  const footer = document.getElementById('table-footer');
  if (!tbody) return;

  if (!prospects.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted)">No prospects found. Try different filters or add some leads.</td></tr>`;
    if (footer) footer.textContent = '';
    return;
  }

  tbody.innerHTML = prospects.map(p => {
    const weaknesses = getWeaknesses(p);
    const topWeak = weaknesses[0];
    return `
    <tr onclick="openProspect(${p.id})" title="${p.business_name}">
      <td class="td-name">
        <div class="truncate" style="max-width:180px">${p.business_name}</div>
        <small>${p.suburb || ''} ${p.city || ''}</small>
      </td>
      <td class="text-sm text-muted">${p.niche}</td>
      <td>${scoreBadge(p.score)}</td>
      <td class="td-channel ${channelClass(p.recommended_channel)}">${channelIcon(p.recommended_channel)}</td>
      <td>${p.google_rating ? `<span class="rating">★${p.google_rating.toFixed(1)}</span><span class="text-muted text-sm"> (${p.review_count||0})</span>` : '--'}</td>
      <td><span style="font-size:11px;padding:3px 8px;border-radius:999px;background:${statusColor(p.status)}22;color:${statusColor(p.status)}">${statusLabel(p.status)}</span></td>
      <td class="text-muted text-sm">${formatDate(p.date_added)}</td>
      <td class="text-sm" style="color:var(--neon-pink);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${topWeak ? '⚠ ' + topWeak.label : (p.enrichment_status === 'pending' ? '⏳ auditing...' : '')}
      </td>
    </tr>`;
  }).join('');

  if (footer) footer.textContent = `${prospects.length} prospect${prospects.length !== 1 ? 's' : ''} shown`;
}

function sortTable(col) {
  if (_sortCol === col) _sortDir *= -1;
  else { _sortCol = col; _sortDir = 1; }

  _tableProspects.sort((a, b) => {
    let va = a[col] ?? '';
    let vb = b[col] ?? '';
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return -_sortDir;
    if (va > vb) return _sortDir;
    return 0;
  });
  renderTable(_tableProspects);
}

function applyTableFilters() {
  loadTableData();
}
