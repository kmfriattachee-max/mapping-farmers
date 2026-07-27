const KEGATI_COORDS = [-0.70875, 34.82152];
let map = null;
let tileLayer = null;
// Satellite / imagery basemap (Esri World Imagery)
let satelliteTileLayer = null;
let currentBase = null;
let miniMap = null;
console.log('app.js loaded');

// Initialize Leaflet map if available; guard so missing/failed Leaflet doesn't stop the rest of the script
try {
  if (typeof L !== 'undefined' && document.getElementById('map')) {
    map = L.map('map').setView(KEGATI_COORDS, 12);
    tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    satelliteTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
    currentBase = tileLayer;
  } else {
    console.warn('Leaflet not available or #map element missing; map features will be disabled until Leaflet loads.');
  }
} catch (e) {
  console.error('Leaflet initialization failed:', e);
  map = null; tileLayer = null; satelliteTileLayer = null; currentBase = null;
}

// Global error banner + handlers to capture runtime errors for easier debugging
function ensureErrorBanner() {
  if (document.getElementById('app-error-banner')) return;
  const el = document.createElement('div');
  el.id = 'app-error-banner';
  el.style.position = 'fixed';
  el.style.left = '12px';
  el.style.right = '12px';
  el.style.bottom = '12px';
  el.style.zIndex = 99999;
  el.style.background = 'linear-gradient(90deg,#b00020,#ff5a67)';
  el.style.color = '#fff';
  el.style.padding = '12px 14px';
  el.style.borderRadius = '10px';
  el.style.boxShadow = '0 12px 36px rgba(0,0,0,0.36)';
  el.style.display = 'none';
  el.style.fontWeight = '700';
  el.style.maxWidth = 'calc(100% - 24px)';
  el.style.pointerEvents = 'auto';
  el.addEventListener('click', () => { el.style.display = 'none'; });
  document.body.appendChild(el);
}

function showErrorBanner(message) {
  try {
    ensureErrorBanner();
    const el = document.getElementById('app-error-banner');
    if (!el) return;
    el.textContent = String(message).slice(0, 1000) + (String(message).length > 1000 ? '…' : '');
    el.style.display = 'block';
    console.error('App error captured:', message);
  } catch (e) { console.error('showErrorBanner failed', e); }
}

window.addEventListener('error', function (ev) {
  try {
    const msg = ev && ev.message ? (ev.message + ' (' + ev.filename + ':' + ev.lineno + ':' + ev.colno + ')') : String(ev);
    showErrorBanner(msg);
  } catch (e) { console.error('window.error handler failed', e); }
});

window.addEventListener('unhandledrejection', function (ev) {
  try {
    const reason = ev && ev.reason ? (ev.reason.stack || ev.reason.message || String(ev.reason)) : 'Unhandled promise rejection';
    showErrorBanner('UnhandledRejection: ' + reason);
  } catch (e) { console.error('unhandledrejection handler failed', e); }
});

// API base — use same origin in production so Render and static deployments work
const API_BASE = window.location.origin && window.location.origin !== 'null' ? window.location.origin : '';
function apiUrl(path) {
  if (!path) return API_BASE;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('/')) return API_BASE + path;
  return API_BASE + '/' + path;
}

// Shared reverse geocoding helper (Nominatim)
async function reverseGeocode(latf, lngf) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latf)}&lon=${encodeURIComponent(lngf)}&addressdetails=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.display_name) return data.display_name;
    if (data.address) return Object.values(data.address).join(', ');
    return null;
  } catch (err) {
    return null;
  }
}

// GeoJSON cache for local feature lookups
const geojsonCache = {};

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000; // meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

async function loadGeoJsonIfNeeded(name) {
  if (geojsonCache[name]) return geojsonCache[name];
    const src = layerSources[name]; 
  if (!src) return null;
  try {
    const r = await fetch(src);
    if (!r.ok) return null;
    const geo = await r.json();
    geojsonCache[name] = geo;
    return geo;
  } catch (e) { return null; }
}

function createMarkerClusterGroup(options = {}) {
  if (typeof L.markerClusterGroup === 'function') {
    return L.markerClusterGroup(Object.assign({
      showCoverageOnHover: false,
      maxClusterRadius: 48,
      zoomToBoundsOnClick: true,
      spiderfyOnMaxZoom: true,
      chunkedLoading: true
    }, options));
  }
  return L.layerGroup();
}

function featureDistanceMeters(feature, lat, lng) {
  try {
    const geom = feature.geometry;
    if (!geom) return Infinity;
    if (geom.type === 'Point') {
      const [lon, latf] = geom.coordinates;
      return getDistanceMeters(lat, lng, latf, lon);
    }
    // For LineString or Polygon, approximate by checking vertex distances
    let coords = [];
    if (geom.type === 'LineString') coords = geom.coordinates;
    else if (geom.type === 'Polygon') coords = geom.coordinates[0] || [];
    let min = Infinity;
    for (const c of coords) {
      const [clon, clat] = c;
      const d = getDistanceMeters(lat, lng, clat, clon);
      if (d < min) min = d;
    }
    return min;
  } catch (e) { return Infinity; }
}

async function findNearbyFeatures(lat, lng, radiusMeters = 500) {
  const results = {};
    const names = Object.keys(layerSources || {}); 
  for (const name of names) {
    const geo = await loadGeoJsonIfNeeded(name);
    if (!geo || !Array.isArray(geo.features)) continue;
    const nearby = [];
    for (const f of geo.features) {
      const d = featureDistanceMeters(f, lat, lng);
      if (d <= radiusMeters) {
        nearby.push({ properties: f.properties || {}, distance: Math.round(d), geometryType: f.geometry && f.geometry.type });
      }
    }
    if (nearby.length) {
      // sort by distance
      nearby.sort((a,b) => a.distance - b.distance);
      results[name] = nearby;
    }
  }
  return results;
}

function showPlacePopupOn(mapInstance, latlng, placeName, nearby) {
  const lat = (latlng.lat || latlng[0]).toFixed ? latlng.lat.toFixed(6) : String(latlng[1] || '').slice(0, 12);
  const lng = (latlng.lng || latlng[1]).toFixed ? latlng.lng.toFixed(6) : String(latlng[0] || '').slice(0, 12);
  let popupHtml = placeName
    ? `<strong>${placeName}</strong><br><small>Lat: ${lat} · Lng: ${lng}</small>`
    : `<strong>Coordinates</strong><br>Lat: ${lat}<br>Lng: ${lng}`;
  if (nearby && Object.keys(nearby).length) {
    popupHtml += '<hr style="margin:8px 0;">';
    popupHtml += '<div style="max-height:220px;overflow:auto;font-size:0.92rem">';
    for (const layerName of Object.keys(nearby)) {
      popupHtml += `<div style="margin-bottom:6px;"><strong>${layerName.replace(/_/g,' ')}</strong><ul style="margin:6px 0 8px 18px;padding:0;">`;
      nearby[layerName].slice(0,6).forEach(item => {
        const label = item.properties && (item.properties.name || item.properties.title || item.properties.farm_name) ? (item.properties.name || item.properties.title || item.properties.farm_name) : '(unnamed)';
        popupHtml += `<li>${label} — ${item.distance} m</li>`;
      });
      popupHtml += '</ul></div>';
    }
    popupHtml += '</div>';
  }
  try { L.popup({ maxWidth: 360 }).setLatLng(latlng).setContent(popupHtml).openOn(mapInstance); } catch (e) { console.warn('popup failed', e); }
}

function initMiniMapPreview() {
  const el = document.getElementById('mini-map');
  if (!el) return;
  try {
    // allow interaction on the mini map
    miniMap = L.map(el, {
      attributionControl: false,
      zoomControl: true,
      dragging: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      boxZoom: true,
      tap: true
    }).setView(KEGATI_COORDS, 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(miniMap);

    const previewGroup = L.layerGroup().addTo(miniMap);
    const previewLayers = {};
    const previewNames = ['farmers', 'rivers', 'water_sources', 'markets', 'hatcheries', 'equipment_suppliers'];

    // load available preview layers (fetch geojson sources)
    previewNames.forEach((name) => {
      const src = layerSources[name];
      if (!src) return;
      fetch(src).then(r => r.json()).then(geo => {
        const layer = L.geoJSON(geo, {
          pointToLayer: function(feature, latlng) {
            if (name === 'farmers') return L.circleMarker(latlng, { radius: 6, fillColor: '#22c55e', color: '#fff', weight: 1, fillOpacity: 0.95 });
            return L.circleMarker(latlng, { radius: 5, fillColor: styleForLayer(name).color || '#1976d2', color: '#fff', weight: 1, fillOpacity: 0.9 });
          },
          style: function() { return styleForLayer(name); },
          onEachFeature: function(feature, layerItem) {
            try { layerItem.bindPopup(getLayerPopup(name, feature.properties || {})); } catch (e) {}
          }
        });
        previewLayers[name] = layer;
        // add to preview only if the corresponding main layer is visible
        try {
          if (gisLayers[name] && map.hasLayer(gisLayers[name])) previewGroup.addLayer(layer);
        } catch (e) {
          previewGroup.addLayer(layer);
        }
      }).catch(() => {});
    });

    function syncMiniLayers() {
      previewGroup.clearLayers();
      previewNames.forEach((n) => {
        if (previewLayers[n]) {
          try {
            if (gisLayers[n] && map.hasLayer(gisLayers[n])) {
              previewGroup.addLayer(previewLayers[n]);
            }
          } catch (e) {
            // if main map not ready, just add
            previewGroup.addLayer(previewLayers[n]);
          }
        }
      });
      // adjust bounds if there are layers
      try {
        if (previewGroup.getLayers().length) miniMap.fitBounds(previewGroup.getBounds(), { padding: [6,6] });
      } catch (err) {
        console.error('MiniMap bounds error:', err);
        const tbody = document.getElementById('admin-farmers-tbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="padding: 20px; text-align: center; color: red;">Error loading farmers</td></tr>`;
      }
    }

    // clicking a feature in preview recenters the main map
    previewGroup.on('click', function(e) {
      const latlng = e.layer && e.layer.getLatLng ? e.layer.getLatLng() : null;
      if (latlng) map.setView(latlng, 13);
    });

    // clicking the mini-map sets the main map view and shows place/coords + nearby features
    miniMap.on('click', async function(e) {
      try {
        if (e && e.latlng) {
          map.setView(e.latlng, map.getZoom());
          const name = await reverseGeocode(e.latlng.lat, e.latlng.lng);
          const nearby = await findNearbyFeatures(e.latlng.lat, e.latlng.lng, 500);
          showPlacePopupOn(miniMap, e.latlng, name, nearby);
        }
      } catch (err) { console.warn('miniMap click failed', err); }
    });

  } catch (e) {
    console.warn('Mini map initialization failed', e);
  }
}

const farmerList = document.getElementById('farmer-list');
const form = document.getElementById('farmer-form');
const status = document.getElementById('status');
const countyFilter = document.getElementById('county-filter');
const speciesFilter = document.getElementById('species-filter');
const cultureFilter = document.getElementById('culture-filter');
const scaleFilter = document.getElementById('scale-filter');
const statusFilter = document.getElementById('status-filter');
const dateFilter = document.getElementById('date-filter');
const searchFilter = document.getElementById('search-filter');
const supplierCategoryFilter = document.getElementById('supplier-category-filter');
const supplierSpeciesFilter = document.getElementById('supplier-species-filter');
const supplierCountyFilter = document.getElementById('supplier-county-filter');
const supplierPriceFilter = document.getElementById('supplier-price-filter');
const supplierDistanceFilter = document.getElementById('supplier-distance-filter');
const supplierSearchFilter = document.getElementById('supplier-search-filter');
const supplierList = document.getElementById('supplier-list');
const supplierRefreshBtn = document.getElementById('supplier-refresh');
const supplierNearbyBtn = document.getElementById('supplier-nearby-btn');
const supplierNearbyStatus = document.getElementById('supplier-nearby-status');
const clearFilter = document.getElementById('clear-filter');
const exportData = document.getElementById('export-data');
const latitudeInput = document.getElementById('latitude');
const longitudeInput = document.getElementById('longitude');
const locationSource = document.getElementById('location-source');
const detailContent = document.getElementById('detail-content');

let supplierCache = [];
const supplierLayer = createMarkerClusterGroup({ chunkedLoading: true });
let currentFarmerLocation = null;
const adminUsernameInput = document.getElementById('admin-username');
const adminPasswordInput = document.getElementById('admin-password');
const adminLoginBtn = document.getElementById('admin-login');
const adminLogoutBtn = document.getElementById('admin-logout');
const adminStatus = document.getElementById('admin-status');

// Password visibility toggle for admin login
const adminShowPasswordCheckbox = document.getElementById('admin-show-password');
if (adminShowPasswordCheckbox) {
  adminShowPasswordCheckbox.addEventListener('change', () => {
    try {
      adminPasswordInput.type = adminShowPasswordCheckbox.checked ? 'text' : 'password';
    } catch (e) { console.warn('toggle password visibility failed', e); }
  });
}

// Simple tab switching for CTAs and landing buttons
const tabNav = document.querySelector('.tab-nav');
const tabContent = document.querySelector('.tab-content');
function openTab(targetId) {
  if (!tabNav || !tabContent) return;
  // show nav and content
  tabNav.classList.remove('hidden');
  tabContent.classList.remove('hidden');
  // activate tab button
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.target === targetId);
  });
  // show panel
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(targetId);
  if (panel) panel.classList.add('active');
  // show small toast feedback with the panel title
  try {
    const heading = panel ? (panel.querySelector('h2, h3, h4, h1') || {}).textContent : null;
    const title = heading || targetId;
    showToast(`Opened: ${title}`);
  } catch (e) {}
  // ensure map resizes when opening map
  if (targetId === 'map-tab') {
    setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 300);
  }
  // scroll to top of app area
  setTimeout(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, 50);
}

// Backwards-compatibility wrapper used in some older listeners
function showApp(targetId) {
  openTab(targetId);
}

// On page load, support opening a tab via ?open=map-tab or ?open=map
try {
  const params = new URLSearchParams(location.search);
  const open = params.get('open');
  if (open) {
    // map and map-tab both accepted
    const target = open === 'map' ? 'map-tab' : open;
    // delay until UI initialised
    setTimeout(() => { try { openTab(target); } catch (e) {} }, 250);
  }
} catch (e) {}

// Support opening tab via hash (e.g. #map or #map-tab) and respond to hash changes
function hashToTarget(h) {
  if (!h) return null;
  const cleaned = h.replace(/^#/, '');
  if (!cleaned) return null;
  return cleaned.endsWith('-tab') ? cleaned : `${cleaned}-tab`;
}
try {
  const h = location.hash;
  const targetFromHash = hashToTarget(h);
  if (targetFromHash) setTimeout(() => { try { openTab(targetFromHash); } catch (e) {} }, 250);
  window.addEventListener('hashchange', () => {
    const t = hashToTarget(location.hash);
    if (t) openTab(t);
  });
} catch (e) {}

// Toast element and helper
const _toast = document.createElement('div');
_toast.className = 'app-toast';
document.body.appendChild(_toast);
let _toastTimer = null;
function showToast(msg, ms = 2200) {
  _toast.textContent = msg;
  _toast.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { _toast.classList.remove('show'); _toastTimer = null; }, ms);
}

// CTA listeners are consolidated later (showApp/openTab wiring)

// Robust tab wiring: log buttons, attach direct listeners and delegation
try {
  const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
  console.log('Tab buttons found:', tabButtons.length, tabButtons.map(b => b.dataset.target || b.getAttribute('data-target')));
  tabButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = btn.dataset.target || btn.getAttribute('data-target');
      console.log('tab-button clicked', target, btn);
      try { if (target) openTab(target); else console.warn('tab clicked but no target', btn); } catch (err) { console.error('openTab failed', err); }
    });
  });

  const nav = document.querySelector('.tab-nav');
  if (nav) {
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-button');
      if (!btn) return;
      const target = btn.dataset.target || btn.getAttribute('data-target');
      console.log('tab-nav delegated click', target, btn);
      try { if (target) openTab(target); } catch (err) { console.error('delegated openTab failed', err); }
    });
    console.log('Tab delegation attached');
  }
} catch (err) {
  console.error('Tab wiring initialization failed', err);
}

// If no tab is active on load, open the default map tab
try {
  const anyActive = document.querySelector('.tab-panel.active');
  if (!anyActive) {
    setTimeout(() => { try { openTab('map-tab'); } catch (e) {} }, 300);
  }
} catch (e) {}

let farmersCache = [];
let selectedFarmerId = null;
const markerGroup = createMarkerClusterGroup({ chunkedLoading: true });

// --- Additional GIS layers ---
const gisLayers = {
  farmers: markerGroup,
  density: L.layerGroup(),
  water_sources: L.layerGroup(),
  rivers: L.layerGroup(),
  river_buffers: L.layerGroup(),
  markets: L.layerGroup(),
  hatcheries: L.layerGroup(),
  feed_suppliers: L.layerGroup(),
  equipment_suppliers: L.layerGroup(),
  roads: L.layerGroup(),
  footprints: L.layerGroup(),
  suppliers: supplierLayer
};

const layerSources = {
  farmers: '/data/farmers.geojson',
  water_sources: '/data/water_sources.geojson',
  rivers: '/data/rivers.geojson',
  markets: '/data/markets.geojson',
  hatcheries: '/data/hatcheries.geojson',
  feed_suppliers: '/data/feed_suppliers.geojson',
  equipment_suppliers: '/data/equipment_suppliers.geojson',
  roads: '/data/roads.geojson',
  footprints: '/data/farmers.geojson'
};

