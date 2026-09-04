/* API client — thin fetch wrapper */
const BASE = '';

async function apiFetch(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return res.json();
}

const api = {
  prospects: {
    list: (params = {}) => {
      const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ''))
      ).toString();
      return apiFetch(`/api/prospects${qs ? '?' + qs : ''}`);
    },
    get: (id) => apiFetch(`/api/prospects/${id}`),
    create: (data) => apiFetch('/api/prospects', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiFetch(`/api/prospects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id) => apiFetch(`/api/prospects/${id}`, { method: 'DELETE' }),
    stats: () => apiFetch('/api/prospects/stats'),
    mapPins: () => apiFetch('/api/prospects/map-pins'),
    reEnrich: (id) => apiFetch(`/api/prospects/${id}/re-enrich`, { method: 'POST' }),
    importCsv: (file) => {
      const fd = new FormData();
      fd.append('file', file);
      return fetch('/api/prospects/import/csv', { method: 'POST', body: fd }).then(r => r.json());
    },
  },
  discovery: {
    run: (data) => apiFetch('/api/discovery', { method: 'POST', body: JSON.stringify(data) }),
    progress: () => apiFetch('/api/discovery/progress'),
    apiStatus: () => apiFetch('/api/discovery/api-status'),
  },
  outreach: {
    library: () => apiFetch('/api/outreach/library'),
    log: (data) => apiFetch('/api/outreach/log', { method: 'POST', body: JSON.stringify(data) }),
    getLog: (prospectId) => apiFetch(`/api/outreach/log/${prospectId}`),
  },
  settings: {
    get: () => apiFetch('/api/settings'),
    update: (data) => apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(data) }),
    niches: () => apiFetch('/api/settings/niches'),
    googleMapsKey: () => apiFetch('/api/settings/google-maps-key'),
  },
};
