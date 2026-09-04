/* Shared utilities */

function toast(msg, type = 'info', duration = 3500) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type] || icons.info}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

function channelIcon(ch) {
  const icons = {
    whatsapp: '💬', instagram: '📸', facebook: '👍', email: '✉️',
    linkedin: '💼', call: '📞', visit: '🚶', sms: '📱',
  };
  return icons[ch] || '📬';
}

function channelClass(ch) {
  const m = { whatsapp: 'ch-whatsapp', instagram: 'ch-instagram', facebook: 'ch-facebook',
               email: 'ch-email', linkedin: 'ch-linkedin', call: 'ch-call', visit: 'ch-visit' };
  return m[ch] || '';
}

function scoreBadge(score) {
  return `<span class="badge badge-${score}"><span class="badge-dot"></span>${score}</span>`;
}

function formatDate(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleDateString('en-ZW', { day: 'numeric', month: 'short', year: '2-digit' });
}

function formatRating(rating, count) {
  if (!rating) return '--';
  return `<span class="rating">★ ${rating.toFixed(1)} (${count || 0})</span>`;
}

function normalizePhone(phone) {
  if (!phone) return null;
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0') && d.length >= 10) d = '263' + d.slice(1);
  if (!d.startsWith('263')) d = '263' + d;
  return d;
}

function waLink(phone, message) {
  const num = normalizePhone(phone);
  if (!num) return null;
  const text = encodeURIComponent(message || '');
  return `https://wa.me/${num}${text ? '?text=' + text : ''}`;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => toast('Copied to clipboard', 'success'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('Copied to clipboard', 'success');
    });
}

function mergeTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] || `{${k}}`);
}

function statusLabel(s) {
  const m = {
    new: 'New', contacted: 'Contacted', replied: 'Replied',
    call_booked: 'Call Booked', won: 'Won', lost: 'Lost',
  };
  return m[s] || s;
}

function statusColor(s) {
  const m = {
    new: '#9333ea', contacted: '#ff9500', replied: '#39ff14',
    call_booked: '#ffd700', won: '#00ff88', lost: '#ff3b3b',
  };
  return m[s] || '#888';
}

function getWeaknesses(p) {
  try { return JSON.parse(p.weaknesses || '[]'); } catch { return []; }
}

// Debounce helper
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
