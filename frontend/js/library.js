/* Content library view */

let _lib = null;
let _libTab = 'whatsapp';

async function loadLibraryView() {
  const el = document.getElementById('view-library');
  if (!_lib) _lib = await api.outreach.library();

  el.innerHTML = `
    <h2 style="margin-bottom:16px">Content Library</h2>
    <p class="text-muted text-sm mb-3">Studio X voice: warm, direct, Zimbabwean. Tap any script to copy. Edit merge fields before sending.</p>

    <div class="library-tabs">
      <button class="lib-tab ${_libTab==='whatsapp'?'active':''}" onclick="switchLibTab('whatsapp')">💬 WhatsApp</button>
      <button class="lib-tab ${_libTab==='instagram'?'active':''}" onclick="switchLibTab('instagram')">📸 Instagram</button>
      <button class="lib-tab ${_libTab==='facebook'?'active':''}" onclick="switchLibTab('facebook')">👍 Facebook</button>
      <button class="lib-tab ${_libTab==='email'?'active':''}" onclick="switchLibTab('email')">✉️ Email</button>
      <button class="lib-tab ${_libTab==='linkedin'?'active':''}" onclick="switchLibTab('linkedin')">💼 LinkedIn</button>
      <button class="lib-tab ${_libTab==='call'?'active':''}" onclick="switchLibTab('call')">📞 Call Script</button>
      <button class="lib-tab ${_libTab==='objections'?'active':''}" onclick="switchLibTab('objections')">🛡 Objections</button>
      <button class="lib-tab ${_libTab==='followup'?'active':''}" onclick="switchLibTab('followup')">📅 Follow-Ups</button>
      <button class="lib-tab ${_libTab==='why'?'active':''}" onclick="switchLibTab('why')">⚡ Why Studio X</button>
    </div>

    <div id="lib-content">
      ${renderLibPanel(_libTab)}
    </div>
  `;
}

function switchLibTab(tab) {
  _libTab = tab;
  document.querySelectorAll('.lib-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.toLowerCase().includes(tab) || t.getAttribute('onclick').includes(tab));
  });
  document.getElementById('lib-content').innerHTML = renderLibPanel(tab);
}

function renderLibPanel(tab) {
  if (!_lib) return '<p class="text-muted">Loading...</p>';

  if (tab === 'objections') {
    return _lib.objection_counters.map(o => `
      <div class="template-card">
        <div class="objection-q">💬 "${o.objection}"</div>
        <div class="objection-response">${o.response}</div>
        <div style="margin-top:10px">
          <button class="btn btn-copy" onclick="copyToClipboard(${JSON.stringify(o.response)})">📋 Copy response</button>
        </div>
      </div>`).join('');
  }

  if (tab === 'followup') {
    return _lib.follow_up_sequence.map(f => `
      <div class="template-card">
        <div class="template-card-header">
          <span class="template-card-label">Touch ${f.touch} — ${f.label}</span>
          <span class="template-card-channel">Day ${f.day}</span>
        </div>
        <div class="template-body">${f.template}</div>
        <div>
          <button class="btn btn-copy" onclick="copyToClipboard(${JSON.stringify(f.template)})">📋 Copy</button>
        </div>
      </div>`).join('');
  }

  if (tab === 'why') {
    return `
      <div class="template-card">
        <div class="template-card-label mb-2">Why Studio X — Snippet</div>
        <div class="template-body">${_lib.why_studio_x}</div>
        <button class="btn btn-copy mt-2" onclick="copyToClipboard(${JSON.stringify(_lib.why_studio_x)})">📋 Copy</button>
      </div>`;
  }

  // Opening templates by channel
  const templates = _lib.opening_templates[tab] || [];
  if (!templates.length) return `<p class="text-muted text-sm">No templates for this channel yet.</p>`;

  return templates.map(t => `
    <div class="template-card">
      <div class="template-card-header">
        <span class="template-card-label">${t.label}</span>
        <span class="template-card-channel">${tab}</span>
      </div>
      <div class="template-body">${t.template}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-copy" onclick="copyToClipboard(${JSON.stringify(t.template)})">📋 Copy template</button>
        <button class="btn btn-ghost btn-sm" onclick="fillMergePreview(${JSON.stringify(t.template).replace(/'/g, "\\'")}, '${t.id}')">👁 Preview filled</button>
      </div>
      <div id="preview-${t.id}" class="hidden"></div>
    </div>`).join('');
}

function fillMergePreview(template, id) {
  const el = document.getElementById('preview-' + id);
  if (!el) return;
  if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }

  const filled = mergeTemplate(template, {
    first_name: 'Chido',
    business_name: 'Glow Aesthetics Clinic',
    weakness: 'no Instagram presence',
    sender_name: 'Tino',
  });
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="msg-editor mt-2">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Preview (with sample merge fields)</div>
      <div style="font-size:13px;color:var(--text-primary);line-height:1.6;white-space:pre-wrap">${filled}</div>
      <div class="msg-editor-footer">
        <button class="btn btn-copy" onclick="copyToClipboard(${JSON.stringify(filled)})">📋 Copy</button>
      </div>
    </div>`;
}
