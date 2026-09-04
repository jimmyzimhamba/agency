/* Kanban pipeline view */

const PIPELINE_STAGES = [
  { key: 'new',         label: 'New',         color: '#9333ea' },
  { key: 'contacted',   label: 'Contacted',   color: '#ff9500' },
  { key: 'replied',     label: 'Replied',     color: '#39ff14' },
  { key: 'call_booked', label: 'Call Booked', color: '#ffd700' },
  { key: 'won',         label: 'Won',         color: '#00ff88' },
  { key: 'lost',        label: 'Lost',        color: '#ff3b3b' },
];

async function loadPipelineView() {
  const el = document.getElementById('view-pipeline');

  // Top bar with filters
  el.innerHTML = `
    <div class="map-topbar">
      <span style="font-weight:600">Pipeline</span>
      <select class="form-control" id="pipe-niche" onchange="loadPipelineData()" style="min-width:140px;padding:6px 10px">
        <option value="">All niches</option>
      </select>
      <button class="btn btn-ghost btn-sm" onclick="loadPipelineData()">↻</button>
    </div>
    <div class="kanban-wrap" id="kanban-wrap">
      ${PIPELINE_STAGES.map(s => `
      <div class="kanban-col" id="col-${s.key}" data-status="${s.key}"
           ondragover="kanbanDragOver(event)" ondrop="kanbanDrop(event,'${s.key}')">
        <div class="kanban-col-header">
          <span class="kanban-col-title" style="color:${s.color}">${s.label}</span>
          <span class="kanban-col-count" id="count-${s.key}">0</span>
        </div>
        <div class="kanban-cards" id="cards-${s.key}">
          <div class="text-muted text-sm text-center" style="padding:20px 10px">Loading...</div>
        </div>
      </div>`).join('')}
    </div>
  `;

  // Populate niche filter
  api.settings.niches().then(niches => {
    const sel = document.getElementById('pipe-niche');
    if (!sel) return;
    niches.forEach(n => {
      const o = document.createElement('option');
      o.value = n.id; o.textContent = n.icon + ' ' + n.label;
      sel.appendChild(o);
    });
  });

  await loadPipelineData();
}

async function loadPipelineData() {
  const niche = document.getElementById('pipe-niche')?.value || '';
  try {
    const prospects = await api.prospects.list({ niche, limit: 500 });
    renderKanban(prospects);
  } catch (e) { toast('Failed to load pipeline', 'error'); }
}

function renderKanban(prospects) {
  const byStatus = {};
  PIPELINE_STAGES.forEach(s => { byStatus[s.key] = []; });
  prospects.forEach(p => {
    const bucket = byStatus[p.status] || byStatus['new'];
    bucket.push(p);
  });

  PIPELINE_STAGES.forEach(s => {
    const col = document.getElementById('cards-' + s.key);
    const count = document.getElementById('count-' + s.key);
    if (!col) return;
    const cards = byStatus[s.key] || [];
    count.textContent = cards.length;
    if (!cards.length) {
      col.innerHTML = `<div class="text-muted text-sm text-center" style="padding:20px 10px">Empty</div>`;
      return;
    }
    col.innerHTML = cards.map(p => kanbanCard(p)).join('');
  });
}

function kanbanCard(p) {
  const weaknesses = getWeaknesses(p);
  return `
  <div class="kanban-card" draggable="true"
       data-id="${p.id}" data-status="${p.status}"
       onclick="openProspect(${p.id})"
       ondragstart="kanbanDragStart(event,${p.id},'${p.status}')">
    <div class="kanban-card-name truncate">${p.business_name}</div>
    <div class="kanban-card-meta">${p.suburb || p.city || 'Harare'} &bull; ${p.niche}</div>
    ${weaknesses[0] ? `<div class="text-sm mt-2" style="color:var(--neon-pink)">⚠ ${weaknesses[0].label}</div>` : ''}
    <div class="kanban-card-footer">
      ${scoreBadge(p.score)}
      <span class="${channelClass(p.recommended_channel)}" style="font-size:18px">${channelIcon(p.recommended_channel)}</span>
    </div>
  </div>`;
}

let _dragId = null;
let _dragFrom = null;

function kanbanDragStart(e, id, fromStatus) {
  _dragId = id;
  _dragFrom = fromStatus;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => { const el = document.querySelector(`[data-id="${id}"]`); if (el) el.classList.add('dragging'); }, 0);
}

function kanbanDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const col = e.currentTarget;
  document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-over'));
  col.classList.add('drag-over');
}

async function kanbanDrop(e, toStatus) {
  e.preventDefault();
  document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-over'));
  document.querySelectorAll('.kanban-card').forEach(c => c.classList.remove('dragging'));

  if (!_dragId || _dragFrom === toStatus) return;

  try {
    await api.prospects.update(_dragId, { status: toStatus });
    toast(`Moved to ${statusLabel(toStatus)}`, 'success');
    await loadPipelineData();
  } catch { toast('Failed to update status', 'error'); }
  _dragId = null;
  _dragFrom = null;
}
