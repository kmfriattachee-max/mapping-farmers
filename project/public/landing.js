document.addEventListener('DOMContentLoaded', async () => {
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function animateValue(el, value, duration = 900) {
    if (!el) return;
    const start = Number(el.textContent.replace(/,/g, '')) || 0;
    const end = Number(value);
    if (!Number.isFinite(end)) {
      el.textContent = String(value);
      return;
    }
    const startTime = performance.now();
    const delta = end - start;

    const step = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const current = Math.round(start + (delta * progress));
      el.textContent = current.toLocaleString();
      if (progress < 1) window.requestAnimationFrame(step);
    };

    window.requestAnimationFrame(step);
  }

  function setCount(id, value) {
    const el = document.getElementById(id);
    if (el) animateValue(el, value);
  }

  async function fetchJson(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) {
        console.warn('fetch failed', url, r.status);
        return null;
      }
      return await r.json();
    } catch (e) {
      console.warn('fetch error', url, e);
      return null;
    }
  }

  // Ensure landing hero photo loads fresh (cache-bust) and provide a graceful fallback
  try {
    const heroPhoto = document.getElementById('hero-photo');
    const landingScreenEl = document.querySelector('.landing-screen');
    // If admin previously applied a background, load it from localStorage
    try {
      const saved = localStorage.getItem('landing_bg_url');
      if (saved && landingScreenEl) {
        landingScreenEl.style.backgroundImage = `url('${saved}?t=${Date.now()}')`;
      }
    } catch (e) {}
    if (heroPhoto) {
      const p = `/uploads/landing-bg.jpg?t=${Date.now()}`;
      const fallback = `/uploads/landing-bg-fallback.svg?t=${Date.now()}`;
      heroPhoto.src = p;
      heroPhoto.addEventListener('error', () => {
        // try SVG fallback if JPG missing or invalid
        heroPhoto.src = fallback;
        heroPhoto.style.opacity = 1;
        heroPhoto.alt = 'Landing image (fallback)';
      });
    }
    // keep background controlled by CSS; hero <img> handles fallback display
  } catch (e) { /* ignore */ }

  // Fetch farmers (public)
  const farmers = await fetchJson('http://localhost:3000/api/farmers') || [];
  setCount('landing-total-farms', farmers.length || 0);
  setCount('live-farmers', farmers.length || 0);
  setCount('live-farms', farmers.length || 0);

  // Unique counties from farmers
  const counties = new Set((farmers || []).map(f => f.county).filter(Boolean));
  setCount('landing-counties-covered', counties.size || 0);

  // Total unique species reported
  const speciesSet = new Set();
  (farmers || []).forEach(f => {
    const arr = Array.isArray(f.species) ? f.species : (f.species || '').toString().split(',').map(s=>s.trim()).filter(Boolean);
    arr.forEach(s => speciesSet.add(s));
  });
  setCount('landing-total-production', speciesSet.size || 0);

  // Fetch static geojson layers where available
  const layerFiles = {
    water_sources: '/data/water_sources.geojson',
    hatcheries: '/data/hatcheries.geojson',
    markets: '/data/markets.geojson',
    feed_suppliers: '/data/feed_suppliers.geojson'
  };
  let hatcheriesCount = 0;
  let marketsCount = 0;
  let feedsCount = 0;

  for (const [key, url] of Object.entries(layerFiles)) {
    const geo = await fetchJson(url);
    const count = geo && Array.isArray(geo.features) ? geo.features.length : 0;
    switch (key) {
      case 'water_sources':
        setCount('landing-water-sources', count);
        break;
      case 'hatcheries':
        hatcheriesCount = count;
        setCount('landing-hatcheries', count);
        break;
      case 'markets':
        marketsCount = count;
        setCount('landing-markets', count);
        break;
      case 'feed_suppliers':
        feedsCount = count;
        setCount('landing-feeds', count);
        break;
    }
  }

  setCount('live-hatcheries', hatcheriesCount);
  setCount('live-alerts', 0);

  // GIS layers available (count of known static sources that responded)
  const layerCount = Object.values(layerFiles).filter(url => true).length;
  setCount('landing-gis-layers', layerCount);

  // Populate analytics: top counties, top species, new registrations, simple trend
  function topNFromCounts(counts, n = 3) {
    return Object.entries(counts)
      .sort((a,b) => b[1] - a[1])
      .slice(0, n)
      .map(e => e[0]);
  }

  // Count occurrences
  const countyCounts = {};
  const speciesCounts = {};
  const now = new Date();
  const registrations = [];

  (farmers || []).forEach(f => {
    const c = (f.county || 'Unknown').toString();
    countyCounts[c] = (countyCounts[c] || 0) + 1;

    // species may be array or comma string
    const arr = Array.isArray(f.species) ? f.species : (f.species || '').toString().split(',').map(s=>s.trim()).filter(Boolean);
    arr.forEach(s => { speciesCounts[s] = (speciesCounts[s] || 0) + 1; });

    if (f.created_at) {
      const d = new Date(f.created_at.replace(' ', 'T'));
      if (!isNaN(d)) registrations.push(d);
    }
  });

  const topCounties = topNFromCounts(countyCounts, 3).join(', ');
  const topSpecies = topNFromCounts(speciesCounts, 3).join(', ');
  setText('top-counties', topCounties || '—');
  setText('top-species', topSpecies || '—');

  // New registrations in last 7 days
  const msDay = 24*60*60*1000;
  const recent7 = registrations.filter(d => (now - d) <= 7*msDay).length;
  setText('new-registrations', String(recent7));

  // Simple production trend: compare last 30 days vs previous 30 days
  const last30 = registrations.filter(d => (now - d) <= 30*msDay).length;
  const prev30 = registrations.filter(d => (now - d) > 30*msDay && (now - d) <= 60*msDay).length;
  let trendText = 'No clear trend';
  if (last30 > prev30) trendText = `Rising (${last30} vs ${prev30})`;
  else if (last30 < prev30) trendText = `Declining (${last30} vs ${prev30})`;
  else trendText = `Stable (${last30})`;
  setText('production-trends', trendText);

  // Partner logo loader + color-scheme toggle
  function loadImageSequential(imgEl, paths) {
    return new Promise(resolve => {
      let i = 0;
      function tryNext() {
        if (i >= paths.length) { resolve(false); return; }
        const p = paths[i++];
        imgEl.src = p;
        const onLoad = () => { cleanup(); resolve(true); };
        const onErr = () => { cleanup(); tryNext(); };
        function cleanup() { imgEl.removeEventListener('load', onLoad); imgEl.removeEventListener('error', onErr); }
        imgEl.addEventListener('load', onLoad);
        imgEl.addEventListener('error', onErr);
      }
      tryNext();
    });
  }

  async function applyPartnerScheme(scheme) {
    const imgs = Array.from(document.querySelectorAll('img[data-base]'));
    for (const img of imgs) {
      const base = img.dataset.base.replace(/\.svg$/,'');
      const candidates = [];
      if (scheme && scheme !== 'default') {
        candidates.push(`${base}-${scheme}.svg`);
        candidates.push(`${base}-${scheme}.png`);
      }
      candidates.push(`${base}.png`);
      candidates.push(`${base}.jpg`);
      candidates.push(`${base}.svg`);
      await loadImageSequential(img, candidates);
    }
  }

  const schemeSelect = document.getElementById('partner-color-scheme');
  const schemeSelectEl = document.getElementById('partner-color-scheme');
  const customColorEl = document.getElementById('partner-custom-color');

  async function recolorSvgsTo(color) {
    const imgs = Array.from(document.querySelectorAll('img[data-base]'));
    // match common primary colors used in our SVGs (approx)
    const primaryColorRegex = /#(b34700|ff7a2b|1976d2|166534|0f4c81|3b2a1a|ff9c33|334e68|f2f9ff|fff7f0)/gi;
    for (const img of imgs) {
      try {
        const base = img.dataset.base + '.svg';
        const r = await fetch(base);
        if (!r.ok) { continue; }
        let svgText = await r.text();
        svgText = svgText.replace(primaryColorRegex, color);
        const dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svgText);
        img.src = dataUrl;
      } catch (e) {
        console.warn('recolor failed for', img, e);
      }
    }
  }

  async function handleSchemeChange(value) {
    if (value === 'custom') {
      customColorEl.style.display = 'inline-block';
      await recolorSvgsTo(customColorEl.value);
      return;
    } else {
      customColorEl.style.display = 'none';
    }

    if (value === 'green') {
      await recolorSvgsTo('#166534');
      return;
    }

    // fallback to existing scheme loader (warm/cool/default)
    await applyPartnerScheme(value);
  }

  if (schemeSelectEl) {
    schemeSelectEl.addEventListener('change', (e) => handleSchemeChange(e.target.value));
    if (customColorEl) {
      customColorEl.addEventListener('input', (ev) => recolorSvgsTo(ev.target.value));
    }
    // initial attempt to load scheme
    handleSchemeChange(schemeSelectEl.value || 'default');
  } else {
    applyPartnerScheme('default');
  }

  // Sidebar toggle and navigation (smooth scroll for landing anchors)
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
        // if it's an in-page anchor, smooth scroll
        if (href.startsWith('#')) {
          ev.preventDefault();
          const target = document.querySelector(href);
          if (target) {
            // reveal hidden landing sections if compact
            const landing = document.querySelector('.landing-screen');
            if (landing && landing.classList.contains('compact')) {
              landing.classList.remove('compact');
            }
            // small timeout to allow reflow then scroll
            setTimeout(() => {
              target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 120);
            // collapse sidebar after navigation for compact view
            if (sidebar) { sidebar.classList.add('collapsed'); sidebar.classList.remove('expanded'); }
          }
        }
        // external links (app.html) will naturally navigate
      });
    });
    // collapse landing button
    const collapseLandingBtn = document.getElementById('landing-collapse-btn');
    if (collapseLandingBtn) {
      collapseLandingBtn.addEventListener('click', () => {
        const landing = document.querySelector('.landing-screen');
        if (landing && !landing.classList.contains('compact')) {
          landing.classList.add('compact');
        }
        // scroll to top and collapse sidebar
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (sidebar) { sidebar.classList.add('collapsed'); sidebar.classList.remove('expanded'); }
      });
    }
    // compact badge click: expand landing view
    const compactBadge = document.getElementById('compact-badge');
    if (compactBadge) {
      compactBadge.addEventListener('click', () => {
        const landing = document.querySelector('.landing-screen');
        if (landing && landing.classList.contains('compact')) {
          landing.classList.remove('compact');
          setTimeout(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, 80);
        }
      });
    }
  } catch (e) { console.warn('Sidebar init failed', e); }

  // Dark mode toggle — persists in localStorage and applies `data-theme="dark"` on <html>
  try {
    const themeKey = 'site_theme';
    const btn = document.getElementById('color-mode-toggle');
    function setTheme(t) {
      const root = document.documentElement;
      if (t === 'dark') root.setAttribute('data-theme', 'dark');
      else root.removeAttribute('data-theme');
      if (btn) {
        btn.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
        btn.textContent = t === 'dark' ? '☀' : '🌙';
      }
    }

    // load saved, or system preference
    const saved = (function() { try { return localStorage.getItem(themeKey); } catch(e){return null;} })();
    if (saved) setTheme(saved === 'dark' ? 'dark' : 'light');
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) setTheme('dark');
    else setTheme('light');

    if (btn) {
      btn.addEventListener('click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const next = isDark ? 'light' : 'dark';
        try { localStorage.setItem(themeKey, next); } catch (e) {}
        setTheme(next);
      });
    }
  } catch (e) { console.warn('Theme toggle init failed', e); }
});
