/* Google Maps view */

let _map = null;
let _markers = [];
let _mapInitialized = false;

const SCORE_COLORS = {
  HOT: '#ff3b3b',
  WARM: '#ff9500',
  COLD: '#60a5fa',
};

async function loadMapView() {
  const el = document.getElementById('view-map');

  el.innerHTML = `
    <div class="map-topbar">
      <span style="font-weight:600">Map</span>
      <select class="form-control" id="map-filter-score" onchange="refreshMapPins()" style="padding:6px 10px;min-width:120px">
        <option value="">All scores</option>
        <option value="HOT">🔥 HOT</option>
        <option value="WARM">🌡 WARM</option>
        <option value="COLD">❄ COLD</option>
      </select>
      <button class="btn btn-ghost btn-sm" onclick="refreshMapPins()">↻ Refresh</button>
    </div>
    <div id="map-container">
      <div id="google-map"></div>
      <div id="map-legend">
        <div style="font-weight:700;font-size:11px;margin-bottom:6px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px">Score</div>
        <div class="legend-item"><div class="legend-dot" style="background:#ff3b3b"></div>HOT</div>
        <div class="legend-item"><div class="legend-dot" style="background:#ff9500"></div>WARM</div>
        <div class="legend-item"><div class="legend-dot" style="background:#60a5fa"></div>COLD</div>
      </div>
      <div id="map-no-key" class="map-no-key hidden">
        <div style="font-size:48px">🗺</div>
        <h3>Map view requires a Google Maps API key</h3>
        <p class="text-muted" style="max-width:400px;margin-top:8px">
          Add <code>GOOGLE_MAPS_API_KEY</code> to your <code>.env</code> file and restart the server.
          <a href="https://console.cloud.google.com/" target="_blank" style="color:var(--neon-green)">Get a key →</a>
        </p>
      </div>
    </div>
  `;

  const { key } = await api.settings.googleMapsKey();

  if (!key) {
    document.getElementById('map-no-key').classList.remove('hidden');
    document.getElementById('google-map').style.display = 'none';
    return;
  }

  if (!_mapInitialized) {
    await loadGoogleMapsScript(key);
    initMap();
    _mapInitialized = true;
  }
  await refreshMapPins();
}

function loadGoogleMapsScript(key) {
  return new Promise((resolve) => {
    if (window.google && window.google.maps) { resolve(); return; }
    window._mapReady = resolve;
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&callback=_mapReady`;
    s.async = true;
    document.head.appendChild(s);
  });
}

function initMap() {
  _map = new google.maps.Map(document.getElementById('google-map'), {
    center: { lat: -17.8292, lng: 31.0522 }, // Harare
    zoom: 12,
    styles: darkMapStyle(),
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });
}

async function refreshMapPins() {
  if (!_map) return;
  const scoreFilter = document.getElementById('map-filter-score')?.value || '';

  // Clear old markers
  _markers.forEach(m => m.setMap(null));
  _markers = [];

  try {
    let pins = await api.prospects.mapPins();
    if (scoreFilter) pins = pins.filter(p => p.score === scoreFilter);

    pins.forEach(p => {
      const color = SCORE_COLORS[p.score] || '#888';
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: _map,
        title: p.business_name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: color,
          fillOpacity: 0.9,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
      });

      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="background:#160020;color:#f0e6ff;padding:12px;border-radius:8px;min-width:180px;font-family:Inter,sans-serif">
            <div style="font-weight:700;margin-bottom:4px">${p.business_name}</div>
            <div style="font-size:12px;color:#a78bcf;margin-bottom:8px">${p.niche}</div>
            <span style="background:${color}22;color:${color};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700">${p.score}</span>
            <div style="margin-top:10px">
              <a onclick="openProspect(${p.id})" href="#" style="color:#39ff14;font-size:13px;font-weight:600">Open card →</a>
            </div>
          </div>`,
      });

      marker.addListener('click', () => {
        infoWindow.open(_map, marker);
      });

      _markers.push(marker);
    });
  } catch (e) { toast('Failed to load map pins', 'error'); }
}

function darkMapStyle() {
  return [
    { elementType: 'geometry', stylers: [{ color: '#0d0015' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#a78bcf' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0d0015' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1e002e' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#2a0040' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2a0040' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#060010' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#160020' }] },
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#1e002e' }] },
    { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#3d1060' }] },
    { featureType: 'administrative.land_parcel', elementType: 'labels.text.fill', stylers: [{ color: '#6b4f8a' }] },
  ];
}