// Load footprint polygons (Polygon / MultiPolygon) from a GeoJSON source and render them
async function loadFootprintsLayer() {
  try {
    gisLayers.footprints.clearLayers();
    const src = layerSources['footprints'];
    if (!src) return;
    const res = await fetch(src);
    if (!res.ok) return;
    const geo = await res.json();
    // filter polygons only
    const polyFeatures = { type: 'FeatureCollection', features: (geo.features || []).filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) };
    if (!polyFeatures.features.length) return;
    const layer = L.geoJSON(polyFeatures, {
      style: () => ({ color: '#8B4513', weight: 1, fillColor: '#d6a96a', fillOpacity: 0.45 }),
      onEachFeature: function(feature, layerItem) {
        try {
          const props = feature.properties || {};
          layerItem.bindPopup(`<strong>${props.name || props.farm_name || 'Footprint'}</strong><br>${props.owner || ''}`);
        } catch (e) {}
      }
    });
    gisLayers.footprints.addLayer(layer);
  } catch (e) {
    console.error('Error loading footprints', e);
  }
}

const cultureSystemColors = {
  Pond: '#22c55e',
  Tank: '#2563eb',
  Cage: '#8b5cf6',
  'Recirculating system': '#f59e0b',
  default: '#38bdf8'
};

function styleForLayer(layerName) {
  switch (layerName) {
    case 'rivers': return { color: '#1E90FF', weight: 3 };
    case 'roads': return { color: '#6b7280', weight: 2, dashArray: '6 6' };
    case 'markets': return { color: '#ff7043', radius: 6 };
    case 'hatcheries': return { color: '#8e24aa', radius: 6 };
    case 'feed_suppliers': return { color: '#33a02c', radius: 6 };
    case 'equipment_suppliers': return { color: '#f97316', radius: 6 };
    case 'water_sources': return { color: '#00bcd4', radius: 6 };
    default: return { color: '#1976d2', radius: 6 };
  }
}

// Load river buffer GeoJSON from server and render
async function loadRiverBuffer(distanceMeters, options = {}) {
  try {
    gisLayers.river_buffers.clearLayers();
    const params = new URLSearchParams();
    params.set('distance', String(distanceMeters));
    if (options.bbox) params.set('bbox', options.bbox);
    if (options.dissolve) params.set('dissolve', 'true');
    const url = apiUrl(`/api/analysis/rivers/buffer?${params.toString()}`);
    const resp = await fetch(url);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || 'Unable to fetch river buffer');
    }
    const geo = await resp.json();
    const layer = L.geoJSON(geo, {
      style: () => ({ color: '#1766a0', weight: 1, fillColor: '#90cdf4', fillOpacity: 0.35 })
    });
    gisLayers.river_buffers.addLayer(layer);
    gisLayers.river_buffers.addTo(map);
    map.fitBounds(layer.getBounds());
  } catch (e) {
    console.error('Error loading river buffer', e);
    alert('River buffer failed: ' + (e.message || 'error'));
  }
}

function getLayerPopup(layerName, props) {
  const title = props.name || props.title || props.market || props.hatchery || props.supplier || props.vendor || 'Feature';
  switch (layerName) {
    case 'water_sources':
      return `
        <strong>${title}</strong><br>
        Type: ${props.type || props.source || 'Water Source'}<br>
        Status: ${props.status || 'Unknown'}
      `;
    case 'rivers':
      return `
        <strong>${title}</strong><br>
        Flow: ${props.flow_direction || 'Unknown'}<br>
        Status: ${props.status || 'Seasonal / Permanent'}
      `;
    case 'markets':
      return `
        <strong>${title}</strong><br>
        Days: ${props.operating_days || 'Varies'}<br>
        Demand: ${props.species_demanded || 'Fish'}
      `;
    case 'hatcheries':
      return `
        <strong>${title}</strong><br>
        Species: ${props.species_available || props.species || 'Not listed'}<br>
        Stock: ${props.stock_levels || 'Unknown'}<br>
        Price: ${props.price ? `KES ${props.price}` : 'N/A'}<br>
        Verified: ${props.verified ? 'Yes' : 'No'}
      `;
    case 'feed_suppliers':
      return `
        <strong>${title}</strong><br>
        Brands: ${props.feed_brands || 'Unknown'}<br>
        Availability: ${props.stock_availability || 'Unknown'}<br>
        Price: ${props.price ? `KES ${props.price}` : 'N/A'}
      `;
    case 'equipment_suppliers':
      return `
        <strong>${title}</strong><br>
        Supplies: ${props.products || 'Equipment & kits'}<br>
        Contact: ${props.phone || props.contact || 'Not provided'}<br>
        Verified: ${props.verified ? 'Yes' : 'No'}
      `;
    default:
      return `<strong>${title}</strong><br>${props.description || ''}`;
  }
}

async function loadGeoJsonLayer(name) {
  try {
    const res = await fetch(layerSources[name]);
    if (!res.ok) return;
    const geo = await res.json();
    const layer = L.geoJSON(geo, {
      style: styleForLayer(name),
      pointToLayer: function(feature, latlng) {
        if (name === 'farmers') {
          const culture = feature.properties?.culture_system || '';
          return L.circleMarker(latlng, {
            radius: 8,
            fillColor: cultureSystemColors[culture] || cultureSystemColors.default,
            color: '#1f2937',
            weight: 1.2,
            fillOpacity: 0.9
          });
        }
        const style = styleForLayer(name);
        return L.circleMarker(latlng, {
          radius: style.radius || 7,
          fillColor: style.color,
          color: '#fff',
          weight: 1,
          fillOpacity: 0.9
        });
      },
      onEachFeature: function(feature, layerItem) {
        const props = feature.properties || {};
        layerItem.bindPopup(getLayerPopup(name, props));
      }
    });
    gisLayers[name].clearLayers();
    gisLayers[name].addLayer(layer);
  } catch (err) {
    console.error('Error loading layer', name, err);
  }
}

// Layer control wiring
const layerControls = document.getElementById('layer-controls');
const showLayerControlsButton = document.getElementById('show-layer-controls');
const layerControlButtons = document.querySelectorAll('#layer-controls .layer-toggle');
layerControlButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const name = button.dataset.layer;
    const active = button.classList.toggle('active');
    if (active) {
      if (name === 'farmers') {
        if (!farmersCache.length) await loadFarmers();
        gisLayers[name].addTo(map);
      } else if (name === 'density') {
        if (!farmersCache.length) await loadFarmers();
        loadDensityHeatmap();
        gisLayers[name].addTo(map);
      } else if (name === 'suppliers') {
        if (!supplierCache.length) await loadSuppliers();
        gisLayers[name].addTo(map);
      } else if (name === 'satellite') {
        // switch to satellite base
        try {
          if (currentBase) map.removeLayer(currentBase);
          satelliteTileLayer.addTo(map);
          currentBase = satelliteTileLayer;
        } catch (e) { console.warn('Switching base failed', e); }
      } else if (name === 'footprints') {
        if (gisLayers.footprints.getLayers().length === 0) await loadFootprintsLayer();
        gisLayers.footprints.addTo(map);
      } else {
        if (gisLayers[name] && gisLayers[name].getLayers().length === 0) await loadGeoJsonLayer(name);
        gisLayers[name].addTo(map);
      }
    } else {
      if (name === 'satellite') {
        try {
          if (currentBase) map.removeLayer(currentBase);
          tileLayer.addTo(map);
          currentBase = tileLayer;
        } catch (e) { console.warn('Restoring base failed', e); }
      } else {
        try { gisLayers[name].remove(); } catch (e) {}
      }
    }
    layerControls?.classList.add('hidden');
    showLayerControlsButton?.classList.remove('hidden');
  });
});

showLayerControlsButton?.addEventListener('click', () => {
  layerControls?.classList.remove('hidden');
  showLayerControlsButton?.classList.add('hidden');
});

// River buffer controls
const riverBufferInput = document.getElementById('river-buffer-distance');
const showRiverBufferBtn = document.getElementById('show-river-buffer');
const clearRiverBufferBtn = document.getElementById('clear-river-buffer');
const limitToExtentCheckbox = document.getElementById('limit-to-extent');
const dissolveBuffersCheckbox = document.getElementById('dissolve-buffers');
if (showRiverBufferBtn) {
  showRiverBufferBtn.addEventListener('click', async () => {
    const dist = Number(riverBufferInput?.value || 100);
    if (!Number.isFinite(dist) || dist <= 0) return alert('Enter a valid distance in meters');
    const options = {};
    if (limitToExtentCheckbox?.checked) {
      const b = map.getBounds();
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      options.bbox = bbox.join(',');
    }
    if (dissolveBuffersCheckbox?.checked) options.dissolve = true;
    await loadRiverBuffer(dist, options);
  });
}
if (clearRiverBufferBtn) {
  clearRiverBufferBtn.addEventListener('click', () => {
    gisLayers.river_buffers.clearLayers();
    gisLayers.river_buffers.remove();
  });
}

// initially enable the active buttons and load static sources where needed
layerControlButtons.forEach((button) => {
  if (!button.classList.contains('active')) return;
  const name = button.dataset.layer;
  if (name === 'farmers') {
    gisLayers[name].addTo(map);
    if (!farmersCache.length) {
      loadFarmers();
    }
    return;
  }
  if (name === 'density') {
    // Density is off by default
    return;
  }
  if (name === 'suppliers') {
    gisLayers[name].addTo(map);
    if (!supplierCache.length) loadSuppliers();
    return;
  }
  if (name === 'satellite') {
    try { if (currentBase) map.removeLayer(currentBase); satelliteTileLayer.addTo(map); currentBase = satelliteTileLayer; } catch (e) {}
    return;
  }
  if (name === 'footprints') {
    loadFootprintsLayer().then(() => { try { gisLayers.footprints.addTo(map); } catch (e) {} });
    return;
  }
  if (gisLayers[name].getLayers().length === 0) {
    loadGeoJsonLayer(name);
  }
  gisLayers[name].addTo(map);
});

let adminToken = localStorage.getItem('adminToken') || '';
let currentRole = 'public';

