/* Discovery view */

let _discoveryPoll = null;

async function loadDiscoverView() {
  const el = document.getElementById('view-discover');
  const [niches, apiStatus] = await Promise.all([api.settings.niches(), api.discovery.apiStatus()]);

  el.innerHTML = `
    ${!apiStatus.has_key ? `
    <div id="api-banner" class="show">
      <span class="banner-icon">⚠️</span>
      <div>
        <strong>Google Maps API key not configured.</strong>
        Manual add and audit still work. To enable lead discovery and map view,
        add your <code>GOOGLE_MAPS_API_KEY</code> to the <code>.env</code> file.
        <a href="https://console.cloud.google.com/" target="_blank" style="color:var(--neon-green)">Get a key →</a>
      </div>
    </div>` : ''}

    <h2 style="margin-bottom:16px">Find More Leads</h2>

    <div class="discover-form">
      <div class="form-group">
        <label>Niche</label>
        <select class="form-control" id="disc-niche">
          ${niches.map(n => `<option value="${n.id}">${n.icon} ${n.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Area</label>
        <input class="form-control" id="disc-area" placeholder="e.g. Borrowdale, Avondale..." value="Borrowdale">
      </div>
      <div class="form-group">
        <label>City</label>
        <input class="form-control" id="disc-city" placeholder="Harare" value="Harare">
      </div>
      <button class="btn btn-primary" onclick="startDiscovery()" ${!apiStatus.has_key ? 'disabled title="Add Google Maps API key first"' : ''}>
        🔍 Find Leads
      </button>
    </div>

    <div class="progress-bar-wrap" id="disc-progress-wrap">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <strong id="disc-prog-title" style="font-size:14px">Searching...</strong>
        <span class="mono" id="disc-prog-count" style="font-size:12px;color:var(--text-muted)">0 / 0</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" id="disc-prog-bar" style="width:0%"></div>
      </div>
      <div class="progress-msg" id="disc-prog-msg">Starting...</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      ${niches.map(n => `
      <div class="card">
        <div style="font-size:22px;margin-bottom:8px">${n.icon}</div>
        <div style="font-weight:700;margin-bottom:4px">${n.label}</div>
        <div class="text-muted text-sm" style="margin-bottom:10px">${n.description}</div>
        <div class="text-sm" style="color:var(--purple-pale)">${n.queries.length} search queries loaded</div>
      </div>`).join('')}
    </div>

    <div class="card">
      <div class="section-title" style="margin-bottom:12px">Add Prospect Manually</div>
      ${renderAddForm(niches)}
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-title" style="margin-bottom:12px">Import CSV</div>
      <p class="text-muted text-sm mb-3">CSV columns: business_name, niche, phone, email, website, address, suburb, city, notes</p>
      <div class="import-drop-zone" id="drop-zone" onclick="document.getElementById('csv-input').click()">
        <div class="drop-icon">📂</div>
        <p>Drop a CSV file here or tap to browse</p>
        <p style="margin-top:4px;font-size:11px;color:var(--purple-pale)">Duplicates are automatically skipped</p>
      </div>
      <input type="file" id="csv-input" accept=".csv" class="hidden" onchange="importCsv(this)">
      <div id="import-result" class="hidden"></div>
    </div>
  `;

  setupDropZone();
}

function renderAddForm(niches) {
  return `
    <div class="form-grid" id="add-form">
      <div class="form-row form-full">
        <label>Business Name *</label>
        <input class="form-control" id="add-name" placeholder="Glow Aesthetics Clinic">
      </div>
      <div class="form-row">
        <label>Niche *</label>
        <select class="form-control" id="add-niche">
          ${niches.map(n => `<option value="${n.id}">${n.icon} ${n.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>Phone / WhatsApp</label>
        <input class="form-control" id="add-phone" placeholder="+263 77 123 4567">
      </div>
      <div class="form-row">
        <label>Email</label>
        <input class="form-control" id="add-email" placeholder="hello@clinic.co.zw">
      </div>
      <div class="form-row">
        <label>Website</label>
        <input class="form-control" id="add-website" placeholder="https://...">
      </div>
      <div class="form-row">
        <label>Instagram URL</label>
        <input class="form-control" id="add-instagram" placeholder="https://instagram.com/...">
      </div>
      <div class="form-row">
        <label>Suburb</label>
        <input class="form-control" id="add-suburb" placeholder="Borrowdale">
      </div>
      <div class="form-row">
        <label>City</label>
        <input class="form-control" id="add-city" placeholder="Harare" value="Harare">
      </div>
      <div class="form-row form-full">
        <label>Notes</label>
        <textarea class="form-control" id="add-notes" rows="2" placeholder="Any notes..."></textarea>
      </div>
      <div class="form-full">
        <button class="btn btn-primary w-full" onclick="addProspectManual()">+ Add Prospect (runs audit automatically)</button>
      </div>
    </div>
  `;
}

async function addProspectManual() {
  const name = document.getElementById('add-name').value.trim();
  if (!name) { toast('Business name is required', 'error'); return; }

  const data = {
    business_name: name,
    niche: document.getElementById('add-niche').value,
    phone: document.getElementById('add-phone').value.trim() || null,
    email: document.getElementById('add-email').value.trim() || null,
    website: document.getElementById('add-website').value.trim() || null,
    instagram: document.getElementById('add-instagram').value.trim() || null,
    suburb: document.getElementById('add-suburb').value.trim() || null,
    city: document.getElementById('add-city').value.trim() || 'Harare',
    notes: document.getElementById('add-notes').value.trim() || null,
    source: 'manual',
  };

  // Auto-set whatsapp from phone
  if (data.phone) data.whatsapp = data.phone;

  try {
    const p = await api.prospects.create(data);
    toast(`${name} added! Audit running in background.`, 'success');
    // Clear form
    ['add-name','add-phone','add-email','add-website','add-instagram','add-suburb','add-notes'].forEach(id => {
      document.getElementById(id).value = '';
    });
    setTimeout(() => openProspect(p.id), 500);
  } catch (e) { toast('Failed to add prospect: ' + e.message, 'error'); }
}

async function startDiscovery() {
  const niche = document.getElementById('disc-niche').value;
  const area = document.getElementById('disc-area').value.trim();
  const city = document.getElementById('disc-city').value.trim() || 'Harare';

  if (!area) { toast('Enter an area to search', 'error'); return; }

  try {
    await api.discovery.run({ niche_id: niche, area, city });
    document.getElementById('disc-progress-wrap').classList.add('show');
    pollDiscoveryProgress();
  } catch (e) { toast('Discovery failed: ' + e.message, 'error'); }
}

function pollDiscoveryProgress() {
  if (_discoveryPoll) clearInterval(_discoveryPoll);
  _discoveryPoll = setInterval(async () => {
    try {
      const p = await api.discovery.progress();
      const wrap = document.getElementById('disc-progress-wrap');
      if (!wrap) { clearInterval(_discoveryPoll); return; }

      document.getElementById('disc-prog-msg').textContent = p.message;
      document.getElementById('disc-prog-count').textContent = `${p.done} / ${p.total || '?'}`;
      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : (p.running ? 30 : 100);
      document.getElementById('disc-prog-bar').style.width = pct + '%';
      document.getElementById('disc-prog-title').textContent = p.running ? 'Searching...' : 'Complete';

      if (!p.running) {
        clearInterval(_discoveryPoll);
        toast(p.message, 'success');
        if (window.refreshCurrentView) window.refreshCurrentView();
      }
    } catch { clearInterval(_discoveryPoll); }
  }, 1500);
}

function setupDropZone() {
  const zone = document.getElementById('drop-zone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) doImport(file);
  });
}

async function importCsv(input) {
  const file = input.files[0];
  if (file) await doImport(file);
}

async function doImport(file) {
  toast('Importing...', 'info');
  try {
    const res = await api.prospects.importCsv(file);
    const el = document.getElementById('import-result');
    el.classList.remove('hidden');
    el.innerHTML = `<div class="card card-sm mt-2" style="border-color:var(--neon-green)">
      ✓ Imported: <strong>${res.added}</strong> added, <strong>${res.duplicates}</strong> skipped, <strong>${res.errors}</strong> errors.
    </div>`;
    toast(`Import done: ${res.added} added`, 'success');
    if (window.refreshCurrentView) window.refreshCurrentView();
  } catch (e) { toast('Import failed: ' + e.message, 'error'); }
}
