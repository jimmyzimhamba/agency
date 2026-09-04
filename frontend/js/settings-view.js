/* Settings view */

async function loadSettingsView() {
  const el = document.getElementById('view-settings');
  const settings = await api.settings.get();
  const studio = settings.studio_x || {};

  el.innerHTML = `
    <h2 style="margin-bottom:20px">Settings</h2>

    ${!settings.has_google_key ? `
    <div class="card mb-3" style="border-color:rgba(255,149,0,0.5);background:rgba(255,149,0,0.06)">
      <div style="font-weight:700;margin-bottom:6px">⚠️ Google Maps API Key Missing</div>
      <p class="text-sm text-muted" style="margin-bottom:10px">
        Without this key, lead discovery and the map view won't work. Manual add and audit work fine without it.
      </p>
      <ol class="text-sm text-muted" style="padding-left:18px;line-height:2">
        <li>Go to <a href="https://console.cloud.google.com/" target="_blank" style="color:var(--neon-green)">console.cloud.google.com</a></li>
        <li>Create or open a project</li>
        <li>Enable <strong>Maps JavaScript API</strong> and <strong>Places API (New)</strong></li>
        <li>Create an API key under Credentials</li>
        <li>Add <code>GOOGLE_MAPS_API_KEY=your_key_here</code> to your <code>.env</code> file</li>
        <li>Restart the server: <code>python -m uvicorn backend.main:app --reload</code></li>
      </ol>
    </div>` : `
    <div class="card mb-3" style="border-color:var(--neon-green);background:rgba(57,255,20,0.05)">
      <div style="color:var(--neon-green);font-weight:700">✓ Google Maps API Connected</div>
      <div class="text-muted text-sm mt-2">Key: ${settings.google_maps_api_key_preview || 'configured'}</div>
    </div>`}

    <div class="card settings-section">
      <h3 style="margin-bottom:14px">Studio X Details</h3>
      <div class="form-grid">
        <div class="form-row">
          <label>Agency Name</label>
          <input class="form-control" id="st-name" value="${studio.name || ''}">
        </div>
        <div class="form-row">
          <label>Your First Name (for templates)</label>
          <input class="form-control" id="st-sender" value="${studio.sender_first_name || ''}">
        </div>
        <div class="form-row">
          <label>WhatsApp Number</label>
          <input class="form-control" id="st-wa" value="${studio.whatsapp || ''}" placeholder="+263...">
        </div>
        <div class="form-row">
          <label>Email</label>
          <input class="form-control" id="st-email" value="${studio.email || ''}">
        </div>
        <div class="form-row form-full">
          <label>Website</label>
          <input class="form-control" id="st-web" value="${studio.website || 'https://studioxmarketing.com'}">
        </div>
      </div>
      <button class="btn btn-primary mt-3" onclick="saveStudioSettings()">Save</button>
    </div>

    <div class="card settings-section">
      <h3 style="margin-bottom:14px">Default Location</h3>
      <div class="form-row" style="max-width:300px">
        <label>Default City</label>
        <input class="form-control" id="st-city" value="${settings.default_city || 'Harare'}">
      </div>
      <button class="btn btn-primary mt-3" onclick="saveLocationSettings()">Save</button>
    </div>

    <div class="card settings-section">
      <h3 style="margin-bottom:8px">Niches</h3>
      <p class="text-muted text-sm mb-3">Niches are configured in <code>data/settings.json</code>. Edit that file to add new niches, search queries, or service angles. Restart the server after changes.</p>
      ${(settings.niches || []).map(n => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:22px">${n.icon}</span>
          <div>
            <div style="font-weight:600">${n.label}</div>
            <div class="text-muted text-sm">${n.queries.length} queries &bull; ${n.description}</div>
          </div>
        </div>`).join('')}
    </div>

    <div class="card settings-section">
      <h3 style="margin-bottom:8px">About</h3>
      <p class="text-muted text-sm">Studio X Lead Command Center v1.0 &bull; Built for <a href="https://studioxmarketing.com" target="_blank">studioxmarketing.com</a></p>
      <p class="text-muted text-sm mt-2">Lead data stored locally in <code>data/studio_x.db</code>. All discovery is via the official Google Places API. Website enrichment respects robots.txt.</p>
    </div>
  `;
}

async function saveStudioSettings() {
  try {
    await api.settings.update({
      studio_x: {
        name: document.getElementById('st-name').value,
        sender_first_name: document.getElementById('st-sender').value,
        whatsapp: document.getElementById('st-wa').value,
        email: document.getElementById('st-email').value,
        website: document.getElementById('st-web').value,
      }
    });
    toast('Settings saved', 'success');
  } catch { toast('Failed to save settings', 'error'); }
}

async function saveLocationSettings() {
  try {
    await api.settings.update({ default_city: document.getElementById('st-city').value });
    toast('Location saved', 'success');
  } catch { toast('Failed to save', 'error'); }
}