function parseJwt(token) {
  try {
    const p = token.split('.')[1];
    if (!p) return null;
    const json = atob(p.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch (e) { return null; }
}

function applyRole(role) {
  try {
    currentRole = role || 'public';
    // nav & side links
    document.querySelectorAll('.side-link, .tab-button').forEach(el => {
      const target = el.dataset.target || el.getAttribute('href') || el.getAttribute('data-target') || '';
      // hide admin tab for non-admins
      if (String(target).includes('admin') && currentRole !== 'admin') {
        el.style.display = 'none';
      } else {
        el.style.display = '';
      }
      // hide farmer-dashboard for non-farmers
      if (String(target).includes('farmer-dashboard') && currentRole !== 'farmer') {
        el.style.display = 'none';
      }
    });

    // Layer controls: define allowed per role
    const allowed = {
      admin: ['farmers','rivers','water_sources','markets','hatcheries','feed_suppliers','equipment_suppliers','roads','footprints','suppliers','density','satellite'],
      officer: ['farmers','rivers','water_sources','markets','hatcheries','feed_suppliers','equipment_suppliers','roads','footprints'],
      farmer: ['farmers','hatcheries','markets','water_sources','equipment_suppliers','satellite'],
      public: ['farmers','markets','hatcheries','water_sources','equipment_suppliers']
    };
    const allow = allowed[currentRole] || allowed.public;
    document.querySelectorAll('#layer-controls .layer-toggle').forEach(btn => {
      const name = btn.dataset.layer;
      if (!name) return;
      if (allow.includes(name)) btn.style.display = '';
      else btn.style.display = 'none';
    });

    // Admin dashboard visibility
    try {
      const adminSection = document.getElementById('admin-dashboard-section');
      const adminLoginSection = document.getElementById('admin-login-section');
      if (adminSection && adminLoginSection) {
        if (currentRole === 'admin') {
          adminLoginSection.classList.add('hidden');
          adminSection.classList.remove('hidden');
        } else {
          adminSection.classList.add('hidden');
          adminLoginSection.classList.remove('hidden');
        }
      }
    } catch (e) {}
  } catch (e) { console.warn('applyRole failed', e); }
}

function authHeaders(additional = {}) {
  const h = Object.assign({}, additional || {});
  if (adminToken) h['Authorization'] = `Bearer ${adminToken}`;
  return h;
}

function setAdminToken(token) {
  adminToken = token || '';
  if (adminToken) {
    localStorage.setItem('adminToken', adminToken);
    if (adminStatus) adminStatus.textContent = 'Authenticated as admin';
    // parse token to ensure role and apply
    const p = parseJwt(adminToken);
    if (p && p.role === 'admin') applyRole('admin');
  } else {
    localStorage.removeItem('adminToken');
    if (adminStatus) adminStatus.textContent = 'Not authenticated';
    // revert to public or farmer if available
    const ftoken = localStorage.getItem('farmerToken');
    if (ftoken) applyRole('farmer'); else applyRole('public');
  }
  updateFarmersView();
}

// --- Draw-to-select-extent support (Leaflet.draw) ---
let drawnExtent = null; // bbox string minX,minY,maxX,maxY
function setupDrawControl() {
  if (typeof L.Draw === 'undefined') return;
  const drawFeatureGroup = L.featureGroup().addTo(map);
  const drawControl = new L.Control.Draw({
    edit: { featureGroup: drawFeatureGroup, edit: false, remove: true },
    draw: {
      polygon: false,
      polyline: false,
      circle: false,
      marker: false,
      circlemarker: false,
      rectangle: { shapeOptions: { color: '#ff7800', weight: 1 } }
    }
  });
  map.addControl(drawControl);

  map.on(L.Draw.Event.CREATED, function (e) {
    // clear previous
    drawFeatureGroup.clearLayers();
    const layer = e.layer;
    drawFeatureGroup.addLayer(layer);
    const bounds = layer.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    drawnExtent = bbox.join(',');
    // check the 'limit to extent' box when user draws
    const limitCheckbox = document.getElementById('limit-to-extent');
    if (limitCheckbox) limitCheckbox.checked = true;
  });

  map.on('draw:deleted', function () {
    drawnExtent = null;
  });
}

// initialize draw control after map created
try { setupDrawControl(); } catch (e) { console.warn('Draw control not available', e); }

// Sidebar toggle for app page (reuses landing styles)
try {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('expanded');
      sidebar.classList.toggle('collapsed');
    });
  }
  document.querySelectorAll('.sidebar .side-link, .side-link').forEach(a => {
    a.addEventListener('click', (ev) => {
      const href = a.getAttribute('href') || a.dataset.target;
      if (!href) return;
      if (href.startsWith('#')) {
        ev.preventDefault();
        const targetEl = document.querySelector(href);
        if (targetEl) {
          // If the target is a tab panel, open it using the tab system
          const id = href.replace(/^#/, '');
          try {
            if (targetEl.classList.contains('tab-panel') || targetEl.closest('.tab-panel')) {
              openTab(id);
            } else {
              targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          } catch (e) {
            // fallback to scrolling if openTab fails
            try { targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e2) {}
          }
          if (sidebar) { sidebar.classList.add('collapsed'); sidebar.classList.remove('expanded'); }
        }
      }
    });
  });
} catch (e) { console.warn('App sidebar init failed', e); }

adminLoginBtn?.addEventListener('click', async () => {
  const username = adminUsernameInput ? adminUsernameInput.value.trim() : '';
  const password = adminPasswordInput ? adminPasswordInput.value.trim() : '';
  if (!username || !password) {
    if (adminStatus) adminStatus.textContent = 'Username and password are required';
    return;
  }
  try {
    const res = await fetch(apiUrl('/api/admin/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || 'Invalid credentials');
    }
    setAdminToken(result.token);
    if (adminStatus) adminStatus.textContent = 'Authenticated as admin';
    showAdminDashboard();
  } catch (err) {
    if (adminStatus) adminStatus.textContent = `Login failed: ${err.message}`;
  }
});

adminLogoutBtn?.addEventListener('click', () => {
  if (adminUsernameInput) adminUsernameInput.value = '';
  if (adminPasswordInput) adminPasswordInput.value = '';
  setAdminToken('');
  hideAdminDashboard();
});

if (adminToken) {
  if (adminStatus) adminStatus.textContent = 'Authenticated as admin';
  setTimeout(() => showAdminDashboard(), 100);
} else {
  if (adminStatus) adminStatus.textContent = 'Not authenticated';
}

const countyColors = {
  Kisii: '#1f78b4',
  Nyamira: '#33a02c',
  'Homa Bay': '#e31a1c',
  Kisumu: '#ff9800',
  Migori: '#9c27b0',
  Kericho: '#2196f3',
  Narok: '#4caf50',
  Bomet: '#ff5722',
  default: '#6a5acd'
};

function getMarkerOptions(farmer) {
  // Prefer county color for farmer markers; fall back to culture system color, then defaults
  const countyColor = (farmer && farmer.county && countyColors[farmer.county]) ? countyColors[farmer.county] : countyColors.default;
  const fallbackCulture = cultureSystemColors[farmer?.culture_system] || cultureSystemColors.default;
  const fill = countyColor || fallbackCulture;
  return {
    radius: 8,
    fillColor: fill,
    color: farmer.approved ? '#1f2937' : '#6b7280',
    weight: farmer.approved ? 1.8 : 1,
    fillOpacity: 0.95
  };
}

// Create a small colored pin icon (SVG wrapped in a DivIcon) for farmer markers
function createPinIcon(fillColor, outlineColor, size = 28) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size*1.2}" viewBox="0 0 24 28">
      <path d="M12 0C7 0 3 4.2 3 9.4c0 6.6 8.6 15.8 8.9 16.1.2.2.5.2.7 0 .3-.3 8.9-9.5 8.9-16.1C21 4.2 17 0 12 0z" fill="${fillColor}" stroke="${outlineColor}" stroke-width="1.2"/>
      <circle cx="12" cy="9" r="4.2" fill="#ffffff" fill-opacity="0.92" />
    </svg>`;
  return L.divIcon({
    html: svg,
    className: 'custom-pin-icon',
    iconSize: [size, Math.round(size * 1.2)],
    iconAnchor: [Math.round(size/2), Math.round(size*1.2 - 2)]
  });
}

function farmerProductionText(farmer) {
  if (farmer.production_capacity) return farmer.production_capacity;
  if (farmer.production_scale) return `${farmer.production_scale} production scale`;
  return 'Not specified';
}

function farmerProductsText(farmer) {
  if (farmer.equipment) return farmer.equipment;
  if (farmer.species) return Array.isArray(farmer.species) ? farmer.species.join(', ') : farmer.species;
  return 'Not specified';
}

// Safe coordinate formatter — returns 'N/A' for missing/invalid values
function formatCoord(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'N/A';
  return n.toFixed(6);
}

// Safe date formatter — returns human date or fallback
function formatDate(v) {
  if (!v) return 'Not recorded';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return 'Not recorded';
  return d.toLocaleDateString();
}
function showFarmerDetails(farmer) {
  if (!detailContent) {
    console.warn('detail-content element not found; farm details cannot be displayed.');
    return;
  }

  selectedFarmerId = farmer.id;
  highlightSelectedFarmer();

  // Parse species array if it's a string
  const speciesArray = Array.isArray(farmer.species)
    ? farmer.species
    : (farmer.species || '').toString().split(',').map(s => s.trim()).filter(Boolean);

  const speciesBadges = speciesArray.map(s => `<span class="badge">${s}</span>`).join('');

  const latText = formatCoord(farmer.latitude);
  const lngText = formatCoord(farmer.longitude);

  detailContent.innerHTML = `
    <div class="detail-header">
      <div>
        <h3>${farmer.name}</h3>
        <p class="approval-badge ${farmer.approved ? 'approved' : 'pending'}">
          ${farmer.approved ? '✓ Approved' : '⏳ Pending approval'}
        </p>
      </div>
    </div>
    
    <div class="detail-image-wrap">
      ${farmer.image_filename ? `<img class="detail-image" src="/uploads/${farmer.image_filename}" alt="${farmer.name}" />` : '<div class="detail-image placeholder">No image uploaded</div>'}
    </div>
    
    <div style="display: grid; gap: 12px;">
      <div class="detail-row">
        <strong>Farm ID:</strong> FARM-${farmer.id ? String(farmer.id).padStart(5, '0') : 'N/A'}
      </div>
      
      <div class="detail-row">
        <strong>GPS Coordinates:</strong> ${latText}, ${lngText}
      </div>
      <div style="margin-top:12px;">
        <h4 style="margin:6px 0">Ponds</h4>
        <div id="ponds-list" style="margin-bottom:8px;"></div>
        <form id="pond-form" style="display:grid;gap:8px;">
          <label for="pond_size">Pond size (m2)</label>
          <input id="pond_size" name="pond_size" type="number" step="0.01" />
          <label for="pond_species">Fish species</label>
          <input id="pond_species" name="fish_species" type="text" />
          <label for="stocking_date">Stocking date</label>
          <input id="stocking_date" name="stocking_date" type="date" />
          <div style="display:flex;gap:8px;">
            <button id="add-pond-btn" type="submit" class="secondary-button">Add pond</button>
            <button id="refresh-ponds" type="button" class="secondary-button">Refresh</button>
          </div>
          <div id="pond-status" class="hint" style="margin-top:6px;"></div>
        </form>
      </div>
      
      <div class="detail-row">
        <strong>County:</strong> ${farmer.county || 'Not specified'}
      </div>
      <div class="detail-row">
        <strong>Gender:</strong> ${farmer.gender || 'Not specified'}
      </div>
      
      <div class="detail-row">
        <strong>Fish Species Farmed:</strong>
        <div class="species-badges" style="margin-top: 6px;">
          ${speciesBadges || '<span class="badge">Not specified</span>'}
        </div>
      </div>
      
      <div class="detail-row">
        <strong>Culture System:</strong> ${farmer.culture_system || 'Not specified'}
      </div>
      
      ${farmer.production_scale ? `
      <div class="detail-row">
        <strong>Production Scale:</strong> ${farmer.production_scale}
      </div>
      ` : ''}
      
      <div class="detail-row">
        <strong>Equipment & Infrastructure:</strong> ${farmer.equipment || 'Not specified'}
      </div>
      
      <div class="detail-row">
        <strong>Production Capacity:</strong> ${farmer.production_capacity || farmer.production_scale || 'Not specified'}
      </div>
      
      <div class="detail-row">
        <strong>Water Source:</strong> ${farmer.water_source || 'Not specified'}
      </div>
      
      <div class="detail-row">
        <strong>Last Inspection Date:</strong> ${formatDate(farmer.last_inspection_date)}
      </div>
      
      <div class="detail-row">
        <strong>Contact Information:</strong> ${farmer.contact || farmer.phone || 'Not provided'}
      </div>
      
      <div class="detail-row">
        <strong>Email:</strong> ${farmer.email || 'Not provided'}
      </div>
      
      <div class="detail-row">
        <strong>Registration Date:</strong> ${formatDate(farmer.created_at)}
      </div>
    </div>
    
    ${adminToken ? `
        <div class="admin-actions">
          <button id="approval-button" class="secondary-button">${farmer.approved ? 'Revoke approval' : 'Approve farmer'}</button>
          <button id="edit-button" class="secondary-button">Edit farmer</button>
          <button id="delete-button" class="danger-button">Delete farmer</button>
        </div>
      ` : '<p class="hint">Log in as admin to approve registrations.</p>'}
  `;
  // After inserting detail HTML, wire up pond form & load current ponds
  try {
    const pondForm = document.getElementById('pond-form');
    const pondStatus = document.getElementById('pond-status');
    const refreshPondsBtn = document.getElementById('refresh-ponds');
    loadPonds(farmer.id).then(() => {});
    if (refreshPondsBtn) refreshPondsBtn.addEventListener('click', () => loadPonds(farmer.id));
    if (pondForm) {
      pondForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (pondStatus) pondStatus.textContent = 'Saving pond...';
        const size = document.getElementById('pond_size')?.value;
        const species = document.getElementById('pond_species')?.value;
        const stocking = document.getElementById('stocking_date')?.value;
        try {
          const res = await fetch(apiUrl('/api/ponds'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ farmer_id: farmer.id, pond_size: size || null, fish_species: species || '', stocking_date: stocking || null })
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Unable to save pond');
          if (pondStatus) pondStatus.textContent = 'Pond saved.';
          // reload ponds and stats
          await loadPonds(farmer.id);
          await loadPublicStats();
        } catch (err) {
          console.error('Add pond failed', err);
          if (pondStatus) pondStatus.textContent = `Error: ${err.message}`;
        }
      });
    }
  } catch (e) { console.warn('Pond form wiring failed', e); }
  
  if (adminToken) {
      const apbtn = document.getElementById('approval-button');
      const editBtn = document.getElementById('edit-button');
      const delBtn = document.getElementById('delete-button');
      if (apbtn) apbtn.addEventListener('click', () => toggleApproval(farmer));
      if (editBtn) editBtn.addEventListener('click', () => handleAdminEdit(farmer));
      if (delBtn) delBtn.addEventListener('click', () => handleAdminDelete(farmer));
  }
}

function highlightSelectedFarmer() {
  document.querySelectorAll('#farmer-list li').forEach((item) => {
    item.classList.toggle('farmer-selected', item.dataset.id === String(selectedFarmerId));
  });
}

function addFarmerMarker(farmer) {
  const lat = Number(farmer.latitude);
  const lng = Number(farmer.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return; // skip markers with invalid coords
  // Use colored pin icons so markers look like pins and are easier to distinguish
  const countyColor = (farmer && farmer.county && countyColors[farmer.county]) ? countyColors[farmer.county] : countyColors.default;
  const outline = farmer.approved ? '#155724' : '#6c757d';
  const icon = createPinIcon(countyColor, outline, 30);
  const marker = L.marker([lat, lng], { icon });
  const speciesText = Array.isArray(farmer.species) ? farmer.species.join(', ') : (farmer.species || '');
  const equipmentText = farmer.equipment ? (Array.isArray(farmer.equipment) ? farmer.equipment.join(', ') : farmer.equipment) : 'Not specified';
  const imageHtml = farmer.image_filename ? `<div style="margin:6px 0"><img src="/uploads/${farmer.image_filename}" alt="${farmer.name}" style="max-width:140px;max-height:96px;border-radius:6px;display:block;"/></div>` : '';
  const popupHtml = `
    <div style="min-width:200px;max-width:320px">
      <strong>${farmer.name}</strong>
      ${imageHtml}
      <div><strong>Gender:</strong> ${farmer.gender || 'Not specified'}</div>
      <div><strong>Species:</strong> ${speciesText}</div>
      <div><strong>Culture:</strong> ${farmer.culture_system || 'Not specified'}</div>
      <div><strong>Production:</strong> ${farmerProductionText(farmer)}</div>
      <div><strong>Equipment:</strong> ${equipmentText}</div>
      <div><strong>County:</strong> ${farmer.county || 'Not specified'}</div>
      <div style="margin-top:6px;color:${farmer.approved ? '#155724' : '#6c757d'}"><strong>Status:</strong> ${farmer.approved ? 'Approved' : 'Pending approval'}</div>
      ${farmer.approved ? `<div style="margin-top:8px"><button class="secondary-button view-profile" data-id="${farmer.id}">View full profile</button></div>` : ''}
    </div>
  `;
  marker.bindPopup(popupHtml);
  marker.on('click', () => { try { showFarmerDetails(farmer); marker.openPopup(); } catch(e){} });
  marker.on('popupopen', (e) => {
    try {
      const btn = e.popup._container && e.popup._container.querySelector && e.popup._container.querySelector('.view-profile');
      if (btn) btn.addEventListener('click', () => { showFarmerDetails(farmer); });
    } catch (e) { }
  });
  marker.addTo(markerGroup);
}

// Show a temporary highlighted marker for newly-registered farmer
function showTemporaryHighlight(lat, lng, farmer) {
  try {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return;
    const ring = L.circle([latNum, lngNum], { radius: 120, color: '#ffd54f', weight: 4, fill: false, interactive: false }).addTo(map);
    const pulse = L.circleMarker([latNum, lngNum], { radius: 12, fillColor: '#ff7043', color: '#fff', weight: 2, fillOpacity: 0.95 }).addTo(map);
    const speciesText = Array.isArray(farmer.species) ? farmer.species.join(', ') : (farmer.species || '');
    const popupHtml = `<strong>${farmer.name || 'New Farmer'}</strong><br><strong>Species:</strong> ${speciesText}<br><strong>County:</strong> ${farmer.county || ''}`;
    try { L.popup({ maxWidth: 300 }).setLatLng([latNum, lngNum]).setContent(popupHtml).openOn(map); } catch (e) {}
    // remove highlight after a short delay
    setTimeout(() => {
      try { map.removeLayer(ring); } catch (e) {}
      try { map.removeLayer(pulse); } catch (e) {}
    }, 8000);
  } catch (e) { console.warn('showTemporaryHighlight failed', e); }
}

// Generate heatmap data from farmers
function generateHeatmapData() {
  if (!farmersCache || farmersCache.length === 0) return [];
  return farmersCache
    .map(farmer => {
      const lat = Number(farmer.latitude);
      const lng = Number(farmer.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lat, lng, 0.5];
    })
    .filter(Boolean);
}

// Load and display density heatmap
function loadDensityHeatmap() {
  gisLayers.density.clearLayers();
  const heatmapData = generateHeatmapData();
  if (heatmapData && heatmapData.length > 0) {
    try {
      const heat = L.heatLayer(heatmapData, {
        radius: 40,
        blur: 25,
        maxZoom: 17,
        gradient: {
          0.4: '#2E7D32',    // Low: Green
          0.6: '#FBC02D',    // Medium: Yellow
          1.0: '#D32F2F'     // High: Red
        }
      });
      gisLayers.density.addLayer(heat);
    } catch (e) {
      console.warn('Leaflet.heat not available or error creating heatmap', e);
    }
  }
}

// Update analytics dashboard
async function updateAnalyticsDashboard() {
  try {
    // Total Farms
    const totalFarmsEl = document.getElementById('total-farms');
    if (totalFarmsEl) totalFarmsEl.textContent = farmersCache.length;
    
    // Total Fish Species (unique)
    const allSpecies = new Set();
    farmersCache.forEach(farmer => {
      const speciesArray = Array.isArray(farmer.species) 
        ? farmer.species 
        : (farmer.species || '').toString().split(',').map(s => s.trim()).filter(Boolean);
      speciesArray.forEach(s => allSpecies.add(s));
    });
    const totalSpeciesEl = document.getElementById('total-species');
    if (totalSpeciesEl) totalSpeciesEl.textContent = allSpecies.size;
    
    // Counties Covered
    const counties = new Set(farmersCache.map(f => f.county).filter(Boolean));
    const countiesEl = document.getElementById('counties-covered');
    if (countiesEl) countiesEl.textContent = counties.size;
    
    // Water Sources Mapped - load from GeoJSON
    let waterSourcesCount = 0;
    try {
      const res = await fetch('/data/water_sources.geojson');
      if (res.ok) {
        const geojson = await res.json();
        waterSourcesCount = geojson.features ? geojson.features.length : 0;
      }
    } catch (e) {
      waterSourcesCount = 0;
    }
    const waterSourcesEl = document.getElementById('water-sources-mapped');
    if (waterSourcesEl) waterSourcesEl.textContent = waterSourcesCount;
    
    // Hatcheries Registered
    let hatceriesCount = 0;
    try {
      const res = await fetch('/data/hatcheries.geojson');
      if (res.ok) {
        const geojson = await res.json();
        hatceriesCount = geojson.features ? geojson.features.length : 0;
      }
    } catch (e) {
      hatceriesCount = 0;
    }
    const hatceriesEl = document.getElementById('hatcheries-registered');
    if (hatceriesEl) hatceriesEl.textContent = hatceriesCount;
    
    // Markets Registered
    let marketsCount = 0;
    try {
      const res = await fetch('/data/markets.geojson');
      if (res.ok) {
        const geojson = await res.json();
        marketsCount = geojson.features ? geojson.features.length : 0;
      }
    } catch (e) {
      marketsCount = 0;
    }
    const marketsEl = document.getElementById('markets-registered');
    if (marketsEl) marketsEl.textContent = marketsCount;
  } catch (err) {
    console.error('Error updating analytics', err);
  }
}

// Load public stats from server and update shared dashboard elements
async function loadPublicStats() {
  try {
    const res = await fetch(apiUrl('/api/stats'));
    if (!res.ok) return;
    const stats = await res.json();

    // App-level / landing elements
    const totalFarmsEls = [
      document.getElementById('total-farms'),
      document.getElementById('landing-total-farms'),
      document.getElementById('metric-total')
    ];
    totalFarmsEls.forEach(el => { if (el) el.textContent = stats.total_farmers || 0; });

    const approvedEl = document.getElementById('metric-approved');
    if (approvedEl) approvedEl.textContent = stats.approved_farmers || 0;
    const pendingEl = document.getElementById('metric-pending');
    if (pendingEl) pendingEl.textContent = stats.pending_farmers || 0;

    const suppliersEl = document.getElementById('total-suppliers');
    if (suppliersEl) suppliersEl.textContent = stats.total_suppliers || 0;

    const marketsEls = [document.getElementById('markets-registered')];
    marketsEls.forEach(el => { if (el) el.textContent = stats.markets_count || 0; });

    const hatcheriesEls = [document.getElementById('hatcheries-registered')];
    hatcheriesEls.forEach(el => { if (el) el.textContent = stats.hatcheries_count || 0; });

    const pondsEl = document.getElementById('total-ponds');
    if (pondsEl) pondsEl.textContent = stats.total_ponds || 0;

    const countiesEl = document.getElementById('landing-counties-covered');
    if (countiesEl) countiesEl.textContent = document.getElementById('counties-covered')?.textContent || countiesEl.textContent;
  } catch (e) {
    console.warn('Unable to load public stats', e);
  }
}

// Load ponds for a given farmer and render in the detail panel
async function loadPonds(farmerId) {
  try {
    const res = await fetch(apiUrl(`/api/ponds?farmer_id=${encodeURIComponent(farmerId)}`));
    if (!res.ok) return [];
    const ponds = await res.json();
    renderPonds(ponds);
    return ponds;
  } catch (e) {
    console.warn('loadPonds failed', e);
    return [];
  }
}

function renderPonds(ponds) {
  try {
    const list = document.getElementById('ponds-list');
    if (!list) return;
    list.innerHTML = '';
    if (!ponds || !ponds.length) {
      list.innerHTML = '<div class="hint">No ponds recorded for this farmer.</div>';
      return;
    }
    ponds.forEach(p => {
      const el = document.createElement('div');
      el.className = 'pond-item card';
      el.style.marginBottom = '8px';
      el.innerHTML = `<strong>Pond #${p.pond_id}</strong> — ${p.fish_species || 'Species not specified'}<br>Size: ${p.pond_size || 'N/A'} — Stocked: ${p.stocking_date || 'N/A'}`;
      list.appendChild(el);
    });
  } catch (e) { console.warn('renderPonds failed', e); }
}

function clearMarkers() {
  markerGroup.clearLayers();
}

function renderFarmerList(farmers) {
  if (!farmerList) return;
  farmerList.innerHTML = '';
  if (!farmers.length) {
    farmerList.innerHTML = '<li>No farmers found matching the active filters.</li>';
    return;
  }

  const bounds = [];
  farmers.forEach((farmer) => {
    const item = document.createElement('li');
    item.dataset.id = farmer.id;
    item.style.borderLeft = `4px solid ${countyColors[farmer.county] || countyColors.default}`;
    const countyClass = `county-${farmer.county.toLowerCase().replace(/\s+/g, '-')}`;
    item.classList.add(countyClass);
    item.innerHTML = `
      <button type="button" class="farmer-button">
        ${farmer.name} ${farmer.approved ? '<span class="verified-badge">Verified</span>' : ''} — ${farmer.county}
      </button>
      <div class="farmer-details">
        <strong>Status:</strong> ${farmer.approved ? 'Approved / Verified' : 'Pending'}<br>
        <strong>Species:</strong>
        <div class="species-badges">${(Array.isArray(farmer.species) ? farmer.species : (farmer.species||'').toString().split(',')).map(s=>s.trim()).filter(Boolean).map(s=>`<span class="badge">${s}</span>`).join('')}</div>
        <strong>Culture:</strong> ${farmer.culture_system}${farmer.production_scale ? `<br><strong>Scale:</strong> ${farmer.production_scale}` : ''}
      </div>
    `;

    const button = item.querySelector('.farmer-button');
    button.addEventListener('click', () => {
      map.setView([farmer.latitude, farmer.longitude], 13);
      showFarmerDetails(farmer);
    });

    farmerList.appendChild(item);
    const lat = Number(farmer.latitude);
    const lng = Number(farmer.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) bounds.push([lat, lng]);
  });

  if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [40, 40] });
  }
  highlightSelectedFarmer();
}

