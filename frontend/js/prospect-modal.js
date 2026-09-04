/* Prospect detail modal / drawer */

let _currentProspect = null;
let _library = null;
let _settings = null;

async function ensureLibrary() {
  if (!_library) _library = await api.outreach.library();
  if (!_settings) _settings = await api.settings.get();
}

async function openProspect(id) {
  await ensureLibrary();
  const p = await api.prospects.get(id);
  _currentProspect = p;
  renderModal(p);
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  _currentProspect = null;
}

function renderModal(p) {
  const weaknesses = getWeaknesses(p);
  const sender = _settings?.studio_x || {};

  document.getElementById('modal-overlay').innerHTML = `
    <div id="prospect-modal">
      <div class="modal-header">
        <div class="modal-title">
          <h3>${p.business_name}</h3>
          <div class="modal-meta">
            ${p.suburb ? p.suburb + ', ' : ''}${p.city || 'Harare'} &bull; ${p.niche}
            ${p.google_rating ? ' &bull; ★ ' + p.google_rating.toFixed(1) + ' (' + (p.review_count || 0) + ')' : ''}
          </div>
        </div>
        <div class="flex gap-2" style="align-items:center">
          ${scoreBadge(p.score)}
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
      </div>
      <div class="modal-body">

        ${p.opening_line ? `
        <div class="card card-sm mb-3" style="border-color:var(--purple-mid);background:rgba(123,47,190,0.1)">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.8px">Opening Line</div>
          <div style="font-size:14px;font-style:italic;">"${p.opening_line}"</div>
          <button class="btn btn-copy mt-2" onclick="copyToClipboard('${p.opening_line.replace(/'/g, "\\'")}')">📋 Copy</button>
        </div>` : ''}

        <!-- Best Way In -->
        <div class="modal-section">
          <div class="modal-section-title">Best Way In</div>
          ${p.recommended_channel ? `
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;">
            ${channelIcon(p.recommended_channel)} <strong>${p.recommended_channel.toUpperCase()}</strong> — ${p.recommended_reason || ''}
          </div>` : ''}
          <div class="action-buttons" id="action-buttons-list">
            ${buildActionButtons(p, weaknesses, sender)}
          </div>
        </div>

        <!-- Weaknesses -->
        ${weaknesses.length > 0 ? `
        <div class="modal-section">
          <div class="modal-section-title">Weaknesses Found (${weaknesses.length})</div>
          <div class="weakness-list">
            ${weaknesses.map(w => `
            <div class="weakness-item">
              <div class="w-label">⚠ ${w.label}</div>
              <div class="w-angle">${w.service_angle}</div>
            </div>`).join('')}
          </div>
        </div>` : `
        <div class="modal-section">
          <div class="modal-section-title">Weaknesses</div>
          <p class="text-muted text-sm">${p.enrichment_status === 'pending' ? 'Audit in progress...' : p.enrichment_status === 'failed' ? 'Audit failed.' : 'No clear weaknesses detected.'}</p>
          ${p.enrichment_status !== 'running' ? `<button class="btn btn-ghost btn-sm mt-2" onclick="reEnrich(${p.id})">🔄 Re-run audit</button>` : ''}
        </div>`}

        <!-- Contact Info -->
        <div class="modal-section">
          <div class="modal-section-title">Contact Info</div>
          <div class="info-grid">
            ${infoItem('Phone', p.phone || '--')}
            ${infoItem('WhatsApp', p.whatsapp || '--')}
            ${infoItem('Email', p.email || '--')}
            ${infoItem('Website', p.website ? `<a href="${p.website}" target="_blank">${shortUrl(p.website)}</a>` : '--')}
            ${infoItem('Instagram', p.instagram ? `<a href="${p.instagram}" target="_blank">View ↗</a>` : '--')}
            ${infoItem('Facebook', p.facebook ? `<a href="${p.facebook}" target="_blank">View ↗</a>` : '--')}
            ${infoItem('LinkedIn', p.linkedin ? `<a href="${p.linkedin}" target="_blank">View ↗</a>` : '--')}
            ${infoItem('Founder', p.founder_name || '--')}
          </div>
        </div>

        <!-- Pipeline Status -->
        <div class="modal-section">
          <div class="modal-section-title">Pipeline</div>
          <div class="flex gap-2" style="align-items:center;flex-wrap:wrap">
            <select class="status-select" id="modal-status" onchange="updateStatus(${p.id}, this.value)">
              ${['new','contacted','replied','call_booked','won','lost'].map(s =>
                `<option value="${s}" ${p.status === s ? 'selected' : ''}>${statusLabel(s)}</option>`
              ).join('')}
            </select>
            <span style="font-size:12px;color:var(--text-muted)">Last contacted: ${formatDate(p.last_contacted)}</span>
          </div>
        </div>

        <!-- Notes -->
        <div class="modal-section">
          <div class="modal-section-title">Notes</div>
          <textarea class="form-control w-full" id="modal-notes" rows="3" placeholder="Add notes..."
            style="resize:vertical">${p.notes || ''}</textarea>
          <button class="btn btn-ghost btn-sm mt-2" onclick="saveNotes(${p.id})">Save notes</button>
        </div>

        <!-- Outreach Log -->
        <div class="modal-section">
          <div class="modal-section-title">Outreach Log</div>
          <div id="outreach-log-list">
            <p class="text-muted text-sm">Loading...</p>
          </div>
          <div class="flex gap-2 mt-2">
            <select class="status-select" id="log-channel" style="flex:1">
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram DM</option>
              <option value="facebook">Facebook DM</option>
              <option value="email">Email</option>
              <option value="call">Call</option>
              <option value="visit">Walk-in</option>
            </select>
            <select class="status-select" id="log-outcome" style="flex:1">
              <option value="">Outcome</option>
              <option value="sent">Sent</option>
              <option value="no_reply">No reply</option>
              <option value="replied">Replied</option>
              <option value="positive">Positive</option>
              <option value="not_interested">Not interested</option>
              <option value="call_booked">Call booked</option>
            </select>
            <button class="btn btn-primary btn-sm" onclick="logOutreach(${p.id})">+ Log</button>
          </div>
        </div>

        <!-- Danger zone -->
        <div class="modal-section">
          <button class="btn btn-ghost btn-sm" onclick="reEnrich(${p.id})" style="margin-right:8px">🔄 Re-run audit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--hot)" onclick="deleteProspect(${p.id})">🗑 Delete</button>
        </div>

      </div>
    </div>
  `;

  // Load outreach log
  api.outreach.getLog(p.id).then(logs => {
    const el = document.getElementById('outreach-log-list');
    if (!el) return;
    if (!logs.length) { el.innerHTML = '<p class="text-muted text-sm">No outreach logged yet.</p>'; return; }
    el.innerHTML = logs.map(l => `
      <div class="log-entry">
        <div class="log-channel ${channelClass(l.channel)}">${channelIcon(l.channel)}</div>
        <div class="log-body">
          <div><strong>${l.channel}</strong>${l.template_used ? ' — ' + l.template_used : ''}${l.outcome ? ' <em>(' + l.outcome + ')</em>' : ''}</div>
          <div class="log-meta">${formatDate(l.timestamp)}</div>
        </div>
      </div>`).join('');
  });
}