// ADMIN: Approve farmer via API
async function adminApproveFarmer(id, approve = true) {
  try {
    const token = localStorage.getItem('adminToken') || '';
    const res = await fetchWithTimeout(`/api/admin/farmers/${id}/approval`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ approved: approve })
    }, 10000);
    return await res.json();
  } catch (err) {
    console.error('Approve error', err);
    throw err;
  }
}

// ADMIN: Edit farmer
async function adminEditFarmer(id, payload) {
  const token = localStorage.getItem('adminToken') || '';
  const res = await fetchWithTimeout(`/api/admin/farmers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(payload)
  }, 10000);
  return res.json();
}

// ADMIN: Delete farmer
async function adminDeleteFarmer(id) {
  const token = localStorage.getItem('adminToken') || '';
  const res = await fetchWithTimeout(`/api/admin/farmers/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  }, 10000);
  return res.json();
}

// ADMIN: Export CSV (authenticated, uses blob download)
async function adminExportCSV() {
  try {
    const token = localStorage.getItem('adminToken') || '';
    const res = await fetchWithTimeout('/api/admin/farmers/export/csv', { headers: { 'Authorization': `Bearer ${token}` } }, 20000);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || 'Export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'farmers_export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Export CSV failed', err);
    throw err;
  }
}

// ADMIN: Fetch report
async function adminFetchReport() {
  const token = localStorage.getItem('adminToken') || '';
  const res = await fetchWithTimeout('/api/admin/farmers/report', { headers: { 'Authorization': `Bearer ${token}` } }, 10000);
  return res.json();
}

// Toggle approval convenience wrapper
async function toggleApproval(farmer) {
  try {
    const resp = await adminApproveFarmer(farmer.id, !farmer.approved);
    // Update local cache and UI
    const idx = farmersCache.findIndex(f => f.id === farmer.id);
    if (idx !== -1) {
      farmersCache[idx].approved = resp.approved ? 1 : 0;
      showFarmerDetails(farmersCache[idx]);
      updateAnalyticsDashboard();
      // refresh markers
      updateFarmersView();
    }
  } catch (err) {
    alert('Unable to change approval: ' + (err.message || 'error'));
  }
}

// Handle admin delete
async function handleAdminDelete(farmer) {
  if (!confirm(`Delete farmer ${farmer.name}? This cannot be undone.`)) return;
  try {
    const resp = await adminDeleteFarmer(farmer.id);
    if (resp && resp.deleted) {
      farmersCache = farmersCache.filter(f => f.id !== farmer.id);
      updateAnalyticsDashboard();
      updateFarmersView();
      detailContent.innerHTML = '<p>Farmer deleted.</p>';
      if (typeof loadAdminFarmersTable === 'function') {
        loadAdminFarmersTable();
      }
    }
  } catch (err) {
    alert('Delete failed: ' + (err.message || 'error'));
  }
}

// Handle admin edit via simple prompts (name, email, phone)
async function handleAdminEdit(farmer) {
  const name = prompt('Name', farmer.name) || farmer.name;
  const email = prompt('Email', farmer.email) || farmer.email;
  const phone = prompt('Phone', farmer.phone) || farmer.phone;
  const payload = { name, email, phone };
  try {
    const updated = await adminEditFarmer(farmer.id, payload);
    const idx = farmersCache.findIndex(f => f.id === farmer.id);
    if (idx !== -1) {
      farmersCache[idx] = Object.assign({}, farmersCache[idx], updated);
      showFarmerDetails(farmersCache[idx]);
      updateFarmersView();
    }
  } catch (err) {
    alert('Edit failed: ' + (err.message || 'error'));
  }
}

function getFilteredFarmers() {
  const county = countyFilter?.value || '';
  const species = speciesFilter?.value || '';
  const culture = cultureFilter?.value || '';
  const scale = scaleFilter?.value || '';
  const statusValue = statusFilter?.value || 'all';
  const dateRange = dateFilter?.value || '';
  const search = (searchFilter?.value || '').trim().toLowerCase() || '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  return farmersCache.filter((farmer) => {
    if (county && farmer.county !== county) {
      return false;
    }
    if (species) {
      const farmerSpeciesList = Array.isArray(farmer.species) ? farmer.species.map(s=>s.toLowerCase()) : (farmer.species || '').toString().split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (!farmerSpeciesList.includes(species.toLowerCase())) return false;
    }
    if (culture && farmer.culture_system !== culture) {
      return false;
    }
    if (scale && farmer.production_scale !== scale) {
      return false;
    }
    if (statusValue !== 'all') {
      const expectedApproved = statusValue === 'approved' ? 1 : 0;
      if (farmer.approved !== expectedApproved) {
        return false;
      }
    }
    if (dateRange) {
      const createdDate = new Date(farmer.created_at);
      const createdDay = new Date(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate());
      if (dateRange === 'today' && createdDay.getTime() !== today.getTime()) {
        return false;
      }
      if (dateRange === 'this-month' && (createdDate.getFullYear() !== now.getFullYear() || createdDate.getMonth() !== now.getMonth())) {
        return false;
      }
      if (dateRange === 'this-year' && createdDate.getFullYear() !== now.getFullYear()) {
        return false;
      }
    }
    if (search) {
      const text = [
        farmer.name,
        farmer.county,
        farmer.species,
        farmer.culture_system,
        farmer.equipment,
        farmer.contact
      ].join(' ').toLowerCase();
      if (!text.includes(search)) {
        return false;
      }
    }
    return true;
  });
}

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function supplierColorBySpecies(species) {
  const normalized = (species || '').toString().toLowerCase();
  if (normalized.includes('tilapia')) return '#22c55e';
  if (normalized.includes('catfish')) return '#2563eb';
  if (normalized.includes('ornamental') || normalized.includes('mixed')) return '#8b5cf6';
  return '#0f766e';
}

function getSupplierCategoryBadge(category) {
  if (!category) return '';
  return `<span class="supplier-badge">${category}</span>`;
}

function formatSupplierContact(phone) {
  if (!phone) return 'Not provided';
  return `<a href="tel:${phone}" class="supplier-contact-link">${phone}</a>`;
}

function supplierDistanceText(distanceKm) {
  return distanceKm >= 0 ? `${distanceKm.toFixed(1)} km` : 'Distance unavailable';
}

function showSupplierPopup(supplier, distanceKm = null) {
  const statusText = supplier.verified ? '✅ Verified by KMFRI' : 'Pending verification';
  const speciesText = supplier.species ? supplier.species.join(', ') : 'Not specified';
  return `
    <strong>${supplier.farm_name}</strong><br />
    Owner: ${supplier.owner_name}<br />
    Species: ${speciesText}<br />
    Stock: ${supplier.quantity || 'Unknown'}<br />
    Price: ${supplier.price ? `KES ${supplier.price} each` : 'Not set'}<br />
    County: ${supplier.county}<br />
    Phone: ${supplier.phone || 'Not provided'}<br />
    Status: ${statusText}${distanceKm !== null ? `<br />Distance: ${supplierDistanceText(distanceKm)}` : ''}
  `;
}

function addSupplierMarker(supplier) {
  const marker = L.circleMarker([supplier.latitude, supplier.longitude], {
    radius: 8,
    fillColor: supplierColorBySpecies(supplier.species),
    color: supplier.verified ? '#0f172a' : '#7c3aed',
    weight: 1.5,
    fillOpacity: 0.85
  });
  const distanceKm = currentFarmerLocation && supplier.latitude && supplier.longitude
    ? getDistanceKm(currentFarmerLocation.lat, currentFarmerLocation.lng, supplier.latitude, supplier.longitude)
    : null;
  marker.bindPopup(showSupplierPopup(supplier, distanceKm));
  marker.on('click', () => {
    if (supplier.latitude && supplier.longitude) {
      map.setView([supplier.latitude, supplier.longitude], 13);
    }
  });
  supplierLayer.addLayer(marker);
}

function clearSupplierMarkers() {
  supplierLayer.clearLayers();
}

function getFilteredSuppliers() {
  const category = supplierCategoryFilter?.value || '';
  const species = supplierSpeciesFilter?.value || '';
  const county = supplierCountyFilter?.value || '';
  const priceRange = supplierPriceFilter?.value || '';
  const distanceValue = supplierDistanceFilter?.value || '';
  const search = supplierSearchFilter?.value.trim().toLowerCase() || '';

  return supplierCache.filter((supplier) => {
    if (!supplier.verified) return false;
    if (category && String(supplier.category || '').toLowerCase() !== String(category || '').toLowerCase()) return false;
    if (species) {
      const normalizedSpecies = (supplier.species || []).map((s) => s.toLowerCase());
      if (!normalizedSpecies.some((item) => item.includes(species.toLowerCase()))) return false;
    }
    if (county && supplier.county !== county) return false;
    if (priceRange && supplier.price !== null && supplier.price !== undefined) {
      const [min, max] = priceRange.split('-').map(Number);
      if (supplier.price < min || supplier.price > max) return false;
    }
    if (priceRange && (supplier.price === null || supplier.price === undefined)) {
      return false;
    }
    if (distanceValue && currentFarmerLocation && supplier.latitude && supplier.longitude) {
      const dist = getDistanceKm(currentFarmerLocation.lat, currentFarmerLocation.lng, supplier.latitude, supplier.longitude);
      if (dist > Number(distanceValue)) return false;
    }
    if (search) {
      const text = [supplier.farm_name, supplier.owner_name, supplier.county, supplier.category, supplier.species?.join(', '), supplier.phone].join(' ').toLowerCase();
      if (!text.includes(search)) return false;
    }
    return true;
  });
}

function renderSupplierList() {
  if (!supplierList) return;
  const listings = getFilteredSuppliers();
  if (!listings.length) {
    supplierList.innerHTML = '<li class="supplier-empty">No suppliers match the selected filters.</li>';
    return;
  }

  supplierList.innerHTML = listings.map((supplier) => {
    const speciesText = supplier.species?.length ? supplier.species.join(', ') : 'Not specified';
    const distanceKm = currentFarmerLocation && supplier.latitude && supplier.longitude
      ? getDistanceKm(currentFarmerLocation.lat, currentFarmerLocation.lng, supplier.latitude, supplier.longitude)
      : null;
    const directionsLink = currentFarmerLocation
      ? `https://www.google.com/maps/dir/?api=1&origin=${currentFarmerLocation.lat},${currentFarmerLocation.lng}&destination=${supplier.latitude},${supplier.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${supplier.latitude},${supplier.longitude}`;

    return `
      <li class="supplier-item">
        <div class="supplier-top-row">
          <div>
            <strong>${supplier.farm_name}</strong>
            <div class="supplier-subtitle">${supplier.owner_name} • ${supplier.county}</div>
          </div>
          <div>${getSupplierCategoryBadge(supplier.category)} ${supplier.verified ? '<span class="supplier-status verified">Verified</span>' : '<span class="supplier-status">Unverified</span>'}</div>
        </div>
        <div class="supplier-meta">
          <div><strong>Species:</strong> ${speciesText}</div>
          <div><strong>Stock:</strong> ${supplier.quantity != null ? `${supplier.quantity.toLocaleString()} fingerlings` : 'Not set'}</div>
          <div><strong>Price:</strong> ${supplier.price != null ? `KES ${supplier.price.toFixed(2)} each` : 'Not set'}</div>
          <div><strong>Phone:</strong> ${formatSupplierContact(supplier.phone)}</div>
          ${distanceKm !== null ? `<div><strong>Distance:</strong> ${supplierDistanceText(distanceKm)}</div>` : ''}
        </div>
        <div class="supplier-actions">
          <a class="secondary-button" href="tel:${supplier.phone}">Call Supplier</a>
          <a class="secondary-button" href="sms:${supplier.phone}">Send Inquiry</a>
          <a class="secondary-button" target="_blank" rel="noreferrer" href="${directionsLink}">Get Directions</a>
        </div>
      </li>
    `;
  }).join('');
}

async function loadSuppliers() {
  try {
    const response = await fetch(apiUrl('/api/suppliers'));
    supplierCache = await response.json();
    clearSupplierMarkers();
    supplierCache.forEach(addSupplierMarker);
    renderSupplierList();
  } catch (error) {
    console.error('Unable to load suppliers', error);
    if (supplierNearbyStatus) supplierNearbyStatus.textContent = 'Unable to load suppliers. Check server status.';
  }
}