function infoItem(label, value) {
  return `<div class="info-item"><div class="info-label">${label}</div><div class="info-value">${value}</div></div>`;
}

function shortUrl(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function buildActionButtons(p, weaknesses, sender) {
  const opening = p.opening_line || 'Hi, I wanted to reach out about your business.';
  const firstName = p.founder_name ? p.founder_name.split(' ')[0] : 'there';
  const senderName = sender.sender_first_name || 'Tino';
  const weakness = weaknesses[0]?.opener_fragment || 'a few things I noticed online';

  const buttons = [];
  const recommended = p.recommended_channel;

  const buildBtn = (ch, icon, label, sublabel, href, isRecommended) => {
    const cls = isRecommended ? 'action-btn primary-action' : 'action-btn';
    const tag = isRecommended ? '<span class="recommended-tag">BEST WAY IN</span>' : '';
    return `<a class="${cls} ${channelClass(ch)}" href="${href || '#'}" ${href && href !== '#' ? 'target="_blank"' : ''}
      onclick="${href ? `logChannelTap(${p.id},'${ch}')` : 'return false'}">
      <span class="action-icon">${icon}</span>
      <span class="action-label">${label}<small>${sublabel}</small></span>
      ${tag}
    </a>`;
  };

  // Build message
  const waMsg = `Hey ${firstName}! Saw ${p.business_name} online and noticed ${weakness}. Are you working on that right now?`;
  const emailSubject = `Quick question about ${p.business_name}'s online presence`;
  const emailBody = `Hi ${firstName},\n\nI came across ${p.business_name} recently and noticed ${weakness}. I help businesses like yours fix this fast.\n\nWorth a quick chat?\n\n${senderName}\nStudio X Marketing\nstudioxmarketing.com`;

  const actions = [];

  // WhatsApp
  const waNum = p.whatsapp || p.phone;
  if (waNum) {
    const href = waLink(waNum, waMsg);
    actions.push({ ch: 'whatsapp', icon: '💬', label: 'WhatsApp', sub: waNum, href,
      btn: buildBtn('whatsapp', '💬', 'WhatsApp', waNum, href, recommended === 'whatsapp') });
  }

  // Instagram
  if (p.instagram) {
    actions.push({ ch: 'instagram', icon: '📸', label: 'Instagram DM', sub: shortUrl(p.instagram) || 'View',
      href: p.instagram,
      btn: buildBtn('instagram', '📸', 'Instagram DM', 'Open profile', p.instagram, recommended === 'instagram') });
  }

  // Facebook
  if (p.facebook) {
    actions.push({ ch: 'facebook', icon: '👍', label: 'Facebook DM', sub: 'Open page',
      href: p.facebook,
      btn: buildBtn('facebook', '👍', 'Facebook DM', 'Open page', p.facebook, recommended === 'facebook') });
  }

  // Email
  if (p.email) {
    const mailHref = `mailto:${p.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
    actions.push({ ch: 'email', icon: '✉️', label: 'Email', sub: p.email,
      href: mailHref,
      btn: buildBtn('email', '✉️', 'Email', p.email, mailHref, recommended === 'email') });
  }

  // LinkedIn
  if (p.linkedin) {
    actions.push({ ch: 'linkedin', icon: '💼', label: 'LinkedIn', sub: 'View profile',
      href: p.linkedin,
      btn: buildBtn('linkedin', '💼', 'LinkedIn', 'View profile', p.linkedin, recommended === 'linkedin') });
  }

  // Website
  if (p.website) {
    actions.push({ ch: 'website', icon: '🌐', label: 'Website', sub: shortUrl(p.website),
      href: p.website,
      btn: buildBtn('website', '🌐', 'Website', shortUrl(p.website), p.website, false) });
  }

  // Call
  if (p.phone) {
    actions.push({ ch: 'call', icon: '📞', label: 'Call', sub: p.phone,
      href: `tel:${p.phone}`,
      btn: buildBtn('call', '📞', 'Call', p.phone, `tel:${p.phone}`, recommended === 'call') });
  }

  // Sort: recommended first
  actions.sort((a, b) => {
    if (a.ch === recommended) return -1;
    if (b.ch === recommended) return 1;
    return 0;
  });

  if (!actions.length) {
    return '<p class="text-muted text-sm">No contact info found. Add details above or re-run audit.</p>';
  }

  // Add message editor after the first/recommended button
  const firstAction = actions[0];
  let msgEditorHtml = '';
  if (['whatsapp', 'email', 'instagram', 'facebook'].includes(firstAction?.ch)) {
    const defaultMsg = firstAction.ch === 'email'
      ? emailBody
      : waMsg;
    msgEditorHtml = `
      <div class="msg-editor">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.8px">Edit message before sending</div>
        <textarea id="prefill-msg">${defaultMsg}</textarea>
        <div class="msg-editor-footer">
          <button class="btn btn-copy" onclick="copyToClipboard(document.getElementById('prefill-msg').value)">📋 Copy message</button>
        </div>
      </div>`;
  }

  return actions.map(a => a.btn).join('') + msgEditorHtml;
}

async function updateStatus(id, status) {
  try {
    await api.prospects.update(id, { status });
    toast(`Status updated to ${statusLabel(status)}`, 'success');
    if (window.refreshCurrentView) window.refreshCurrentView();
  } catch (e) { toast('Failed to update status', 'error'); }
}

async function saveNotes(id) {
  const notes = document.getElementById('modal-notes').value;
  try {
    await api.prospects.update(id, { notes });
    toast('Notes saved', 'success');
  } catch { toast('Failed to save notes', 'error'); }
}

async function logOutreach(prospectId) {
  const channel = document.getElementById('log-channel').value;
  const outcome = document.getElementById('log-outcome').value;
  try {
    await api.outreach.log({ prospect_id: prospectId, channel, outcome });
    toast('Outreach logged', 'success');
    // Reload log section
    openProspect(prospectId);
  } catch { toast('Failed to log outreach', 'error'); }
}

function logChannelTap(prospectId, channel) {
  // Fire and forget — log the tap
  api.outreach.log({ prospect_id: prospectId, channel, outcome: 'sent' }).catch(() => {});
}

async function reEnrich(id) {
  try {
    await api.prospects.reEnrich(id);
    toast('Audit started — refresh in a moment', 'info');
    setTimeout(() => openProspect(id), 4000);
  } catch { toast('Failed to start audit', 'error'); }
}

async function deleteProspect(id) {
  if (!confirm('Delete this prospect? This cannot be undone.')) return;
  try {
    await api.prospects.delete(id);
    toast('Prospect deleted', 'success');
    closeModal();
    if (window.refreshCurrentView) window.refreshCurrentView();
  } catch { toast('Failed to delete', 'error'); }
}

// Click outside to close
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
});