// Render admin supplier table (simple) and attach verify buttons
async function renderAdminSuppliers() {
  try {
    if (!adminToken) return;
    // ensure suppliers loaded
    if (!supplierCache || !supplierCache.length) await loadSuppliers();
    const container = document.getElementById('admin-suppliers-tbody');
    if (!container) return;
    container.innerHTML = '';
    supplierCache.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:8px">${s.farm_name}</td>
        <td style="padding:8px">${s.owner_name}</td>
        <td style="padding:8px">${s.county}</td>
        <td style="padding:8px">${Array.isArray(s.species)?s.species.join(', '):s.species||''}</td>
        <td style="padding:8px;text-align:center">${s.verified? 'Verified' : 'Unverified'}</td>
        <td style="padding:8px;text-align:center"><button class="secondary-button verify-supplier-btn" data-id="${s.id}">${s.verified? 'Revoke' : 'Verify'}</button></td>
      `;
      container.appendChild(tr);
    });
    // attach handlers
    document.querySelectorAll('.verify-supplier-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const to = e.currentTarget.textContent === 'Verify' ? 1 : 0;
        try {
          const resp = await fetch(apiUrl(`/api/suppliers/${id}/verify`), {
            method: 'PATCH',
            headers: Object.assign({}, authHeaders({ 'Content-Type': 'application/json' })),
            body: JSON.stringify({ verified: to })
          });
          const j = await resp.json();
          if (!resp.ok) throw new Error(j.error || 'Verify failed');
          await loadSuppliers();
          renderAdminSuppliers();
        } catch (err) { alert('Verify failed: ' + (err.message || err)); }
      });
    });
  } catch (e) { console.warn('renderAdminSuppliers failed', e); }
}

// wire supplier refresh button
if (supplierRefreshBtn) supplierRefreshBtn.addEventListener('click', () => { loadSuppliers(); updateSupplierMarketplace(); });

// when admin dashboard shown, refresh supplier admin table
function showAdminDashboard() {
  // existing showAdminDashboard may exist; ensure supplier table is loaded
  try { renderAdminSuppliers(); } catch (e) {}
  // existing code follows
  try { updateAnalyticsDashboard(); } catch (e) {}
}

function updateSupplierMarketplace() {
  clearSupplierMarkers();
  const filtered = getFilteredSuppliers();
  filtered.forEach(addSupplierMarker);
  renderSupplierList();
}

function updateNearbyStatus(message) {
  if (supplierNearbyStatus) {
    supplierNearbyStatus.textContent = message;
  }
}

function locateFarmerAndFilterNearby() {
  if (!navigator.geolocation) {
    updateNearbyStatus('Geolocation not supported.');
    return;
  }
  updateNearbyStatus('Finding your location…');
  navigator.geolocation.getCurrentPosition((position) => {
    currentFarmerLocation = {
      lat: position.coords.latitude,
      lng: position.coords.longitude
    };
    updateNearbyStatus('Location set. Filtering nearby suppliers.');
    updateSupplierMarketplace();
    if (currentFarmerLocation && supplierCache.length) {
      map.setView([currentFarmerLocation.lat, currentFarmerLocation.lng], 11);
    }
  }, (err) => {
    updateNearbyStatus(`Geolocation error: ${err.message}`);
  }, { enableHighAccuracy: true });
}

function updateFarmersView() {
  clearMarkers();
  const filtered = getFilteredFarmers();
  filtered.forEach(addFarmerMarker);
  renderFarmerList(filtered);
  // If there are markers, fit map bounds to show them; if a county filter is active, zoom to that county's farmers
  try {
    const layers = markerGroup.getLayers();
    if (layers && layers.length) {
      const bounds = markerGroup.getBounds();
      if (bounds.isValid && bounds.isValid()) {
        if (layers.length === 1) {
          map.setView(layers[0].getLatLng(), 13);
        } else {
          map.fitBounds(bounds.pad(0.12));
        }
      }
    } else {
      // no markers: reset to regional center
      try { map.setView(KEGATI_COORDS, 10); } catch (e) {}
    }
  } catch (e) { /* ignore fit errors */ }
}

function setCoordinatesFromMapClick(latlng) {
  latitudeInput.value = latlng.lat.toFixed(6);
  longitudeInput.value = latlng.lng.toFixed(6);
  status.textContent = 'Coordinates set from map click.';
}

function convertFarmersToCsv(farmers) {
  const headers = ['Name', 'County', 'Latitude', 'Longitude', 'Species', 'Culture System', 'Production Scale', 'Equipment', 'Contact', 'Approved', 'Image'];
  const rows = farmers.map((farmer) => {
    const speciesForCsv = Array.isArray(farmer.species) ? farmer.species.join('; ') : (farmer.species || '');
    return [
      farmer.name,
      farmer.county,
      farmer.latitude,
      farmer.longitude,
      speciesForCsv,
      farmer.culture_system,
      farmer.production_scale || '',
      farmer.equipment || '',
      farmer.contact || '',
      farmer.approved ? 'Yes' : 'No',
      farmer.image_filename ? `/uploads/${farmer.image_filename}` : ''
    ];
  });
  return [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportFarmerData() {
  const farmers = getFilteredFarmers();
  if (!farmers.length) {
    status.textContent = 'No farmers available to export.';
    return;
  }
  const csv = convertFarmersToCsv(farmers);
  const fileCounty = countyFilter.value || 'all';
  const fileStatus = statusFilter?.value || 'all';
  const filename = `farmers-${fileCounty}-${fileStatus}-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadCsv(filename, csv);
  status.textContent = 'Farmer data downloaded.';
}

// Note: admin-aware toggleApproval implemented earlier near admin helpers.

map.on('click', async (event) => {
  try {
    setCoordinatesFromMapClick(event.latlng);
    const place = await reverseGeocode(event.latlng.lat, event.latlng.lng);
    const nearby = await findNearbyFeatures(event.latlng.lat, event.latlng.lng, 500);
    showPlacePopupOn(map, event.latlng, place, nearby);
    const locEl = document.getElementById('location_name'); if (locEl && place) locEl.value = place;
  } catch (err) {
    console.warn('map click handler failed', err);
  }
});

supplierCategoryFilter?.addEventListener('change', updateSupplierMarketplace);
supplierSpeciesFilter?.addEventListener('change', updateSupplierMarketplace);
supplierCountyFilter?.addEventListener('change', updateSupplierMarketplace);
supplierPriceFilter?.addEventListener('change', updateSupplierMarketplace);
supplierDistanceFilter?.addEventListener('change', updateSupplierMarketplace);
supplierSearchFilter?.addEventListener('input', updateSupplierMarketplace);
supplierNearbyBtn?.addEventListener('click', locateFarmerAndFilterNearby);

clearFilter?.addEventListener('click', () => {
  if (countyFilter) countyFilter.value = '';
  if (speciesFilter) speciesFilter.value = '';
  if (cultureFilter) cultureFilter.value = '';
  if (scaleFilter) scaleFilter.value = '';
  if (statusFilter) statusFilter.value = 'all';
  if (dateFilter) dateFilter.value = '';
  if (searchFilter) searchFilter.value = '';
  updateFarmersView();
});

countyFilter?.addEventListener('change', updateFarmersView);
speciesFilter?.addEventListener('change', updateFarmersView);
cultureFilter?.addEventListener('change', updateFarmersView);
scaleFilter?.addEventListener('change', updateFarmersView);
statusFilter?.addEventListener('change', updateFarmersView);
dateFilter?.addEventListener('change', updateFarmersView);
searchFilter?.addEventListener('input', updateFarmersView);
exportData?.addEventListener('click', exportFarmerData);
function initLoginMap() {
  if (!document.getElementById('login-map')) return;

  const kenyaCenter = [-0.70875, 34.82152];
  const loginMap = L.map('login-map', { attributionControl: false }).setView(kenyaCenter, 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(loginMap);

  const kenyaBounds = L.latLngBounds([[-4.7, 33.5], [5.0, 41.9]]);
  loginMap.setMaxBounds(kenyaBounds);
  loginMap.on('drag', () => loginMap.panInsideBounds(kenyaBounds));

  let loginMarker = null;
  loginMap.on('click', (e) => {
    const lat = e.latlng.lat.toFixed(6);
    const lng = e.latlng.lng.toFixed(6);
    latitudeInput.value = lat;
    longitudeInput.value = lng;
    status.textContent = 'Coordinates set from map click.';
    try { if (locationSource) locationSource.textContent = 'Source: Map click'; } catch (e) {}
    if (loginMarker) loginMarker.setLatLng(e.latlng);
    else loginMarker = L.marker(e.latlng).addTo(loginMap);
    // reverse geocode and show place name popup + nearby features
    (async () => {
      try {
        const place = await reverseGeocode(e.latlng.lat, e.latlng.lng);
        const nearby = await findNearbyFeatures(e.latlng.lat, e.latlng.lng, 500);
        showPlacePopupOn(loginMap, e.latlng, place, nearby);
        const locEl = document.getElementById('location_name'); if (locEl && place) locEl.value = place;
      } catch (err) { console.warn('loginMap reverse geocode failed', err); }
    })();
  });

  const locateBtn = document.getElementById('locate-me');
    if (locateBtn) {
      locateBtn.addEventListener('click', () => {
        if (!navigator.geolocation) {
          status.textContent = 'Geolocation not supported.';
          return;
        }
        navigator.geolocation.getCurrentPosition(async (pos) => {
          try {
            // Diagnostic logging
            console.log('navigator.geolocation position:', pos && pos.coords ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy } : pos);
            const lat = Number(pos.coords.latitude);
            const lng = Number(pos.coords.longitude);
            const minLat = -4.7, maxLat = 5.0, minLng = 33.5, maxLng = 41.9;

            if (Number.isNaN(lat) || Number.isNaN(lng)) {
              status.textContent = 'Received invalid coordinates from device.';
              return;
            }

            // If device GPS is outside Kenya, try IP-based fallback; otherwise accept GPS
            const inKenya = (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng);
            let useLat = lat, useLng = lng, source = 'device GPS';

            if (!inKenya) {
              console.warn('GPS outside expected bounds; attempting IP fallback', { lat, lng });
              try {
                const ipResp = await fetch('https://ipapi.co/json/');
                if (ipResp.ok) {
                  const ipData = await ipResp.json();
                  const ipLat = Number(ipData.latitude);
                  const ipLng = Number(ipData.longitude);
                  if (!Number.isNaN(ipLat) && !Number.isNaN(ipLng) && ipLat >= minLat && ipLat <= maxLat && ipLng >= minLng && ipLng <= maxLng) {
                    useLat = ipLat; useLng = ipLng; source = 'IP fallback';
                    console.log('Using IP-based location from ipapi.co for auto-fill', { ipLat, ipLng });
                  } else {
                    // keep device coords but mark as outside coverage
                    source = 'device GPS (outside coverage)';
                    console.warn('IP fallback did not return Kenya coordinates', { ipLat, ipLng });
                  }
                }
              } catch (e) {
                console.warn('IP fallback failed', e);
              }
            }

            loginMap.setView([useLat, useLng], 13);
            latitudeInput.value = useLat.toFixed(6);
            longitudeInput.value = useLng.toFixed(6);
            status.textContent = `Coordinates set from ${source} (device accuracy ${pos.coords.accuracy || 'unknown'} m).`;
            try { if (locationSource) locationSource.textContent = `Source: ${source}`; } catch (e) {}
            if (loginMarker) loginMarker.setLatLng([useLat, useLng]);
            else loginMarker = L.marker([useLat, useLng]).addTo(loginMap);
          } catch (e) {
            console.warn('Error handling geolocation result', e);
            status.textContent = 'Error processing device location.';
          }
        }, (err) => {
          status.textContent = `Geolocation error: ${err.message}`;
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
      });
    }
}

initLoginMap();

// ============================================================================
// FARMER AUTHENTICATION & DASHBOARD
// ============================================================================

const farmerModal = document.getElementById('farmer-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const farmerAuthTabs = document.querySelectorAll('.auth-tab-btn');
const farmerLoginForm = document.getElementById('farmer-login-form');
const farmerRegisterForm = document.getElementById('farmer-register-form');
const farmerDashboardContent = document.getElementById('farmer-dashboard-content');

let farmerToken = localStorage.getItem('farmerToken') || '';
let currentFarmer = null;

// Fetch wrapper with timeout to avoid hanging requests
function fetchWithTimeout(resource, options = {}, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Request timed out'));
    }, timeout);
    fetch(apiUrl(resource), options)
      .then((response) => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// Modal Close
if (modalCloseBtn) {
  modalCloseBtn.addEventListener('click', () => {
    if (farmerModal) farmerModal.classList.add('hidden');
  });
}

// Auth Tab Switching
farmerAuthTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    document.querySelectorAll('.auth-tab-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    document.querySelectorAll('.auth-tab-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    tab.classList.add('active');
  });
});

// FARMER LOGIN
farmerLoginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('fmerchant_email').value.trim();
  const password = document.getElementById('fmerchant_password').value.trim();
  const status = document.getElementById('farmer-login-status');

  if (!email || !password) {
    status.textContent = 'Email and password required';
    return;
  }

  try {
    const res = await fetch(apiUrl('/api/farmers/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || 'Login failed');
    }

    farmerToken = result.token;
    localStorage.setItem('farmerToken', farmerToken);
    currentFarmer = result.farmer;
    
    status.textContent = 'Login successful!';
    // apply farmer role UI changes
    try { applyRole('farmer'); } catch (e) {}
    setTimeout(() => {
      if (farmerModal) farmerModal.classList.add('hidden');
      activateTab('farmer-dashboard-tab');
      loadFarmerProfile();
    }, 600);
  } catch (err) {
    status.textContent = `Login error: ${err.message}`;
  }
});

// FARMER REGISTER
farmerRegisterForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const formData = new FormData(farmerRegisterForm);
  const speciesCheckboxes = farmerRegisterForm.querySelectorAll('input[name="species"]:checked');
  const species = Array.from(speciesCheckboxes).map(cb => cb.value);
  
  if (species.length === 0) {
    document.getElementById('farmer-register-status').textContent = 'Please select at least one species';
    return;
  }

  // Remove old species field and add as JSON
  formData.delete('species');
  formData.append('species', JSON.stringify(species));
  
  const status = document.getElementById('farmer-register-status');

  try {
    const res = await fetch(apiUrl('/api/farmers/auth/register'), {
      method: 'POST',
      body: formData
    });
    
    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || 'Registration failed');
    }

    status.textContent = result.message || 'Registration successful! Please log in.';
    farmerRegisterForm.reset();
    
    // Switch to login tab
    setTimeout(() => {
      const loginTab = document.querySelector('[data-tab="login"]');
      const loginContent = document.getElementById('login-tab');
      document.querySelectorAll('.auth-tab-content').forEach(c => c.classList.remove('active'));
      document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
      loginTab.classList.add('active');
      loginContent.classList.add('active');
    }, 500);
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
});

// LOAD FARMER PROFILE
async function loadFarmerProfile() {
  if (!farmerToken) {
    showFarmerLoginModal();
    return;
  }

  // show loading state early to avoid UI hang
  console.debug('loadFarmerProfile: start');
  if (farmerDashboardContent) farmerDashboardContent.innerHTML = '<p>Loading your farm profile…</p>';
  try {
    console.debug('loadFarmerProfile: fetching /api/farmers/me');
    const res = await fetchWithTimeout('/api/farmers/me', {
      headers: { 'Authorization': `Bearer ${farmerToken}` }
    }, 10000);

    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem('farmerToken');
        farmerToken = '';
        showFarmerLoginModal();
        return;
      }
      throw new Error(`Failed to load profile (status ${res.status})`);
    }

    const farmer = await res.json();
    currentFarmer = farmer;
    console.debug('loadFarmerProfile: fetched farmer', farmer && farmer.id);
    renderFarmerDashboard(farmer);
  } catch (err) {
    console.error('loadFarmerProfile error', err);
    if (farmerDashboardContent) farmerDashboardContent.innerHTML = `<p style="color:red;">Error loading profile: ${err.message}</p>`;
  }
}

// RENDER FARMER DASHBOARD
function renderFarmerDashboard(farmer) {
  const speciesList = Array.isArray(farmer.species) ? farmer.species.join(', ') : farmer.species || 'Not specified';
  
  const profileImageHtml = farmer.image_filename 
    ? `<img src="/uploads/${farmer.image_filename}" alt="${farmer.name}" />`
    : '<div class="placeholder">No image uploaded</div>';

  farmerDashboardContent.innerHTML = `
    <div class="farmer-profile-header">
      <div class="farmer-profile-image">
        ${profileImageHtml}
      </div>
      <div class="farmer-profile-info">
        <div style="font-size: 1.8rem; font-weight: 800; color: #1976d2;">${farmer.name}</div>
        <div class="farmer-info-row">
          <strong>Status:</strong>
          <span class="approval-status ${farmer.approved ? 'approved' : 'pending'}">
            ${farmer.approved ? '✓ Approved' : '⏳ Pending'}
          </span>
        </div>
        <div class="farmer-info-row">
          <strong>County:</strong>
          <span>${farmer.county}</span>
        </div>
        <div class="farmer-info-row">
          <strong>Email:</strong>
          <span>${farmer.email}</span>
        </div>
        <div class="farmer-info-row">
          <strong>Phone:</strong>
          <span>${farmer.phone || 'Not provided'}</span>
        </div>
        <div class="farmer-info-row">
          <strong>Registered:</strong>
          <span>${formatDate(farmer.created_at)}</span>
        </div>
        <div class="farmer-actions">
          <button class="farmer-edit-btn" onclick="showEditFarmerForm()">✎ Edit Profile</button>
          <button class="farmer-logout-btn" onclick="farmerLogout()">Logout</button>
        </div>
      </div>
    </div>

    <div class="farmer-details-grid">
      <div class="profile-card">
        <h3>🐟 Species Farmed</h3>
        <div class="species-badges">
          ${Array.isArray(farmer.species) 
            ? farmer.species.map(s => `<span class="badge">${s}</span>`).join('')
            : `<span class="badge">${farmer.species || 'Not specified'}</span>`
          }
        </div>
      </div>

      <div class="profile-card">
        <h3>🏗 Culture System</h3>
        <p>${farmer.culture_system || 'Not specified'}</p>
      </div>

      <div class="profile-card">
        <h3>📊 Production Scale</h3>
        <p>${farmer.production_scale || 'Not specified'}</p>
      </div>

      <div class="profile-card">
        <h3>🛠 Equipment</h3>
        <p>${farmer.equipment || 'Not specified'}</p>
      </div>

      <div class="profile-card">
        <h3>📍 Location</h3>
        <p>Latitude: ${formatCoord(farmer.latitude)}<br>Longitude: ${formatCoord(farmer.longitude)}</p>
      </div>

      <div class="profile-card">
        <h3>📞 Contact</h3>
        <p>${farmer.contact || 'Not provided'}</p>
      </div>
    </div>

    <div class="profile-card">
      <h3>📍 Your Farm on Map</h3>
      <div id="farmer-profile-map" style="width: 100%; height: 400px; border-radius: 8px; margin-top: 12px;"></div>
    </div>
  `;

  // Initialize map for farmer location
  setTimeout(() => {
    const mapElement = document.getElementById('farmer-profile-map');
    const lat = Number(farmer.latitude);
    const lng = Number(farmer.longitude);
    if (!mapElement) return;
    try {
      // clear any existing Leaflet map markup to avoid errors when re-rendering
      if (mapElement._leaflet_id) {
        mapElement.innerHTML = '';
      }
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const farmerMap = L.map(mapElement).setView([lat, lng], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(farmerMap);
        L.marker([lat, lng])
          .addTo(farmerMap)
          .bindPopup(`<strong>${farmer.name}</strong><br>${farmer.county}`)
          .openPopup();
      } else {
        mapElement.innerHTML = '<div style="padding:18px; color:#334e68;">Location not available for this farm.</div>';
      }
    } catch (e) {
      console.error('Error initializing farmer profile map', e);
      mapElement.innerHTML = '<div style="padding:18px; color:#c53030;">Unable to initialize map.</div>';
    }
  }, 100);
}

// Show Edit Form
function showEditFarmerForm() {
  if (!currentFarmer) return;
  
  const farmer = currentFarmer;
  const speciesCheckboxes = farmerRegisterForm ? farmerRegisterForm.querySelectorAll('input[name="species"]') : [];
  
  if (!farmerDashboardContent) return;
  farmerDashboardContent.innerHTML = `
    <div style="max-width: 600px; margin: 0 auto;">
      <h3>Edit Your Farm Profile</h3>
      <form id="edit-farmer-form" class="farmer-edit-form">
        <div>
          <label for="edit-name">Full Name</label>
          <input id="edit-name" name="name" type="text" value="${farmer.name}" required />
        </div>

        <div>
          <label for="edit-phone">Phone</label>
          <input id="edit-phone" name="phone" type="tel" value="${farmer.phone || ''}"/>
        </div>

        <div>
          <label for="edit-county">County</label>
          <select id="edit-county" name="county" required>
            <option value="Kisii" ${farmer.county === 'Kisii' ? 'selected' : ''}>Kisii</option>
            <option value="Nyamira" ${farmer.county === 'Nyamira' ? 'selected' : ''}>Nyamira</option>
            <option value="Homa Bay" ${farmer.county === 'Homa Bay' ? 'selected' : ''}>Homa Bay</option>
          </select>
        </div>

        <div>
          <label for="edit-latitude">Latitude</label>
          <input id="edit-latitude" name="latitude" type="number" step="0.000001" value="${farmer.latitude}" required />
        </div>

        <div>
          <label for="edit-longitude">Longitude</label>
          <input id="edit-longitude" name="longitude" type="number" step="0.000001" value="${farmer.longitude}" required />
        </div>

        <div>
          <label>Species Farmed</label>
          <div class="checkbox-grid">
            <label class="checkbox-item"><input type="checkbox" name="species" value="Tilapia" ${farmer.species.includes('Tilapia') ? 'checked' : ''}> 🐟 Tilapia</label>
            <label class="checkbox-item"><input type="checkbox" name="species" value="Catfish" ${farmer.species.includes('Catfish') ? 'checked' : ''}> 🐠 Catfish</label>
            <label class="checkbox-item"><input type="checkbox" name="species" value="Trout" ${farmer.species.includes('Trout') ? 'checked' : ''}> 🎣 Trout</label>
            <label class="checkbox-item"><input type="checkbox" name="species" value="Carp" ${farmer.species.includes('Carp') ? 'checked' : ''}> 🐡 Common Carp</label>
            <label class="checkbox-item"><input type="checkbox" name="species" value="Nile Perch" ${farmer.species.includes('Nile Perch') ? 'checked' : ''}> 🦈 Nile Perch</label>
            <label class="checkbox-item"><input type="checkbox" name="species" value="Mudfish" ${farmer.species.includes('Mudfish') ? 'checked' : ''}> Mudfish</label>
            <label class="checkbox-item"><input type="checkbox" name="species" value="Bass" ${farmer.species.includes('Bass') ? 'checked' : ''}> 🎏 Bass</label>
          </div>
        </div>

        <div>
          <label for="edit-culture">Culture System</label>
          <select id="edit-culture" name="culture_system" required>
            <option value="Pond" ${farmer.culture_system === 'Pond' ? 'selected' : ''}>Pond</option>
            <option value="Tank" ${farmer.culture_system === 'Tank' ? 'selected' : ''}>Tank</option>
            <option value="Cage" ${farmer.culture_system === 'Cage' ? 'selected' : ''}>Cage</option>
            <option value="Recirculating system" ${farmer.culture_system === 'Recirculating system' ? 'selected' : ''}>Recirculating system</option>
          </select>
        </div>

        <div>
          <label for="edit-scale">Production Scale</label>
          <select id="edit-scale" name="production_scale">
            <option value="">None</option>
            <option value="Small" ${farmer.production_scale === 'Small' ? 'selected' : ''}>Small</option>
            <option value="Medium" ${farmer.production_scale === 'Medium' ? 'selected' : ''}>Medium</option>
            <option value="Large" ${farmer.production_scale === 'Large' ? 'selected' : ''}>Large</option>
          </select>
        </div>

        <div>
          <label for="edit-equipment">Equipment</label>
          <input id="edit-equipment" name="equipment" type="text" value="${farmer.equipment || ''}" />
        </div>

        <div>
          <label for="edit-contact">Contact Info</label>
          <input id="edit-contact" name="contact" type="text" value="${farmer.contact || ''}" />
        </div>

        <div>
          <label for="edit-image">Update Farm Image</label>
          <input id="edit-image" name="image" type="file" accept="image/*" />
        </div>

        <div class="form-actions">
          <button type="submit" class="save-btn">💾 Save Changes</button>
          <button type="button" class="cancel-btn" onclick="loadFarmerProfile()">Cancel</button>
        </div>
      </form>
    </div>
  `;

  // Handle form submission
  const editFarmerForm = document.getElementById('edit-farmer-form');
  if (editFarmerForm) {
    editFarmerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      
      const speciesCheckboxes = e.target.querySelectorAll('input[name="species"]:checked');
      const species = Array.from(speciesCheckboxes).map(cb => cb.value);
      
      formData.delete('species');
      formData.append('species', JSON.stringify(species));

    try {
      const res = await fetch(apiUrl('/api/farmers/me'), {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${farmerToken}` },
        body: formData
      });

      if (!res.ok) throw new Error('Update failed');
      
      alert('Profile updated successfully!');
      loadFarmerProfile();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  });
}
}

// Farmer Logout
function farmerLogout() {
  localStorage.removeItem('farmerToken');
  farmerToken = '';
  currentFarmer = null;
  showFarmerLoginModal();
  updateFarmersView();
}

// Show Farmer Login Modal
function showFarmerLoginModal() {
  if (farmerModal) farmerModal.classList.remove('hidden');
  const loginTabEl = document.getElementById('login-tab');
  if (loginTabEl) loginTabEl.classList.add('active');
  const loginTabBtn = document.querySelector('[data-tab="login"]');
  if (loginTabBtn) loginTabBtn.classList.add('active');
}

// Add "My Farm" button to trigger dashboard
const farmerDashboardTab = document.querySelector('[data-target="farmer-dashboard-tab"]');
if (farmerDashboardTab) {
  farmerDashboardTab.addEventListener('click', () => {
    if (!farmerToken) {
      showFarmerLoginModal();
    } else {
      loadFarmerProfile();
    }
  });
}

// Initialize farmer token from localStorage after functions are defined
if (farmerToken) {
  loadFarmerProfile();
}

async function loadFarmers() {
  try {
    const response = await fetch(apiUrl('/api/farmers'));
    farmersCache = await response.json();
    updateFarmersView();
    updateAnalyticsDashboard();
    await loadSuppliers();
  } catch (error) {
    console.error('Unable to load farmers', error);
    if (status) {
      status.textContent = 'Unable to load farmers. Check server status.';
    } else {
      console.warn('Status element missing, cannot show loadFarmers error.');
    }
  }
}

const STORAGE_KEYS = {
  expertRequests: 'kmfriExpertRequests',
  diseaseReports: 'kmfriDiseaseReports',
  waterReadings: 'kmfriWaterReadings',
  eventRegistrations: 'kmfriEventRegistrations'
};

const KNOWLEDGE_BASE = [
  { title: 'Pond construction best practices', summary: 'Learn how to site, line and maintain ponds for healthy aquaculture systems.', tags: ['Pond construction', 'Infrastructure', 'Water management'] },
  { title: 'Pond preparation and fertilization', summary: 'Steps for preparing pond bottoms and managing soil and fertilizer before stocking.', tags: ['Pond preparation', 'Soil', 'Fertilization'] },
  { title: 'Water quality management', summary: 'Key parameters for pH, temperature, dissolved oxygen, ammonia and turbidity.', tags: ['Water quality', 'DO', 'Ammonia'] },
  { title: 'Stocking density guidance', summary: 'Recommended stocking densities for Tilapia, Catfish and other culture systems.', tags: ['Stocking density', 'Tilapia', 'Catfish'] },
  { title: 'Feeding schedules and feed rates', summary: 'Use feeding calculators and species-specific schedules to reduce waste and improve growth.', tags: ['Feeding', 'Grower feed', 'Feed rates'] },
  { title: 'Fish health and disease management', summary: 'Recognize common symptoms and know when to seek expert help from KMFRI.', tags: ['Fish health', 'Disease reporting', 'Symptoms'] },
  { title: 'Harvesting techniques and handling', summary: 'Best practices for harvest timing, grading, chilling and transport to retain product quality.', tags: ['Harvesting', 'Post-harvest', 'Handling'] },
  { title: 'Post-harvest handling and value addition', summary: 'Careful processing steps to improve shelf life and market access.', tags: ['Post-harvest', 'Processing', 'Value addition'] }
];

const FAQ_ENTRIES = [
  { question: 'How often should I test pond water?', answer: 'Test water quality at least twice weekly, especially for pH, dissolved oxygen, ammonia and temperature.' },
  { question: 'What stocking density should I use for Tilapia?', answer: 'Begin with 2-4 fish per square metre in earthen ponds and adjust based on water quality and system management.' },
  { question: 'Which feed is best for 3-month-old Catfish?', answer: 'Use a grower feed with 28-32% protein and feed at about 3-4% body weight per day.' },
  { question: 'How can I reduce fish disease risks?', answer: 'Keep ponds clean, avoid overstocking, monitor water quality, and report symptoms early to KMFRI.' },
  { question: 'What is the recommended pH range for Tilapia ponds?', answer: 'Maintain pond pH between 6.5 and 8.5 for best growth and feed conversion.' }
];

const TRAINING_EVENTS = [
  { id: 't1', title: 'Pond Construction Workshop', date: '2026-07-15', location: 'Kisii Training Centre', seats: 40 },
  { id: 't2', title: 'Feed Management for Tilapia', date: '2026-08-02', location: 'Homa Bay Field Office', seats: 30 },
  { id: 't3', title: 'Disease Surveillance and Reporting', date: '2026-08-22', location: 'Nyamira County Hall', seats: 25 }
];

const PUBLICATIONS = [
  { title: 'Tilapia Production Guide', topic: 'Tilapia', summary: 'A practical guide on pond design, stocking, feeding and harvest.', link: '#' },
  { title: 'Catfish Management Manual', topic: 'Catfish', summary: 'Technical manual for catfish farmers, including nutrition and disease control.', link: '#' },
  { title: 'Cage Culture Best Practices', topic: 'Cage culture', summary: 'Key design and management practices for cage systems in lakes and reservoirs.', link: '#' }
];

const MARKET_PRICES = [
  { market: 'Kisii', tilapia: 'KES 450/kg', catfish: 'KES 420/kg' },
  { market: 'Nyamira', tilapia: 'KES 430/kg', catfish: 'KES 405/kg' },
  { market: 'Homa Bay', tilapia: 'KES 480/kg', catfish: 'KES 455/kg' }
];

const OFFICERS_DIRECTORY = [
  { name: 'Mr. John M. Ombogo', county: 'Kisii', phone: '+254700123456', area: 'Pond culture support' },
  { name: 'Ms. Esther A. Njoroge', county: 'Nyamira', phone: '+254700654321', area: 'Feed and nutrition' },
  { name: 'Mr. Peter K. Ogola', county: 'Homa Bay', phone: '+254700987654', area: 'Health and disease management' }
];

const FEED_RECOMMENDATIONS = {
  Tilapia: [
    { min: 0, max: 2, feed: 'Starter Feed', ratePercent: 6, note: 'For fingerlings and small juveniles.' },
    { min: 3, max: 5, feed: 'Grower Feed', ratePercent: 3, note: 'Use during rapid growth phase.' },
    { min: 6, max: 24, feed: 'Finisher Feed', ratePercent: 2, note: 'Lower rate for larger fish before harvest.' }
  ],
  Catfish: [
    { min: 0, max: 2, feed: 'Catfish Starter', ratePercent: 5, note: 'Highest feed rate for small fish.' },
    { min: 3, max: 6, feed: 'Grower Feed', ratePercent: 3.5, note: 'Maintain good growth and feed efficiency.' },
    { min: 7, max: 24, feed: 'Finisher Feed', ratePercent: 2.5, note: 'Reduce feed as fish approach harvest.' }
  ],
  'Nile Perch': [
    { min: 0, max: 6, feed: 'Juvenile Feed', ratePercent: 5, note: 'For early stocking stage.' },
    { min: 7, max: 24, feed: 'Grower Feed', ratePercent: 3.5, note: 'Use quality pellets to support growth.' }
  ],
  Trout: [
    { min: 0, max: 6, feed: 'Trout Starter', ratePercent: 5, note: 'Cool-water feed for juveniles.' },
    { min: 7, max: 24, feed: 'Grower Feed', ratePercent: 3, note: 'Feed based on temperature and weight.' }
  ]
};

function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch (e) {
    return [];
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Unable to write localStorage', e);
  }
}

function renderKnowledgeBase(query = '') {
  const target = document.getElementById('kb-results');
  if (!target) return;
  const normalized = query.trim().toLowerCase();
  const items = KNOWLEDGE_BASE.filter(item => {
    const text = `${item.title} ${item.summary} ${item.tags.join(' ')}`.toLowerCase();
    return !normalized || text.includes(normalized);
  });
  if (!items.length) {
    target.innerHTML = '<div class="hint">No knowledge articles found for that search.</div>';
    return;
  }
  target.innerHTML = items.map(item => {
    return `
      <article class="resource-card">
        <h4>${item.title}</h4>
        <p>${item.summary}</p>
        <div class="tag-row">${item.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}</div>
      </article>
    `;
  }).join('');
}

function renderFAQ(query = '') {
  const target = document.getElementById('faq-list');
  if (!target) return;
  const normalized = query.trim().toLowerCase();
  const entries = FAQ_ENTRIES.filter(item => {
    return !normalized || `${item.question} ${item.answer}`.toLowerCase().includes(normalized);
  });
  if (!entries.length) {
    target.innerHTML = '<div class="hint">No FAQs matched your search.</div>';
    return;
  }
  target.innerHTML = entries.map(item => {
    return `
      <article class="faq-item">
        <button type="button" class="faq-question">${item.question}</button>
        <div class="faq-answer">${item.answer}</div>
      </article>
    `;
  }).join('');
  target.querySelectorAll('.faq-question').forEach(button => {
    button.addEventListener('click', () => {
      button.classList.toggle('expanded');
      const answer = button.nextElementSibling;
      if (answer) answer.classList.toggle('active');
    });
  });
}

function renderTrainingEvents() {
  const target = document.getElementById('events-list');
  if (!target) return;
  const registrations = new Set(readStore(STORAGE_KEYS.eventRegistrations));
  target.innerHTML = TRAINING_EVENTS.map(event => {
    const registered = registrations.has(event.id);
    return `
      <li class="resource-item">
        <strong>${event.title}</strong>
        <div>${new Date(event.date).toLocaleDateString()} • ${event.location}</div>
        <button type="button" class="secondary-button event-register-btn" data-id="${event.id}">${registered ? 'Registered' : 'Register'}</button>
      </li>
    `;
  }).join('');
  target.querySelectorAll('.event-register-btn').forEach(button => {
    button.addEventListener('click', () => {
      const eventId = button.dataset.id;
      const registrationsArray = readStore(STORAGE_KEYS.eventRegistrations);
      const index = registrationsArray.indexOf(eventId);
      if (index === -1) {
        registrationsArray.push(eventId);
        button.textContent = 'Registered';
        showToast('Training registration saved locally.');
      } else {
        registrationsArray.splice(index, 1);
        button.textContent = 'Register';
        showToast('Registration canceled.');
      }
      writeStore(STORAGE_KEYS.eventRegistrations, registrationsArray);
    });
  });
}

function renderPublications() {
  const target = document.getElementById('publication-list');
  if (!target) return;
  target.innerHTML = PUBLICATIONS.map(item => `
    <li class="resource-item">
      <strong>${item.title}</strong>
      <div>${item.topic}</div>
      <div>${item.summary}</div>
      <a class="secondary-button" href="${item.link}" target="_blank">View document</a>
    </li>
  `).join('');
}

function renderOfficerDirectory() {
  const target = document.getElementById('officer-directory');
  if (!target) return;
  target.innerHTML = OFFICERS_DIRECTORY.map(officer => `
    <div class="resource-item">
      <strong>${officer.name}</strong>
      <div><strong>County:</strong> ${officer.county}</div>
      <div><strong>Area:</strong> ${officer.area}</div>
      <div><strong>Contact:</strong> ${officer.phone}</div>
      <a class="secondary-button" href="tel:${officer.phone.replace(/[^0-9+]/g, '')}">Contact officer</a>
    </div>
  `).join('');
}

function renderMarketPrices() {
  const target = document.getElementById('market-table-body');
  if (!target) return;
  target.innerHTML = MARKET_PRICES.map(row => `
    <tr>
      <td>${row.market}</td>
      <td>${row.tilapia}</td>
      <td>${row.catfish}</td>
    </tr>
  `).join('');
}

let equipmentSupplierCache = [];

function renderEquipmentSupplierDirectory(query = '') {
  const target = document.getElementById('equipment-supplier-list');
  if (!target) return;
  const normalized = query.trim().toLowerCase();
  const verifiedOnly = document.getElementById('equipment-verified-only')?.checked || false;
  const suppliers = equipmentSupplierCache.filter(feature => {
    const props = feature.properties || {};
    if (verifiedOnly && !props.verified) return false;
    const text = [props.name, props.vendor, props.products, props.county, props.phone].join(' ').toLowerCase();
    return !normalized || text.includes(normalized);
  });
  if (!suppliers.length) {
    target.innerHTML = '<li class="hint">No equipment suppliers match your filters.</li>';
    return;
  }
  target.innerHTML = suppliers.map(feature => {
    const props = feature.properties || {};
    return `
      <li class="resource-item">
        <strong>${props.vendor || props.name || 'Equipment Supplier'}</strong>
        ${props.verified ? '<span class="verified-badge">Verified</span>' : ''}
        <div class="resource-meta">${props.products || 'Equipment and aquaculture supplies'}</div>
        <div>${props.county ? `${props.county} county` : 'Location not specified'}</div>
        <div>Phone: <a href="tel:${props.phone}">${props.phone || 'Not provided'}</a></div>
      </li>
    `;
  }).join('');
}

async function loadEquipmentSupplierDirectory() {
  try {
    const geo = await loadGeoJsonIfNeeded('equipment_suppliers');
    equipmentSupplierCache = (geo && Array.isArray(geo.features)) ? geo.features : [];
    renderEquipmentSupplierDirectory();
  } catch (e) {
    console.warn('Failed to load equipment suppliers', e);
  }
}

function updateExpertStatus(message, success = true) {
  const statusEl = document.getElementById('expert-status');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = success ? '#166534' : '#b91c1c';
}

function handleExpertSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('expert-name')?.value.trim();
  const contact = document.getElementById('expert-contact')?.value.trim();
  const topic = document.getElementById('expert-topic')?.value;
  const question = document.getElementById('expert-question')?.value.trim();
  if (!name || !contact || !question) {
    updateExpertStatus('Please complete all fields.', false);
    return;
  }
  const requests = readStore(STORAGE_KEYS.expertRequests);
  requests.unshift({ id: `expert-${Date.now()}`, name, contact, topic, question, createdAt: new Date().toISOString() });
  writeStore(STORAGE_KEYS.expertRequests, requests);
  event.target.reset();
  updateExpertStatus('Your question has been sent to KMFRI. An officer will respond soon.');
}

function getWaterQualityStatus(reading) {
  const warnings = [];
  if (reading.ph < 6.5 || reading.ph > 8.5) warnings.push('pH out of range');
  if (reading.temperature < 22 || reading.temperature > 30) warnings.push('Temperature outside 22-30°C');
  if (reading.do < 5) warnings.push('Low dissolved oxygen');
  if (reading.ammonia > 0.5) warnings.push('High ammonia');
  if (reading.turbidity > 25) warnings.push('High turbidity');
  return warnings;
}

function renderWaterQualityHistory() {
  const target = document.getElementById('water-quality-history');
  if (!target) return;
  const readings = readStore(STORAGE_KEYS.waterReadings);
  if (!readings.length) {
    target.innerHTML = '<div class="hint">No water quality readings recorded yet.</div>';
    return;
  }
  target.innerHTML = readings.slice(0, 6).map(reading => {
    const warnings = getWaterQualityStatus(reading);
    return `
      <article class="resource-item">
        <div><strong>${new Date(reading.createdAt).toLocaleString()}</strong></div>
        <div>pH: ${reading.ph} • Temp: ${reading.temperature} °C</div>
        <div>DO: ${reading.do} mg/L • Ammonia: ${reading.ammonia} mg/L • Turbidity: ${reading.turbidity} NTU</div>
        <div class="quality-alert ${warnings.length ? 'alert' : 'good'}">${warnings.length ? warnings.join(', ') : 'Within recommended ranges'}</div>
      </article>
    `;
  }).join('');
}

function handleWaterQualitySubmit(event) {
  event.preventDefault();
  const ph = Number(document.getElementById('water-ph')?.value);
  const temperature = Number(document.getElementById('water-temp')?.value);
  const dissolvedOxygen = Number(document.getElementById('water-do')?.value);
  const ammonia = Number(document.getElementById('water-ammonia')?.value);
  const turbidity = Number(document.getElementById('water-turbidity')?.value);

  if ([ph, temperature, dissolvedOxygen, ammonia, turbidity].some(value => Number.isNaN(value))) {
    const waterStatus = document.getElementById('water-status');
    if (waterStatus) {
      waterStatus.textContent = 'Please fill in valid water quality values.';
      waterStatus.style.color = '#b91c1c';
    }
    return;
  }

  const readings = readStore(STORAGE_KEYS.waterReadings);
  readings.unshift({ ph, temperature, do: dissolvedOxygen, ammonia, turbidity, createdAt: new Date().toISOString() });
  writeStore(STORAGE_KEYS.waterReadings, readings);
  renderWaterQualityHistory();
  const waterStatus = document.getElementById('water-status');
  if (waterStatus) {
    waterStatus.textContent = 'Water quality reading recorded successfully.';
    waterStatus.style.color = '#166534';
  }
  event.target.reset();
}

function renderDiseaseReports() {
  const target = document.getElementById('disease-report-list');
  if (!target) return;
  const reports = readStore(STORAGE_KEYS.diseaseReports);
  if (!reports.length) {
    target.innerHTML = '<div class="hint">No disease reports have been submitted yet.</div>';
    return;
  }
  target.innerHTML = reports.map(report => {
    const status = report.priority ? 'Urgent' : 'Review';
    return `
      <article class="resource-item">
        <div><strong>${report.name}</strong> • ${new Date(report.createdAt).toLocaleDateString()}</div>
        <div>${report.contact || 'Contact not provided'}</div>
        <div>${report.symptoms}</div>
        <div><strong>Mortalities:</strong> ${report.quantity || 'Unknown'}</div>
        <div class="report-status">${status}</div>
      </article>
    `;
  }).join('');
}

function handleDiseaseSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('disease-name')?.value.trim();
  const contact = document.getElementById('disease-contact')?.value.trim();
  const symptoms = document.getElementById('disease-symptoms')?.value.trim();
  const quantity = document.getElementById('disease-quantity')?.value;
  if (!name || !symptoms) {
    const diseaseStatus = document.getElementById('disease-status');
    if (diseaseStatus) {
      diseaseStatus.textContent = 'Please provide your name and a description of symptoms.';
      diseaseStatus.style.color = '#b91c1c';
    }
    return;
  }
  const reports = readStore(STORAGE_KEYS.diseaseReports);
  reports.unshift({ id: `disease-${Date.now()}`, name, contact, symptoms, quantity: quantity || 0, createdAt: new Date().toISOString() });
  writeStore(STORAGE_KEYS.diseaseReports, reports);
  renderDiseaseReports();
  const diseaseStatus = document.getElementById('disease-status');
  if (diseaseStatus) {
    diseaseStatus.textContent = 'Report submitted. KMFRI officers will review and respond.';
    diseaseStatus.style.color = '#166534';
  }
  event.target.reset();
}

function getFeedRecommendation(species, ageMonths, weightGrams) {
  const recommendations = FEED_RECOMMENDATIONS[species] || [];
  const match = recommendations.find(item => ageMonths >= item.min && ageMonths <= item.max) || recommendations[recommendations.length - 1];
  const rate = match ? match.ratePercent : 3;
  const feed = match ? match.feed : 'General grower feed';
  const note = match ? match.note : 'Use a high-quality feed and monitor fish condition.';
  const feedGrams = Number(weightGrams) > 0 ? ((weightGrams * rate) / 100).toFixed(1) : null;
  return { feed, rate, note, feedGrams };
}

function calculateFeedRecommendation() {
  const species = document.getElementById('feed-species')?.value;
  const age = Number(document.getElementById('feed-age')?.value);
  const weight = Number(document.getElementById('feed-weight')?.value);
  const target = document.getElementById('feed-recommendation');
  if (!target) return;
  if (!species || Number.isNaN(age) || Number.isNaN(weight) || age <= 0 || weight <= 0) {
    target.innerHTML = '<p class="hint">Please choose a species and provide age and average weight.</p>';
    return;
  }
  const recommendation = getFeedRecommendation(species, age, weight);
  target.innerHTML = `
    <div><strong>Recommended Feed:</strong> ${recommendation.feed}</div>
    <div><strong>Feeding Rate:</strong> ${recommendation.rate}% body weight</div>
    ${recommendation.feedGrams !== null ? `<div><strong>Daily amount:</strong> ${recommendation.feedGrams} g per fish</div>` : ''}
    <div class="hint">${recommendation.note}</div>
  `;
}

function initResourceHub() {
  renderKnowledgeBase();
  renderFAQ();
  renderTrainingEvents();
  renderPublications();
  renderMarketPrices();
  renderOfficerDirectory();
  renderWaterQualityHistory();
  renderDiseaseReports();

  document.getElementById('kb-search')?.addEventListener('input', (e) => renderKnowledgeBase(e.target.value));
  document.getElementById('faq-search')?.addEventListener('input', (e) => renderFAQ(e.target.value));
  document.getElementById('expert-form')?.addEventListener('submit', handleExpertSubmit);
  document.getElementById('disease-form')?.addEventListener('submit', handleDiseaseSubmit);
  document.getElementById('water-form')?.addEventListener('submit', handleWaterQualitySubmit);
  document.getElementById('calc-feed')?.addEventListener('click', calculateFeedRecommendation);
  document.getElementById('equipment-supplier-search')?.addEventListener('input', (e) => renderEquipmentSupplierDirectory(e.target.value));
  document.getElementById('equipment-verified-only')?.addEventListener('change', () => renderEquipmentSupplierDirectory(document.getElementById('equipment-supplier-search')?.value || ''));

  calculateFeedRecommendation();
  loadEquipmentSupplierDirectory();
}

// Initialize the resource hub after the DOM is ready
setTimeout(initResourceHub, 500);

// Small confirmation panel shown after a new marker/farmer is added
function showAddConfirmation(farmerId, farmerName, lat, lng) {
  try {
    // remove existing confirmation if any
    const existing = document.getElementById('add-confirmation');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'add-confirmation';
    container.className = 'add-confirmation';
    container.style.position = 'fixed';
    container.style.right = '12px';
    container.style.bottom = '18px';
    container.style.zIndex = 2600;
    container.style.background = '#0f172a';
    container.style.color = '#fff';
    container.style.padding = '12px 14px';
    container.style.borderRadius = '10px';
    container.style.boxShadow = '0 8px 28px rgba(2,6,23,0.6)';
    container.style.maxWidth = '320px';
    container.style.fontSize = '14px';

    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.marginBottom = '6px';
    title.textContent = 'Farmer registered';

    const msg = document.createElement('div');
    msg.style.marginBottom = '10px';
    msg.textContent = farmerName || 'New farmer';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const viewBtn = document.createElement('button');
    viewBtn.className = 'primary-button';
    viewBtn.textContent = 'View on map';
    viewBtn.addEventListener('click', () => {
      try {
        if (map && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
          map.setView([Number(lat), Number(lng)], 14);
        }
        // try to open popup for this farmer if present in markerGroup
        const f = farmersCache.find(x => Number(x.id) === Number(farmerId));
        if (f) showFarmerDetails(f);
        container.remove();
      } catch (e) { console.warn(e); }
    });

    const profileBtn = document.createElement('button');
    profileBtn.className = 'secondary-button';
    profileBtn.textContent = 'View profile';
    profileBtn.addEventListener('click', () => {
      try {
        const f = farmersCache.find(x => Number(x.id) === Number(farmerId));
        if (f) {
          showFarmerDetails(f);
          // also open farmers tab and select in list
          try { openTab('farmers-tab'); } catch (e) {}
          // after opening the tab, ensure the list item is highlighted and scrolled into view
          setTimeout(() => {
            try {
              selectedFarmerId = f.id;
              highlightSelectedFarmer();
              const item = document.querySelector(`#farmer-list li[data-id="${f.id}"]`);
              if (item) {
                item.scrollIntoView({ behavior: 'smooth', block: 'center' });
                item.classList.add('farmer-selected');
              }
            } catch (err) { console.warn('selecting farmer in list failed', err); }
          }, 220);
        }
        container.remove();
      } catch (e) { console.warn(e); }
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tertiary-button';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => container.remove());

    actions.appendChild(viewBtn);
    actions.appendChild(profileBtn);
    actions.appendChild(closeBtn);

    container.appendChild(title);
    container.appendChild(msg);
    container.appendChild(actions);
    document.body.appendChild(container);

    // Auto-dismiss after 10s
    setTimeout(() => { try { container.remove(); } catch (e) {} }, 10000);
  } catch (e) { console.warn('showAddConfirmation failed', e); }
}

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = 'Registering farmer...';

    const formData = new FormData(form);
    // collect selected species from checkboxes
    const selectedSpecies = Array.from(document.querySelectorAll('#speciesGrid input[type="checkbox"]'))
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.value)
      .filter(Boolean);

    const speciesError = document.getElementById('species-error');
    if (!selectedSpecies.length) {
      status.textContent = 'Please select at least one species.';
      if (speciesError) speciesError.textContent = 'Select at least one species to continue.';
      return;
    }
    if (speciesError) speciesError.textContent = '';
    formData.delete('species');
  formData.append('species', JSON.stringify(selectedSpecies));

  // collect equipment list from dynamic UI (if present)
  try {
    const equipmentItems = Array.from(document.querySelectorAll('#equipment-list li')).map(li => li.textContent.replace('\u00A0×','').trim()).filter(Boolean);
    formData.delete('equipment');
    if (equipmentItems.length) formData.append('equipment', JSON.stringify(equipmentItems));
    else formData.append('equipment', '');
  } catch (e) {}

  try {
    const response = await fetch(apiUrl('/api/farmers'), {
      method: 'POST',
      body: formData
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Registration failed');
    }
    // Center map on new registration and highlight
    try {
      const lat = Number(result.latitude || result.lat || result.latitude);
      const lng = Number(result.longitude || result.lng || result.longitude);
      form.reset();
      status.textContent = 'Farmer registered successfully.';
      // open map and center
      try { if (typeof openTab === 'function') openTab('map-tab'); } catch (e) {}
      try { if (map && Number.isFinite(lat) && Number.isFinite(lng)) { map.setView([lat, lng], 13); showTemporaryHighlight(lat, lng, result); } } catch (e) {}
    } catch (e) { console.warn('Post-registration UI update failed', e); }
    // Reload farmers to ensure persistent markers are present
    try { await loadFarmers(); await loadPublicStats(); showAddConfirmation(result.id, result.name, lat, lng); } catch (e) { console.warn('loadFarmers after register failed', e); }
  } catch (error) {
    console.error(error);
    status.textContent = `Error: ${error.message}`;
  }
  });
}

// Supplier registration modal handlers
// Equipment list dynamic UI: add/remove items and keep hidden field in sync
const addEquipmentBtn = document.getElementById('add-equipment');
const equipmentInput = document.getElementById('equipment-input');
const equipmentListEl = document.getElementById('equipment-list');
const equipmentHidden = document.getElementById('equipment-hidden');

function updateEquipmentHidden() {
  try {
    if (!equipmentHidden) return;
    const items = Array.from(document.querySelectorAll('#equipment-list li')).map(li => li.textContent.replace('\u00A0×','').trim()).filter(Boolean);
    equipmentHidden.value = items.length ? JSON.stringify(items) : '';
  } catch (e) { /* ignore */ }
}

function addEquipmentItem(text) {
  if (!text) return;
  const li = document.createElement('li');
  li.className = 'equipment-item';
  const span = document.createElement('span');
  span.textContent = text;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'remove-equipment';
  btn.title = 'Remove';
  btn.textContent = '\u00A0×';
  btn.addEventListener('click', () => { li.remove(); updateEquipmentHidden(); });
  li.appendChild(span);
  li.appendChild(btn);
  equipmentListEl && equipmentListEl.appendChild(li);
  updateEquipmentHidden();
}

if (addEquipmentBtn && equipmentInput && equipmentListEl) {
  addEquipmentBtn.addEventListener('click', () => {
    const v = equipmentInput.value.trim();
    if (!v) return;
    addEquipmentItem(v);
    equipmentInput.value = '';
    equipmentInput.focus();
  });
  equipmentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = equipmentInput.value.trim();
      if (!v) return;
      addEquipmentItem(v);
      equipmentInput.value = '';
    }
  });
}

// Live preview: show current input as a preview list item while typing
if (equipmentInput && equipmentListEl) {
  let previewLi = null;
  function ensurePreview(text) {
    try {
      if (!previewLi) {
        previewLi = document.createElement('li');
        previewLi.className = 'equipment-preview';
        previewLi.style.opacity = '0.7';
        previewLi.style.fontStyle = 'italic';
        previewLi.style.listStyleType = 'disc';
        previewLi.style.marginLeft = '6px';
        equipmentListEl.appendChild(previewLi);
      }
      previewLi.textContent = text || 'Typing...';
    } catch (e) {}
  }
  function removePreview() {
    try { if (previewLi) { previewLi.remove(); previewLi = null; } } catch (e) {}
  }

  equipmentInput.addEventListener('input', (e) => {
    const v = (e.target.value || '').trim();
    if (v) ensurePreview(v);
    else removePreview();
  });

  // remove preview when an item is added
  addEquipmentBtn.addEventListener('click', () => removePreview());
  equipmentInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') setTimeout(removePreview, 10); });
  // ensure preview cleared on form submit
  form.addEventListener('submit', () => removePreview());
}

  const supplierModal = document.getElementById('supplier-modal');
  const openSupplierRegisterBtn = document.getElementById('open-supplier-register');
  const supplierModalCloseBtn = document.getElementById('supplier-modal-close');
  const supplierRegisterForm = document.getElementById('supplier-register-form');
  const supplierLocateBtn = document.getElementById('supplier-locate-me');
  const supplierModalStatus = document.getElementById('supplier-modal-status');

  openSupplierRegisterBtn?.addEventListener('click', () => {
    if (supplierModal) {
      supplierModal.classList.remove('hidden');
      supplierModalStatus.textContent = '';
    }
  });
  supplierModalCloseBtn?.addEventListener('click', () => {
    supplierModal?.classList.add('hidden');
  });

  supplierLocateBtn?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      supplierModalStatus.textContent = 'Geolocation not supported';
      return;
    }
    navigator.geolocation.getCurrentPosition((pos) => {
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      supplierRegisterForm.querySelector('input[name="latitude"]').value = lat;
      supplierRegisterForm.querySelector('input[name="longitude"]').value = lng;
      supplierModalStatus.textContent = 'Location captured successfully.';
    }, (err) => {
      supplierModalStatus.textContent = `Unable to get location: ${err.message}`;
    }, { enableHighAccuracy: true });
  });

  supplierRegisterForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    supplierModalStatus.textContent = '';
    const fd = new FormData(supplierRegisterForm);
    const farmName = String(fd.get('farm_name') || '').trim();
    const ownerName = String(fd.get('owner_name') || '').trim();
    const phone = String(fd.get('phone') || '').trim();
    const county = String(fd.get('county') || '').trim();
    const latitude = parseFloat(fd.get('latitude'));
    const longitude = parseFloat(fd.get('longitude'));
    const species = String(fd.get('species') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const category = String(fd.get('category') || 'other').trim();
    const quantity = fd.get('quantity');
    const price = fd.get('price');

    if (!farmName || !ownerName || !phone || !county || Number.isNaN(latitude) || Number.isNaN(longitude) || !species.length) {
      supplierModalStatus.textContent = 'Please fill all required supplier fields and provide valid coordinates.';
      return;
    }

    const body = {
      farm_name: farmName,
      owner_name: ownerName,
      phone,
      county,
      latitude,
      longitude,
      species,
      category,
      quantity: quantity ? Number(quantity) : undefined,
      price: price ? Number(price) : undefined
    };

    try {
      const res = await fetch(apiUrl('/api/suppliers'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Registration failed');
      }
      supplierModalStatus.textContent = 'Registration submitted successfully. Awaiting verification.';
      supplierModal?.classList.add('hidden');
      supplierRegisterForm.reset();
      await loadSuppliers();
      updateSupplierMarketplace();
    } catch (err) {
      supplierModalStatus.textContent = `Failed to register supplier: ${err.message}`;
      console.error(err);
    }
  });

// ============================================================================
// ADMIN DASHBOARD
// ============================================================================

const adminLoginSection = document.getElementById('admin-login-section');
const adminDashboardSection = document.getElementById('admin-dashboard-section');

function showAdminDashboard() {
  adminLoginSection.classList.add('hidden');
  adminDashboardSection.classList.remove('hidden');
  document.getElementById('admin-welcome').textContent = 'Welcome, Administrator';
  loadAdminAnalytics();
  loadAdminFarmersTable();
}

// Toast helper (simple, self-cleaning)
function showToast(message, type = '') {
  try {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ` ${type}` : '');
    t.textContent = message;
    container.appendChild(t);
    // auto-remove after 3s with fade
    setTimeout(() => { t.classList.add('fadeout'); setTimeout(() => t.remove(), 420); }, 3000);
  } catch (e) { /* ignore */ }
}

// Admin: Landing image upload handlers
const landingInput = document.getElementById('landing-image-input');
const uploadLandingBtn = document.getElementById('upload-landing-btn');
const landingPreview = document.getElementById('landing-preview');
const landingUploadStatus = document.getElementById('landing-upload-status');
const resetLandingBtn = document.getElementById('reset-landing-btn');
const applyLandingBtn = document.getElementById('apply-landing-btn');
const autoApplyCheckbox = document.getElementById('auto-apply-checkbox');
const applyModal = document.getElementById('apply-confirm-modal');
const confirmApplyBtn = document.getElementById('confirm-apply-btn');
const cancelApplyBtn = document.getElementById('cancel-apply-btn');

let lastUploadedLandingUrl = null;

if (landingInput) {
  landingInput.addEventListener('change', () => {
    const f = landingInput.files && landingInput.files[0];
    if (!f) return;
    try {
      const url = URL.createObjectURL(f);
      if (landingPreview) landingPreview.src = url;
      if (landingUploadStatus) landingUploadStatus.textContent = `Ready to upload: ${f.name}`;
    } catch (e) {
      console.warn('Preview failed', e);
    }
  });
}

if (applyLandingBtn) {
  applyLandingBtn.addEventListener('click', () => {
    if (!lastUploadedLandingUrl) {
      if (landingUploadStatus) landingUploadStatus.textContent = 'No uploaded image to apply.';
      return;
    }
    // show confirmation modal
    if (applyModal) {
      applyModal.classList.remove('hidden');
      applyModal.setAttribute('aria-hidden', 'false');
    }
  });
}

// modal handlers
if (confirmApplyBtn) {
  confirmApplyBtn.addEventListener('click', () => {
    if (!lastUploadedLandingUrl) return;
    const landingScreenEl = document.querySelector('.landing-screen');
    const u = `${lastUploadedLandingUrl}?t=${Date.now()}`;
    if (landingScreenEl) landingScreenEl.style.backgroundImage = `url('${u}')`;
    if (landingUploadStatus) landingUploadStatus.textContent = 'Applied uploaded image to landing.';
    // persist applied background for landing page
    try { localStorage.setItem('landing_bg_url', lastUploadedLandingUrl); } catch (e) {}
    showToast('Landing image applied', 'success');
    if (applyModal) { applyModal.classList.add('hidden'); applyModal.setAttribute('aria-hidden', 'true'); }
  });
}
if (cancelApplyBtn) {
  cancelApplyBtn.addEventListener('click', () => {
    if (applyModal) { applyModal.classList.add('hidden'); applyModal.setAttribute('aria-hidden', 'true'); }
  });
}

async function adminUploadLandingImage() {
  if (!adminToken) {
    if (landingUploadStatus) landingUploadStatus.textContent = 'Admin not authenticated';
    return;
  }
  const file = landingInput && landingInput.files && landingInput.files[0];
  if (!file) {
    if (landingUploadStatus) landingUploadStatus.textContent = 'Please select an image first';
    return;
  }

  if (landingUploadStatus) landingUploadStatus.textContent = 'Uploading...';
  const form = new FormData();
  form.append('landing', file);
  try {
    const res = await fetchWithTimeout('/api/admin/upload-landing', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: form
    }, 30000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Upload failed');
    }
    const json = await res.json();
    if (landingUploadStatus) landingUploadStatus.textContent = json.message || 'Upload successful';
    if (json.url) {
      // update preview, enable apply button, and optionally auto-apply
      const u = `${json.url}`;
      lastUploadedLandingUrl = u;
      if (landingPreview) landingPreview.src = `${u}?t=${Date.now()}`;
      if (applyLandingBtn) applyLandingBtn.disabled = false;
      // auto-apply if requested
      if (autoApplyCheckbox && autoApplyCheckbox.checked) {
        const landingScreenEl = document.querySelector('.landing-screen');
        if (landingScreenEl) {
          landingScreenEl.style.backgroundImage = `url('${u}?t=${Date.now()}')`;
          if (landingUploadStatus) landingUploadStatus.textContent = 'Uploaded and applied to landing.';
            try { localStorage.setItem('landing_bg_url', lastUploadedLandingUrl); } catch (e) {}
            showToast('Uploaded and applied to landing', 'success');
        }
      }
    }
  } catch (err) {
    console.error('Upload failed', err);
    if (landingUploadStatus) landingUploadStatus.textContent = `Upload failed: ${err.message}`;
  }
}

if (uploadLandingBtn) uploadLandingBtn.addEventListener('click', adminUploadLandingImage);
if (resetLandingBtn) resetLandingBtn.addEventListener('click', () => {
  if (landingInput) landingInput.value = '';
  if (landingUploadStatus) landingUploadStatus.textContent = '';
  if (landingPreview) landingPreview.src = '/uploads/landing-bg.jpg';
  // clear applied landing override
  try { localStorage.removeItem('landing_bg_url'); } catch (e) {}
  const landingScreenEl = document.querySelector('.landing-screen');
  if (landingScreenEl) landingScreenEl.style.backgroundImage = "url('/uploads/landing-bg.jpg')";
  showToast('Landing background reset to default', 'success');
});

function hideAdminDashboard() {
  adminLoginSection.classList.remove('hidden');
  adminDashboardSection.classList.add('hidden');
}

// LOAD ADMIN ANALYTICS
async function loadAdminAnalytics() {
  try {
    const res = await fetch(apiUrl('/api/admin/analytics'), {
      headers: authHeaders()
    });
    if (!res.ok) throw new Error('Failed to load analytics');
    
    const stats = await res.json();
    
    // Update metric cards
    document.getElementById('metric-total').textContent = stats.total_farmers;
    document.getElementById('metric-approved').textContent = stats.approved_farmers;
    document.getElementById('metric-pending').textContent = stats.pending_farmers;
    document.getElementById('metric-kisii').textContent = stats.by_county.Kisii?.total || 0;
    document.getElementById('metric-nyamira').textContent = stats.by_county.Nyamira?.total || 0;
    document.getElementById('metric-homabay').textContent = stats.by_county['Homa Bay']?.total || 0;

    // Top species
    const speciesList = document.getElementById('top-species-list');
    speciesList.innerHTML = '';
    stats.most_common_species.forEach(item => {
      speciesList.innerHTML += `
        <div class="stat-item">
          <span class="stat-name">🐟 ${item.name}</span>
          <span class="stat-count">${item.count}</span>
        </div>
      `;
    });

    // Culture systems
    const cultureList = document.getElementById('culture-systems-list');
    cultureList.innerHTML = '';
    stats.most_common_culture.forEach(item => {
      cultureList.innerHTML += `
        <div class="stat-item">
          <span class="stat-name">🏗 ${item.name}</span>
          <span class="stat-count">${item.total}</span>
        </div>
      `;
    });
  } catch (err) {
    console.error('Analytics error:', err);
  }
}

// LOAD ADMIN FARMERS TABLE
async function loadAdminFarmersTable() {
  const county = document.getElementById('admin-county-filter')?.value || '';
  const approved = document.getElementById('admin-approval-filter')?.value || '';
  const search = document.getElementById('admin-search-filter')?.value || '';

  try {
    const params = new URLSearchParams();
    if (county) params.append('county', county);
    if (approved) params.append('approved', approved === 'approved');
    if (search) params.append('search', search);

    const res = await fetch(apiUrl(`/api/admin/farmers?${params}`), {
      headers: authHeaders()
    });
    let farmers;
    if (!res.ok) {
      // try to read server error message
      let serverErr = null;
      try { serverErr = await res.json(); } catch (e) { serverErr = null; }
      // If not authenticated, clear token and show login
      if (res.status === 401) {
        setAdminToken('');
        if (adminStatus) adminStatus.textContent = 'Not authenticated';
        if (adminLoginSection) adminLoginSection.classList.remove('hidden');
        if (adminDashboardSection) adminDashboardSection.classList.add('hidden');
        throw new Error(serverErr && serverErr.error ? serverErr.error : 'Authentication required');
      }
      throw new Error(serverErr && serverErr.error ? serverErr.error : `Failed to load farmers (${res.status})`);
    }

    farmers = await res.json();
    const tbody = document.getElementById('admin-farmers-tbody');
    
    if (!farmers.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding: 20px; text-align: center;">No farmers found</td></tr>';
      return;
    }

    tbody.innerHTML = farmers.map(farmer => `
      <tr>
        <td><strong>${farmer.name}</strong></td>
        <td>${farmer.email}</td>
        <td>${farmer.county}</td>
        <td>${Array.isArray(farmer.species) ? farmer.species.join(', ') : farmer.species || ''}</td>
        <td style="text-align: center;">
          <span class="status-badge ${farmer.approved ? 'approved' : 'pending'}">
            ${farmer.approved ? '✓ Approved' : '⏳ Pending'}
          </span>
        </td>
        <td style="text-align: center; display:flex; justify-content:center; gap:8px; flex-wrap:wrap;">
          <button class="approve-btn" onclick="toggleFarmerApproval(${farmer.id}, ${farmer.approved ? 0 : 1})">
            ${farmer.approved ? 'Revoke' : 'Approve'}
          </button>
          <button class="delete-btn danger-button" onclick="confirmAdminDelete(${farmer.id})">Delete</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Table error:', err);
    document.getElementById('admin-farmers-tbody').innerHTML = 
      `<tr><td colspan="6" style="padding: 20px; text-align: center; color: red;">Error loading farmers</td></tr>`;
  }
}
// TOGGLE FARMER APPROVAL
async function toggleFarmerApproval(farmerId, approve) {
  if (!adminToken) return;

  try {
    const res = await fetch(apiUrl(`/api/admin/farmers/${farmerId}/approval`), {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ approved: approve })
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error || 'Failed to update approval');
    }

    alert(approve ? 'Farmer approved!' : 'Approval revoked!');
    loadAdminAnalytics();
    loadAdminFarmersTable();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function confirmAdminDelete(farmerId) {
  if (!confirm('Delete this farmer? This action cannot be undone.')) return;
  handleAdminDelete({ id: farmerId, name: 'this farmer' });
}

// ADMIN FILTER HANDLERS
document.getElementById('admin-county-filter')?.addEventListener('change', loadAdminFarmersTable);
document.getElementById('admin-approval-filter')?.addEventListener('change', loadAdminFarmersTable);
document.getElementById('admin-search-filter')?.addEventListener('input', loadAdminFarmersTable);
document.getElementById('admin-refresh-table')?.addEventListener('click', () => {
  loadAdminAnalytics();
  loadAdminFarmersTable();
});

// Hero / CTA wiring: navigate from landing to app tabs
document.getElementById('hero-explore')?.addEventListener('click', () => showApp('map-tab'));
document.getElementById('hero-register')?.addEventListener('click', () => showApp('register-tab'));
document.getElementById('open-dashboard')?.addEventListener('click', () => showApp('map-tab'));
document.getElementById('cta-register')?.addEventListener('click', () => showApp('register-tab'));
document.getElementById('cta-explore')?.addEventListener('click', () => showApp('map-tab'));
document.getElementById('cta-contact')?.addEventListener('click', () => { window.location.href = 'mailto:info@kmfri.go.ke'; });

// Progressive Get Started flow: advance through a sequence of tabs when user clicks the landing Get Started button
(function setupProgressiveGetStarted(){
  const startBtn = document.getElementById('landing-get-started');
  if (!startBtn) return;
  const steps = [
    { id: 'map-tab', label: 'Explore Map' },
    { id: 'register-tab', label: 'Register Farm' },
    { id: 'farmers-tab', label: 'Farm Directory' },
    { id: 'supplier-marketplace-tab', label: 'Suppliers' },
    { id: 'farmer-dashboard-tab', label: 'My Farm' }
  ];
  let idx = 0; // idx is the index of the NEXT step to open
  function updateLabel() {
    if (idx === 0) {
      startBtn.textContent = 'Get Started';
    } else if (idx < steps.length) {
      startBtn.textContent = `Next: ${steps[idx].label}`;
    } else {
      startBtn.textContent = 'Finish — Explore more';
    }
    // update tooltip/title for accessibility and quick hint
    if (idx < steps.length) {
      // show which step will be opened on the next click
      startBtn.title = `Next: ${steps[idx].label} (step ${idx+1} of ${steps.length})`;
    } else {
      startBtn.title = 'Tour finished — click to return to the map';
    }
    syncTip();
  }
  // create a floating tooltip element for visual feedback
  const tip = document.createElement('div');
  tip.className = 'floating-tooltip';
  document.body.appendChild(tip);
  function showTip() { tip.classList.add('visible'); }
  function hideTip() { tip.classList.remove('visible'); }
  function moveTip(x, y) {
    tip.style.left = x + 'px';
    tip.style.top = (y - 12) + 'px';
  }
  // sync visual tooltip content with the accessible title
  function syncTip() { tip.textContent = startBtn.title || ''; }
  // pointer handlers on button
  startBtn.addEventListener('mouseenter', (ev) => { syncTip(); moveTip(ev.pageX, ev.pageY); showTip(); });
  startBtn.addEventListener('mousemove', (ev) => { moveTip(ev.pageX, ev.pageY); });
  startBtn.addEventListener('mouseleave', () => { hideTip(); });
  startBtn.addEventListener('click', (e) => {
    // proceed to the next step and update the URL hash so hashchange handlers run
    try {
      if (idx < steps.length) {
        const step = steps[idx];
        console.debug('GetStarted: opening', step.id);
        openTab(step.id);
        // update URL hash to keep state in the URL
        try { location.hash = `#${step.id.replace(/-tab$/, '')}`; } catch (e) {}
        idx += 1;
        updateLabel();
      } else {
        console.debug('GetStarted: finished sequence, resetting');
        idx = 0;
        openTab('map-tab');
        try { location.hash = '#map'; } catch (e) {}
        updateLabel();
      }
    } catch (err) {
      console.error('GetStarted flow error', err);
    }
  });
  updateLabel();
})();

// (mini-map preview implementation defined earlier; duplicate removed)

// initialize mini-map after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initMiniMapPreview();
  // Open map tab on load and ensure Leaflet recalculates layout
  setTimeout(() => {
    try {
      if (typeof openTab === 'function') openTab('map-tab');
      if (map && typeof map.invalidateSize === 'function') {
        map.invalidateSize();
        map.setView(KEGATI_COORDS, 12);
      }
    } catch (e) { console.warn('Failed to force-open map tab on load', e); }
  }, 300);
});

// Load initial data after UI is ready
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Load farmers and suppliers to populate tabs and map markers
    await loadFarmers();
    await loadSuppliers();
    await updateAnalyticsDashboard();
    await loadPublicStats();
  } catch (e) {
    console.warn('Initial data load failed', e);
  }
});

// Coordinates control: shows current mouse lat/lng and sets inputs on click
(function addCoordinatesControl() {
  if (typeof L === 'undefined' || !map) return;
  const CoordinatesControl = L.Control.extend({
    onAdd: function() {
      this._div = L.DomUtil.create('div', 'coords-control');
      this._div.style.padding = '6px 10px';
      this._div.style.background = 'rgba(255,255,255,0.9)';
      this._div.style.borderRadius = '8px';
      this._div.style.boxShadow = '0 6px 16px rgba(16,42,67,0.08)';
      this._div.style.fontSize = '13px';
      this._div.style.color = '#102a43';
      this._div.textContent = 'Lat: —, Lng: —';
      return this._div;
    }
  });

  const coordsControl = new CoordinatesControl({ position: 'bottomleft' }).addTo(map);

  function fmt(n) { return (typeof n === 'number' && !Number.isNaN(n)) ? n.toFixed(5) : '—'; }

  map.on('mousemove', function(e) {
    try { coordsControl._div.textContent = `Lat: ${fmt(e.latlng.lat)}, Lng: ${fmt(e.latlng.lng)}`; } catch (e) {}
  });

  map.on('mouseout', function() { try { coordsControl._div.textContent = 'Lat: —, Lng: —'; } catch (e) {} });

  // On map click, set form inputs and show a popup with coordinates
  map.on('click', async function(e) {
    try {
      const lat = e.latlng.lat.toFixed(6);
      const lng = e.latlng.lng.toFixed(6);
      // set inputs if present
      try { if (typeof latitudeInput !== 'undefined' && latitudeInput) latitudeInput.value = lat; } catch (err) {}
      try { if (typeof longitudeInput !== 'undefined' && longitudeInput) longitudeInput.value = lng; } catch (err) {}
      // open registration form and focus name field for quick entry
      try { if (typeof openTab === 'function') openTab('register-tab'); } catch (e) {}
      try { const nameEl = document.getElementById('name'); if (nameEl) { nameEl.focus(); } } catch (e) {}
      // Attempt reverse geocoding (Nominatim) to get a human-readable place name
      async function reverseGeocode(latf, lngf) {
        try {
          const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latf)}&lon=${encodeURIComponent(lngf)}&addressdetails=1`;
          const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
          if (!res.ok) return null;
          const data = await res.json();
          // prefer display_name, then address components
          if (data.display_name) return data.display_name;
          if (data.address) return Object.values(data.address).join(', ');
          return null;
        } catch (err) { return null; }
      }

      const placeName = await reverseGeocode(lat, lng);
      const popupHtml = placeName
        ? `<strong>${placeName}</strong><br><small>Lat: ${lat} · Lng: ${lng}</small>`
        : `<strong>Coordinates</strong><br>Lat: ${lat}<br>Lng: ${lng}`;
      L.popup().setLatLng(e.latlng).setContent(popupHtml).openOn(map);
      // set location name input if present and update location source hint
      try { const locEl = document.getElementById('location_name'); if (locEl && placeName) locEl.value = placeName; } catch (err) {}
      try { if (locationSource) locationSource.textContent = placeName ? placeName : `Lat: ${lat}, Lng: ${lng}`; } catch (err) {}
      // small toast feedback if available
      try { if (typeof showToast === 'function') showToast(placeName ? 'Place identified — registration opened' : 'Coordinates added to form'); } catch (err) {}
    } catch (err) { console.warn('Failed to handle map click coords', err); }
  });
})();
