import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://uybxytperuyxpkljwzvr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_AMsNmmEWZ_0Njc7roAfk4g_UpgMNq9c';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function coerceJsonArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function unwrapPhotosBlob(blob) {
  if (blob == null) return { urls: [], meta: {} };
  if (Array.isArray(blob)) return { urls: blob, meta: {} };
  if (typeof blob === 'object' && blob._v === 2 && Array.isArray(blob.urls))
    return { urls: blob.urls, meta: { ...(blob.meta || {}) } };
  return { urls: [], meta: {} };
}

function coercePhotosUrls(photosProp) {
  if (photosProp != null && Array.isArray(photosProp)) return photosProp;
  return unwrapPhotosBlob(photosProp).urls;
}

function packPhotosBlob(urls, destShort, countryCode) {
  return {
    _v: 2,
    urls: Array.isArray(urls) ? urls : [],
    meta: {
      destShort: destShort || '',
      countryCode:
        typeof countryCode === 'string' && /^[a-z]{2}$/i.test(countryCode)
          ? countryCode.toUpperCase()
          : ''
    }
  };
}

/** Ligne Supabase → modèle utilisé dans l’UI */
function rowToApp(row) {
  const ph = unwrapPhotosBlob(row.photos);
  const urls = ph.urls.length ? ph.urls : coercePhotosUrls(row.photos);
  const meta = ph.meta || {};
  const ccRaw = meta.countryCode || '';
  return {
    id: row.id,
    dest: row.dest || '',
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    mois: row.mois || '',
    annee: row.annee || '',
    hotels: coerceJsonArray(row.hotels),
    restaurants: coerceJsonArray(row.restaurants),
    boutiques: coerceJsonArray(row.boutiques),
    lieux: coerceJsonArray(row.lieux),
    notes: row.notes || '',
    photos: urls,
    destShort: meta.destShort || '',
    countryCode:
      typeof ccRaw === 'string' && /^[a-z]{2}$/i.test(ccRaw) ? ccRaw.toUpperCase() : '',
    savedAt: row.saved_at || '',
    saved_at: row.saved_at,
    created_at: row.created_at
  };
}

function buildDbPayload(app) {
  const savedAtLabel =
    app.savedAt ??
    app.saved_at ??
    new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const photosUrls = coercePhotosUrls(app.photos);
  return {
    dest: app.dest ?? '',
    lat: app.lat ?? null,
    lng: app.lng ?? null,
    mois: app.mois ?? '',
    annee: app.annee ?? '',
    hotels: coerceJsonArray(app.hotels),
    restaurants: coerceJsonArray(app.restaurants),
    boutiques: coerceJsonArray(app.boutiques),
    lieux: coerceJsonArray(app.lieux),
    notes: app.notes ?? '',
    saved_at: savedAtLabel,
    photos: packPhotosBlob(photosUrls, app.destShort || '', app.countryCode || '')
  };
}

async function refreshFichesFromSupabase() {
  const { data, error } = await supabase
    .from('fiches')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[Supabase]', error);
    toast('Impossible de charger les fiches');
    fiches = [];
    return;
  }
  fiches = (data || []).map(rowToApp);
}

// ══════════════════════════════════════
// STATE
// ══════════════════════════════════════
/** @type {object[]} */
let fiches = [];
/** uuid en édition, ou null si nouvelle fiche */
let editingId = null;
/** index dans fiches[] pour la vue détail lecture seule */
let detailFicheIdx = null;
let currentPhotos = [];
let currentLat = null;
let currentLng = null;
let currentDest = '';
let currentDestShort = '';
let currentCountryCode = ''; /* ISO 3166-1 alpha-2 — fourni par Nominatim quand disponible */

let locDebounceTimer = null;

// ══════════════════════════════════════
// INIT
// ══════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // Close location dropdown on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.loc-search-wrap')) closeDropdown();
  });

  await refreshFichesFromSupabase();

  // ── Detect ?fiche= FIRST ──
  const param = new URLSearchParams(window.location.search).get('fiche');
  if (param) {
    try {
      const sharedFiche = JSON.parse(decodeURIComponent(atob(param)));
      renderFicheList();
      initAccordion();
      showSharedFiche(sharedFiche);
      updateNavBar();
      return;
    } catch (e) {
      console.warn('Shared fiche parse error:', e);
    }
  }

  // Normal init
  initAccordion();
  initLists();
  // Open first accordion section by default
  const firstAccItem = document.querySelector('#lists-accordion .accordion-item');
  if (firstAccItem) _accordionOpen(firstAccItem);
  updatePreview();
  renderFicheList();
  updateNavBar();
});


document.addEventListener('keydown', e => {

  if (e.key !== 'Escape') return;
  const m = document.getElementById('share-modal');
  if (m && m.classList.contains('is-open')) closeShareMenu();


});

function initLists() {
  ['hotels', 'restaurants', 'boutiques', 'lieux'].forEach(k => renderList(k, ['']));
}

// ══════════════════════════════════════
// ACCORDION
// ══════════════════════════════════════
function initAccordion() {
  document.querySelectorAll('#lists-accordion .accordion-header').forEach(header => {
    header.addEventListener('click', () => {
      const item = header.closest('.accordion-item');
      const isOpen = item.classList.contains('open');

      // Close all open items
      document.querySelectorAll('#lists-accordion .accordion-item.open').forEach(open => {
        _accordionClose(open);
      });

      // Toggle: open only if it was previously closed
      if (!isOpen) _accordionOpen(item);
    });
  });
}

function _accordionOpen(item) {
  const content = item.querySelector('.accordion-content');
  item.classList.add('open');
  content.style.maxHeight = content.scrollHeight + 'px';
}

function _accordionClose(item) {
  const content = item.querySelector('.accordion-content');
  item.classList.remove('open');
  content.style.maxHeight = '0';
}

function _accordionRefreshHeight(key) {
  const item = document.querySelector(`#lists-accordion .accordion-item[data-key="${key}"]`);
  if (item && item.classList.contains('open')) {
    const content = item.querySelector('.accordion-content');
    content.style.maxHeight = content.scrollHeight + 'px';
  }
}

function _accordionUpdateBadge(key) {
  const badge = document.getElementById(`badge-${key}`);
  if (!badge) return;
  const count = getListData(key).filter(x => x.trim()).length;
  badge.textContent = count;
  badge.setAttribute('data-count', count);
}

// ══════════════════════════════════════
// AUTOCOMPLETE — datasets (offline, no API)
// ══════════════════════════════════════
const AUTOCOMPLETE_DATA = {
  hotels: [
    'Mama Shelter', 'InterContinental Bordeaux', 'Hôtel de Sèze',
    'Novotel', 'Ibis', 'Mercure', 'Sofitel', 'Marriott', 'Hilton',
    'Four Seasons', 'Le Méridien', 'Hôtel boutique', 'Auberge de jeunesse',
    'B&B Hôtel', 'Pension de famille', 'Gîte', 'Chambre d\'hôtes', 'Airbnb'
  ],
  restaurants: [
    'Cent 33', 'Le Chien de Pavlov', 'Miles', 'Racines', 'Symbiose',
    'Brasserie du marché', 'Restaurant gastronomique', 'Bistrot local',
    'Pizzeria', 'Trattoria', 'Sushi bar', 'Food market', 'Street food',
    'Café terrasse', 'Cave à vins', 'Crêperie', 'Boulangerie-café',
    'Tapas bar', 'Table d\'hôtes', 'Rooftop restaurant'
  ],
  boutiques: [
    'Marché des Capucins', 'Promenade Sainte-Catherine',
    'Marché artisanal', 'Centre commercial', 'Marché de Noël',
    'Librairie indépendante', 'Galerie d\'antiquités', 'Marché aux puces',
    'Épicerie fine', 'Cave à vins', 'Boutique de souvenirs',
    'Galerie marchande', 'Concept store', 'Marché bio', 'Marché fermier'
  ],
  lieux: [
    'Place de la Bourse', 'Darwin', 'Cap Ferret', 'Dune du Pilat',
    'Musée des Beaux-Arts', 'Cathédrale', 'Vieux port', 'Jardin public',
    'Quartier historique', 'Panorama', 'Plage principale', 'Parc national',
    'Château', 'Tour historique', 'Pont emblématique', 'Marché central',
    'Promenade bord de mer', 'Vieille ville', 'Marché aux fleurs'
  ]
};

let _acFloatPinnedInput = null;

function _acEnsureFloatRoot() {
  _acEnsureFloatListeners();
  let el = document.getElementById('ac-dropdown-float');
  if (!el) {
    el = document.createElement('ul');
    el.id = 'ac-dropdown-float';
    el.className = 'autocomplete-list autocomplete-list--float';
    el.setAttribute('role', 'listbox');
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

let _acFloatListeners = false;
function _acEnsureFloatListeners() {
  if (_acFloatListeners) return;
  _acFloatListeners = true;
  window.addEventListener('scroll', _acReflowFloat, true);
  window.addEventListener('resize', _acReflowFloat);
}

function _acReflowFloat() {
  const inp = _acFloatPinnedInput;
  const fl = document.getElementById('ac-dropdown-float');
  if (!inp || !fl || fl.hidden) return;
  if (!document.body.contains(inp)) {
    _acClose();
    return;
  }
  _acPositionFloat(inp, fl);
}

function _acPositionFloat(input, floatEl) {
  const r = input.getBoundingClientRect();
  const pad = 8;
  const vw = document.documentElement.clientWidth;
  let left = r.left;
  const w = r.width;
  if (left + w > vw - pad) left = Math.max(pad, vw - w - pad);
  if (left < pad) left = pad;
  floatEl.style.left = `${Math.round(left)}px`;
  floatEl.style.top = `${Math.round(r.bottom + 2)}px`;
  floatEl.style.width = `${Math.round(w)}px`;
  const maxVh = Math.max(120, window.innerHeight - (r.bottom + 2) - pad);
  floatEl.style.maxHeight = `${Math.min(180, maxVh)}px`;
}

// ──  Autocomplete engine ──
function _acAttach(input, dataset) {
  let activeIdx = -1;

  input.addEventListener('input', () => {
    const q = input.value.trim();
    activeIdx = -1;
    if (!q) { _acClose(); return; }

    const hits = dataset
      .filter(s => s.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 7);

    if (hits.length === 0) { _acClose(); return; }
    _acRender(input, hits, q);
  });

  input.addEventListener('keydown', e => {
    const list = document.getElementById('ac-dropdown-float');
    const items = list ? list.querySelectorAll('.autocomplete-item') : [];
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
      _acSetActive(items, activeIdx);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, -1);
      _acSetActive(items, activeIdx);
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      items[activeIdx].dispatchEvent(new MouseEvent('click'));
    } else if (e.key === 'Escape') {
      _acClose();
    }
  });

  input.addEventListener('blur', () =>
    setTimeout(() => {
      if (_acFloatPinnedInput === input) _acClose();
    }, 160)
  );
}

function _acRender(input, hits, query) {
  const list = _acEnsureFloatRoot();
  list.innerHTML = '';
  hits.forEach(hit => {
    const li = document.createElement('li');
    li.className = 'autocomplete-item';
    li.innerHTML = _acHighlight(hit, query);
    li.addEventListener('mousedown', e => e.preventDefault());
    li.addEventListener('click', () => {
      input.value = hit;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      _acClose();
      input.focus();
    });
    list.appendChild(li);
  });
  list.hidden = false;
  _acFloatPinnedInput = input;
  _acPositionFloat(input, list);
}

function _acHighlight(text, query) {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) return escHtml(text);
  return (
    escHtml(text.slice(0, i)) +
    '<mark>' + escHtml(text.slice(i, i + query.length)) + '</mark>' +
    escHtml(text.slice(i + query.length))
  );
}

function _acClose() {
  const list = document.getElementById('ac-dropdown-float');
  if (!list) return;
  list.innerHTML = '';
  list.hidden = true;
  _acFloatPinnedInput = null;
}

function _acSetActive(items, idx) {
  items.forEach((li, i) => li.classList.toggle('ac-active', i === idx));
}

// ══════════════════════════════════════
// VIEW SWITCHING (top-level: editor ↔ preview)
// ══════════════════════════════════════
function switchView(view) {
  closeDetailPanel();
  const toEditor = view === 'editor';

  document.getElementById('editorView').classList.toggle('active', toEditor);
  document.getElementById('previewView').classList.toggle('active', !toEditor);

  // Always refresh preview when opening it
  if (!toEditor) updatePreview();
  updateNavBar();
}

/** Retour au formulaire depuis « Voir la fiche » — réutilise l’état déjà dans le DOM (même flux que editFiche) */
function editFromPreview() {
  switchTab('form', { skipFormReset: true });
  switchView('editor');
  const sc = document.querySelector('#editorView .editor-scroll');
  if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' });
}

// ══════════════════════════════════════
// TAB SWITCHING (inside editor: form ↔ list)
// ══════════════════════════════════════
/**
 * @param {'form'|'list'} tab
 * @param {{ skipFormReset?: boolean }} [options]
 */
function switchTab(tab, options = {}) {
  const { skipFormReset = false } = options;

  if (tab === 'form' && !skipFormReset) {
    if (!confirmAbandonIfEditing()) return;
    resetFormCore();
  }

  const toForm = tab === 'form';

  document.getElementById('tab-form').classList.toggle('active', toForm);
  document.getElementById('tab-list').classList.toggle('active', !toForm);
  document.getElementById('tab-form-btn').classList.toggle('active', toForm);
  document.getElementById('tab-list-btn').classList.toggle('active', !toForm);

  if (!toForm) renderFicheList();
  updateNavBar();
}

function confirmAbandonIfEditing() {
  if (editingId == null) return true;
  return confirm('Abandonner les modifications en cours ?');
}

/** Accueil = nouvelle fiche seule (pas prévisualisation, pas détail, pas édition d'une fiche existante). */
function currentPageIsHome() {
  if (detailFicheIdx != null || document.getElementById('detailView')?.classList.contains('active')) return false;
  const editorVisible = document.getElementById('editorView')?.classList.contains('active');
  const formTab = document.getElementById('tab-form')?.classList.contains('active');
  const previewOn = document.getElementById('previewView')?.classList.contains('active');
  return editorVisible && formTab && !previewOn && editingId === null;
}

/** Navbar : pas de retour sur l'accueil uniquement ; sinon sous-page (liste, détail, aperçu, édition). */
function updateNavBar() {
  const back = document.getElementById('topnav-back');
  if (!back) return;
  if (currentPageIsHome()) {
    back.setAttribute('hidden', '');
    return;
  }
  back.removeAttribute('hidden');
}

function navBarBack() {
  if (document.getElementById('previewView')?.classList.contains('active')) {
    editFromPreview();
    return;
  }
  if (detailFicheIdx != null || document.getElementById('detailView')?.classList.contains('active')) {
    closeDetailPanel({ goList: true });
    return;
  }
  /* Mes fiches → accueil (nouvelle fiche) ; confirmAbandon dans switchTab */
  if (document.getElementById('tab-list')?.classList.contains('active')) {
    switchTab('form');
    return;
  }
  /* Formulaire : modification d'une fiche existante → Mes fiches */
  if (document.getElementById('tab-form')?.classList.contains('active') && editingId !== null) {
    if (!confirmAbandonIfEditing()) return;
    resetFormCore();
    switchTab('list', { skipFormReset: true });
    return;
  }
}

function closeDetailPanel(opts = {}) {
  detailFicheIdx = null;
  const dv = document.getElementById('detailView');
  const ev = document.getElementById('editorView');
  if (dv) dv.classList.remove('active');
  if (ev) ev.classList.add('active');
  if (opts.goList && document.getElementById('tab-list')) switchTab('list', { skipFormReset: true });
  updateNavBar();
}

/** Incrémenté à chaque ouverture de détail pour ignorer les réponses drapeau obsolètes */
let _detailFlagGen = 0;

/**
 * Drapeau 64×48 dans un cercle (72px) au-dessus du titre : code ISO ou restcountries + flagcdn.
 * Échec silencieux.
 * @param {object} f
 */
function scheduleDetailCountryFlag(f) {
  const gen = ++_detailFlagGen;
  const wrap = document.getElementById('detail-flag-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  const imgTag = code =>
    `<img class="detail-flag-img" src="https://flagcdn.com/64x48/${code}.png" width="64" height="48" alt="" loading="lazy">`;

  const ccQuick = f.countryCode && String(f.countryCode).trim();
  if (/^[a-z]{2}$/i.test(ccQuick)) {
    const code = ccQuick.toLowerCase();
    wrap.innerHTML = imgTag(code);
    return;
  }

  const dest = f.dest || '';
  const lc = dest.lastIndexOf(',');
  const countryName = lc >= 0 ? dest.slice(lc + 1).trim() : '';
  if (!countryName) return;

  const url = `https://restcountries.com/v3.1/name/${encodeURIComponent(countryName)}?fields=cca2`;

  (async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    let code = null;
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) return;
      const data = await r.json();
      const hit = Array.isArray(data) && data[0];
      const cca2 = hit?.cca2;
      if (cca2 && /^[a-z]{2}$/i.test(String(cca2))) code = String(cca2).toLowerCase();
    } catch {
      /* silence */
    } finally {
      clearTimeout(t);
    }
    if (gen !== _detailFlagGen || !wrap.isConnected || !code) return;
    wrap.innerHTML = imgTag(code);
  })();
}

function renderFicheDetail(idx) {
  const el = document.getElementById('detail-content');
  if (!el) return;
  const f = fiches[idx];
  if (!f) {
    el.innerHTML = '<p>Fiche introuvable.</p>';
    return;
  }

  /** @param {string} label */
  const listBlock = (label, arr) => {
    const items = coerceJsonArray(arr).filter(Boolean);
    let html = `<div class="detail-section"><div class="detail-section-title">${escHtml(label)}</div>`;
    if (items.length === 0) html += `<p class="detail-empty">—</p>`;
    else items.forEach(t => {
      html += `<div class="detail-li">${escHtml(t)}</div>`;
    });
    html += '</div>';
    return html;
  };

  let pics = '';
  const photos = Array.isArray(f.photos) ? f.photos : [];
  if (photos.length > 0) {
    pics = `<div class="detail-section"><div class="detail-section-title">Photos</div><div class="detail-photo-grid">`;
    photos.forEach(u => {
      pics += `<div class="detail-photo-cell"><img src="${escHtml(u)}" alt="" loading="lazy"></div>`;
    });
    pics += '</div></div>';
  }

  let notes = '';
  if (f.notes && String(f.notes).trim()) {
    notes = `<div class="detail-notes"><div class="detail-section-title">Notes</div><div>${escHtml(f.notes).replace(/\n/g, '<br>')}</div></div>`;
  }

  el.innerHTML = `
    <header class="detail-head">
      <div id="detail-flag-wrap" class="detail-flag-ring" aria-hidden="true"></div>
      <h1 class="detail-h1">${escHtml(f.dest || 'Sans titre')}</h1>
      <p class="detail-period">${escHtml([f.mois, f.annee].filter(Boolean).join(' · ') || 'Période non renseignée')}</p>
    </header>
    ${listBlock('Hébergement', f.hotels)}
    ${listBlock('Restaurants', f.restaurants)}
    ${listBlock('Shopping & boutiques', f.boutiques)}
    ${listBlock('Visites & lieux', f.lieux)}
    ${notes}
    ${pics}
    <div class="detail-actions" onclick="event.stopPropagation()">
      <button type="button" class="btn-detail-edit" onclick="event.stopPropagation(); editFiche(${idx});">Modifier</button>
      <button type="button" class="btn-detail-pdf" onclick="event.stopPropagation(); exportFichePDF(${idx})">↓ PDF</button>
    </div>`;

  scheduleDetailCountryFlag(f);
}

function openFicheDetail(idx) {
  const f = fiches[idx];
  if (!f) return;
  detailFicheIdx = idx;
  renderFicheDetail(idx);
  const dv = document.getElementById('detailView');
  const ev = document.getElementById('editorView');
  if (ev) ev.classList.remove('active');
  if (dv) dv.classList.add('active');
  const sc = document.querySelector('#detailView .preview-inner');
  if (sc) sc.scrollTo({ top: 0 });
  updateNavBar();
}

// ══════════════════════════════════════
// TOAST
// ══════════════════════════════════════
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ══════════════════════════════════════
// PARTAGER — lien fiche (?fiche=) ou page courante
// ══════════════════════════════════════
let _shareContext = null;

function makeFicheShareUrl(fiche) {
  const slim = { ...fiche, photos: [] };
  const encoded = btoa(encodeURIComponent(JSON.stringify(slim)));
  return `${window.location.origin}${window.location.pathname}?fiche=${encoded}`;
}

function buildShareLines(dest, mois, annee, url) {
  const lines = ['Découvre cette fiche sur Le travel book de chachou.', ''];
  if (dest) lines.push(dest);
  const period = [mois, annee].filter(Boolean).join(' ');
  if (period) lines.push(`Période : ${period}`);
  lines.push('', url);
  return lines.join('\n');
}

function buildSharePayloadFromEditor() {
  const f = collectFiche();
  if (!f.dest || !String(f.dest).trim()) return null;
  const url = makeFicheShareUrl(f);
  const title = `Fiche voyage — ${f.dest}`;
  const text = buildShareLines(f.dest, f.mois, f.annee, url);
  return { url, title, text };
}

function buildSharePayloadFromSavedFiche(f) {
  if (!f) return buildSharePayloadFallback();
  const url = makeFicheShareUrl(f);
  const title = `Fiche voyage — ${f.dest || 'Sans titre'}`;
  const text = buildShareLines(f.dest, f.mois, f.annee, url);
  return { url, title, text };
}

function buildSharePayloadFallback() {
  const url = window.location.href;
  return {
    url,
    title: document.title || 'Le travel book de chachou',
    text: `${document.title || 'Le travel book de chachou'}\n\n${url}`
  };
}

function getActiveSharePayload() {
  if (_shareContext) return _shareContext;
  return buildSharePayloadFromEditor() || buildSharePayloadFallback();
}

function openShareMenu(ctx) {
  _shareContext = ctx || null;
  const m = document.getElementById('share-modal');
  const nativeBtn = document.getElementById('btn-share-native');
  if (m) {
    m.classList.add('is-open');
    m.setAttribute('aria-hidden', 'false');
    if (nativeBtn && navigator.share) nativeBtn.style.display = '';
    else if (nativeBtn) nativeBtn.style.display = 'none';
  }
  document.body.style.overflow = 'hidden';
  document.querySelectorAll('.share-trigger[aria-haspopup="dialog"]').forEach(btn => {
    btn.setAttribute('aria-expanded', 'true');
  });
}

function closeShareMenu() {
  const m = document.getElementById('share-modal');
  if (m) {
    m.classList.remove('is-open');
    m.setAttribute('aria-hidden', 'true');
  }
  document.body.style.overflow = '';
  _shareContext = null;
  document.querySelectorAll('.share-trigger[aria-haspopup="dialog"]').forEach(btn => {
    btn.setAttribute('aria-expanded', 'false');
  });
}

async function shareCopyLink() {
  const { url } = getActiveSharePayload();
  try {
    await navigator.clipboard.writeText(url);
    toast('Lien copié');
    closeShareMenu();
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast('Lien copié');
      closeShareMenu();
    } catch {
      toast('Copie impossible — copie l’URL dans la barre d’adresse');
      closeShareMenu();
    }
    document.body.removeChild(ta);
  }
}

function shareByEmail() {
  const { title, text } = getActiveSharePayload();
  window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;
  closeShareMenu();
}

function shareByWhatsApp() {
  const { title, url } = getActiveSharePayload();
  const msg = `${title}\n\n${url}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
  closeShareMenu();
}

function shareBySms() {
  const { text } = getActiveSharePayload();
  window.location.href = `sms:?body=${encodeURIComponent(text)}`;
  closeShareMenu();
}

async function shareNative() {
  const p = getActiveSharePayload();
  if (!navigator.share) { toast('Partage système non disponible'); return; }
  try {
    await navigator.share({
      title: p.title,
      text: `${p.title}\n\n${p.url}`,
      url: p.url
    });
    closeShareMenu();
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    toast('Partage annulé');
  }
}


// ══════════════════════════════════════
// PAYS → DRAPEAU (fallback si pas de country_code OSM)
// ══════════════════════════════════════
function normCountryKey(str) {

  return String(str || '')
    .replace(/\u00f1/g, 'n')
    .replace(/\u0142/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[''′`´]/g, "'")
    .replace(/[^a-z0-9\s-]/gi, '')
    .replace(/\s+/g, ' ');
}

/** Noms FR / EN fréquents → ISO alpha-2 (minuscule en valeur) */


const TN_COUNTRY_NAME_TO_ISO = {
  france: 'fr', deutschland: 'de', allemagne: 'de', germany: 'de', belgium: 'be', belgique: 'be',
  suisse: 'ch', switzerland: 'ch', schweiz: 'ch',

  espagne: 'es', espana: 'es', españa: 'es', spain: 'es',

  italie: 'it', italia: 'it', italy: 'it',

  portugal: 'pt', 'pays-bas': 'nl', netherlands: 'nl', hollande: 'nl',

  luxembourg: 'lu',

  autriche: 'at', osterreich: 'at', austria: 'at', 'republique tcheque': 'cz',

  croatie: 'hr', slovenie: 'si','bosnie et herzegovine': 'ba', serbie: 'rs', montenegro: 'me', albanie: 'al',

  grece: 'gr', ellada: 'gr', greece: 'gr', norvege: 'no', norway: 'no', suede: 'se', sweden: 'se',

  danemark: 'dk', denmark: 'dk', finlande: 'fi', finland: 'fi', islande: 'is', irlande: 'ie', ireland: 'ie',

  pologne: 'pl', poland: 'pl', roumanie: 'ro', romania: 'ro', hongrie: 'hu', hungary: 'hu',

  bulgarie: 'bg', estonie: 'ee', lettonie: 'lv', lituanie: 'lt', malte: 'mt', chypre: 'cy', cyprus: 'cy',

  'royaume-uni': 'gb', 'united kingdom': 'gb', england: 'gb', ecosse: 'gb', scotland: 'gb', 'pays de galles': 'gb', wales: 'gb',

  'etats-unis': 'us', 'united states': 'us', 'united states of america': 'us', usa: 'us', canada: 'ca',

  mexique: 'mx', mexico: 'mx', bresil: 'br', brasil: 'br', brazil: 'br', argentine: 'ar', argentina: 'ar',

  chili: 'cl', chile: 'cl', colombie: 'co', colombia: 'co', perou: 'pe', peru: 'pe', equateur: 'ec', uruguay: 'uy',

  maroc: 'ma', tunisie: 'tn', algerie: 'dz', egypte: 'eg', israel: 'il', turquie: 'tr', turkiye: 'tr', turkey: 'tr',

  japon: 'jp', japan: 'jp', chine: 'cn', china: 'cn', 'coree du sud': 'kr', 'south korea': 'kr', korea: 'kr',

  thailande: 'th', thailand: 'th', vietnam: 'vn', singapour: 'sg', singapore: 'sg', malaisie: 'my', malaysia: 'my',

  indonesie: 'id', indonesia: 'id', philippines: 'ph', inde: 'in', india: 'in', nepal: 'np', 'sri lanka': 'lk',

  australie: 'au', australia: 'au', 'nouvelle-zelande': 'nz', 'new zealand': 'nz', fidji: 'fj', fiji: 'fj',

  emirats: 'ae', 'emirats arabes unis': 'ae', 'united arab emirates': 'ae', qatar: 'qa', arabie: 'sa',

  'arabie saoudite': 'sa', 'saudi arabia': 'sa', oman: 'om', koweit: 'kw', bahrein: 'bh', jordanie: 'jo', liban: 'lb',

  russie: 'ru', russia: 'ru', ukraine: 'ua', bielorussie: 'by', moldavie: 'md', georgie: 'ge', armenie: 'am', azerbaidjan: 'az',

  kenya: 'ke', tanzanie: 'tz', 'afrique du sud': 'za', 'south africa': 'za', senegal: 'sn', 'cote divoire': 'ci',

  'cote d ivoire': 'ci', cameroun: 'cm', nigeria: 'ng', ethiopie: 'et', madagascar: 'mg', 'ile maurice': 'mu',

  bolivie: 'bo', venezuela: 've', cuba: 'cu', jamaique: 'jm', jamaica: 'jm', 'costa rica': 'cr', panama: 'pa',

  maldives: 'mv', 'cap vert': 'cv', seychelles: 'sc', 'polynesie francaise': 'pf', 'new caledonia': 'nc', 'nouvelle caledonie': 'nc'

};

function isoFromCountryName(name) {

  const k = normCountryKey(name);
  if (!k) return '';
  const hit = TN_COUNTRY_NAME_TO_ISO[k];
  if (hit) return hit.toUpperCase();

  /* Côte → cote après norm */
  if (k.startsWith('cote') && /ivoire$/i.test(k)) return 'CI';


  /* Variantes États-Unis */
  if (/\betats uni/i.test(k) || /\bunites d amerique\b/i.test(k)) return 'US';

  /* DOM-TOM français — drapeau FR */
  const frOverseas = ['reunion','la reunion','guadeloupe','martinique','guyane','mayotte'];

  if (frOverseas.some(x => k.includes(x))) return 'FR';

  return '';

}

// ══════════════════════════════════════
// LOCATION SEARCH
// ══════════════════════════════════════
function onLocInput(val) {
  clearTimeout(locDebounceTimer);
  if (!val.trim()) { closeDropdown(); return; }
  locDebounceTimer = setTimeout(() => searchLocation(val), 400);
}

async function searchLocation(query) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8&accept-language=fr&addressdetails=1`,
      { headers: { 'Accept-Language': 'fr' } }
    );
    const results = await res.json();
    showDropdown(results, query);
  } catch (e) {
    console.warn('Nominatim error:', e);
  }
}

function showDropdown(results, query) {
  const dd = document.getElementById('loc-dropdown');
  dd.innerHTML = '';

  results.forEach(r => {
    const parts = r.display_name.split(', ');
    const name = parts[0];
    const region = parts.slice(1, 3).join(', ');

    const item = document.createElement('div');
    item.className = 'loc-dropdown-item';
    item.innerHTML = `<strong>${escHtml(name)}</strong><span>${escHtml(region)}</span>`;
    item.addEventListener('click', e => { e.stopPropagation(); selectLocation(r); });
    dd.appendChild(item);
  });

  const manual = document.createElement('div');
  manual.className = 'loc-dropdown-item manual';
  manual.textContent = `Ajouter manuellement "${query}"`;
  manual.addEventListener('click', e => { e.stopPropagation(); selectLocationManual(query); });
  dd.appendChild(manual);

  dd.style.display = 'block';
}

function closeDropdown() {
  const dd = document.getElementById('loc-dropdown');
  if (dd) dd.style.display = 'none';
}

function selectLocation(result) {
  const parts = result.display_name.split(', ');
  const name = parts[0];
  const country = parts[parts.length - 1];

  currentDest = `${name}, ${country}`;
  currentDestShort = currentDest;
  currentLat = parseFloat(result.lat);
  currentLng = parseFloat(result.lon);

  const ccRaw = result.address?.country_code;
  if (ccRaw && /^[a-z]{2}$/i.test(String(ccRaw)))
    currentCountryCode = String(ccRaw).toUpperCase();
  else
    currentCountryCode = isoFromCountryName(country) || '';

  applySelectedState();
  closeDropdown();
  updatePreview();
}

function selectLocationManual(name) {
  currentDest = name;
  currentDestShort = name;
  currentLat = null;
  currentLng = null;

  const comma = name.indexOf(',');
  const tail = comma > -1 ? name.slice(comma + 1).trim() : '';
  currentCountryCode = tail ? (isoFromCountryName(tail) || '') : '';

  document.getElementById('loc-input').value = '';
  applySelectedState();
  closeDropdown();
  updatePreview();
}

function applySelectedState() {
  document.getElementById('loc-search-state').style.display = 'none';
  document.getElementById('loc-selected-state').style.display = 'block';
  document.getElementById('loc-selected-name').textContent = currentDestShort;

  if (currentLat !== null && currentLng !== null) {
    const latDir = currentLat >= 0 ? 'N' : 'S';
    const lngDir = currentLng >= 0 ? 'E' : 'O';
    document.getElementById('loc-selected-coords').textContent =
      `${Math.abs(currentLat).toFixed(4)}° ${latDir}, ${Math.abs(currentLng).toFixed(4)}° ${lngDir}`;

    document.getElementById('mini-map').innerHTML =
      `<iframe src="https://www.openstreetmap.org/export/embed.html?bbox=${currentLng-.05},${currentLat-.05},${currentLng+.05},${currentLat+.05}&layer=mapnik&marker=${currentLat},${currentLng}" loading="lazy"></iframe>`;
  } else {
    document.getElementById('loc-selected-coords').textContent = 'Saisie manuelle';
    document.getElementById('mini-map').innerHTML =
      `<div class="mini-map-placeholder">Carte non disponible — saisie manuelle</div>`;
  }
}

function clearLocation() {
  currentDest = '';
  currentDestShort = '';
  currentCountryCode = '';
  currentLat = null;
  currentLng = null;
  document.getElementById('loc-search-state').style.display = 'block';
  document.getElementById('loc-selected-state').style.display = 'none';
  document.getElementById('loc-input').value = '';
  updatePreview();
}

// ══════════════════════════════════════
// GEOLOCATION
// ══════════════════════════════════════
async function geolocate() {
  if (!navigator.geolocation) { toast('Géolocalisation non disponible'); return; }

  const btn = document.getElementById('gps-btn');
  btn.classList.add('loading');

  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=fr&addressdetails=1`,
          { headers: { 'Accept-Language': 'fr' } }
        );
        const data = await res.json();
        const city = data.address?.city || data.address?.town || data.address?.village
          || data.display_name.split(',')[0];
        const country = data.address?.country || '';

        currentDest = country ? `${city}, ${country}` : city;
        currentDestShort = currentDest;
        currentLat = lat;
        currentLng = lng;

        const ccRaw = data.address?.country_code;
        if (ccRaw && /^[a-z]{2}$/i.test(String(ccRaw)))
          currentCountryCode = String(ccRaw).toUpperCase();
        else
          currentCountryCode = isoFromCountryName(country) || '';

        applySelectedState();
        updatePreview();
      } catch {
        toast('Erreur lors de la géolocalisation');
      }
      btn.classList.remove('loading');
    },
    () => {
      toast('Accès à la position refusé');
      btn.classList.remove('loading');
    },
    { timeout: 10000 }
  );
}

// ══════════════════════════════════════
// LISTS
// ══════════════════════════════════════
const PLACEHOLDERS = {
  hotels:      "Nom de l'hôtel, auberge, Airbnb...",
  restaurants: 'Nom du restaurant, type de cuisine...',
  boutiques:   'Boutique, marché, centre commercial...',
  lieux:       'Musée, monument, quartier, plage...'
};

function renderList(key, items) {
  const dataset = AUTOCOMPLETE_DATA[key] || [];
  const container = document.getElementById(`list-${key}`);
  container.innerHTML = '';

  items.forEach((val, i) => {
    const row = document.createElement('div');
    row.className = 'list-item-row';
    row.innerHTML = `
      <span class="list-item-num">${i + 1}</span>
      <div class="autocomplete-wrap">
        <input type="text" class="list-item-input"
          value="${escHtml(val)}"
          placeholder="${escHtml(PLACEHOLDERS[key] || '')}"
          autocomplete="off">
      </div>
      <button class="list-item-remove" onclick="removeItem('${key}',${i})">✕</button>`;
    container.appendChild(row);

    const input = row.querySelector('.list-item-input');
    input.addEventListener('input', () => {
      updatePreview();
      _accordionUpdateBadge(key);
    });
    _acAttach(input, dataset);
  });

  requestAnimationFrame(() => {
    _accordionRefreshHeight(key);
    _accordionUpdateBadge(key);
  });
}

function getListData(key) {
  return Array.from(
    document.getElementById(`list-${key}`).querySelectorAll('.list-item-input')
  ).map(i => i.value);
}

function addItem(key) {
  const items = getListData(key);
  items.push('');
  renderList(key, items);
  const inputs = document.getElementById(`list-${key}`).querySelectorAll('.list-item-input');
  inputs[inputs.length - 1].focus();
  updatePreview();
}

function removeItem(key, idx) {
  const items = getListData(key);
  if (items.length <= 1) {
    items[0] = '';
    renderList(key, items);
  } else {
    items.splice(idx, 1);
    renderList(key, items);
  }
  updatePreview();
}

// ══════════════════════════════════════
// PHOTOS
// ══════════════════════════════════════
function onDragOver(e) {
  e.preventDefault();
  document.getElementById('photo-drop-zone').classList.add('dragover');
}

function onDragLeave() {
  document.getElementById('photo-drop-zone').classList.remove('dragover');
}

function onDrop(e) {
  e.preventDefault();
  document.getElementById('photo-drop-zone').classList.remove('dragover');
  onPhotoFiles(e.dataTransfer.files);
}

function onPhotoFiles(files) {
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      currentPhotos.push(e.target.result);
      renderPhotoGrid();
      updatePreview();
    };
    reader.readAsDataURL(file);
  });
}

function renderPhotoGrid() {
  const grid = document.getElementById('photo-grid');
  grid.innerHTML = '';
  currentPhotos.forEach((src, i) => {
    const div = document.createElement('div');
    div.className = 'photo-thumb';
    div.innerHTML = `<img src="${src}" alt="Photo ${i+1}">
      <button class="photo-thumb-remove" onclick="removePhoto(${i})">✕</button>`;
    grid.appendChild(div);
  });
}

function removePhoto(i) {
  currentPhotos.splice(i, 1);
  renderPhotoGrid();
  updatePreview();
}

// ══════════════════════════════════════
// PREVIEW
// ══════════════════════════════════════
function updatePreview() {
  const mois = document.getElementById('sel-mois').value;
  const annee = document.getElementById('sel-annee').value;
  const notes = document.getElementById('notes-textarea')?.value || '';
  const periodStr = [mois, annee].filter(Boolean).join(' ');

  const hotels      = getListData('hotels').filter(x => x.trim());
  const restaurants = getListData('restaurants').filter(x => x.trim());
  const boutiques   = getListData('boutiques').filter(x => x.trim());
  const lieux       = getListData('lieux').filter(x => x.trim());

  let ville = currentDest, paysTail = '';
  const firstComma = currentDest.indexOf(',');
  if (firstComma > -1) {
    ville = currentDest.substring(0, firstComma).trim();
    paysTail = currentDest.substring(firstComma + 1).trim();
  }
  let paysForIso = paysTail;
  const lastComma = currentDest.lastIndexOf(',');
  if (lastComma > -1) paysForIso = currentDest.substring(lastComma + 1).trim();

  const ccStored = (currentCountryCode || '').trim().toUpperCase();
  let flagIso = /^[A-Z]{2}$/.test(ccStored) ? ccStored : '';
  if (!flagIso && paysForIso) flagIso = isoFromCountryName(paysForIso) || '';

  const coverTitle = currentDest
    ? `${escHtml(ville)}${paysTail ? `<span class="pays">, ${escHtml(paysTail)}</span>` : ''}`
    : `<em style="color:var(--gold-light);font-style:italic">Ma destination</em>`;

  const flagMid = flagIso
    ? `<div class="preview-cover-flag-wrap" role="img" aria-label="Drapeau ${escHtml(paysForIso || flagIso)}">
      <div class="preview-flag-ring">
        <img src="https://flagcdn.com/w80/${flagIso.toLowerCase()}.png" alt="" width="72" height="72" class="preview-flag-img" loading="lazy" decoding="async" referrerpolicy="no-referrer">
      </div>
    </div>`
    : '';

  let html = `<div class="preview-cover">
    <div class="preview-cover-header">
      <div class="preview-cover-brand">Le travel book <em style="font-style:italic;color:var(--gold-light);opacity:.9">de chachou</em></div>
      ${flagMid}
      <div class="preview-cover-period-top">${periodStr.trim() ? escHtml(periodStr.toUpperCase()) : '&nbsp;'}</div>
    </div>
    <div class="preview-cover-title">${coverTitle}</div>
    <div class="preview-cover-period-bottom">${escHtml(periodStr) || '&nbsp;'}</div>
    ${currentLat !== null
      ? `<div class="preview-cover-coords">${Math.abs(currentLat).toFixed(4)}° ${currentLat >= 0 ? 'N' : 'S'} &middot; ${Math.abs(currentLng).toFixed(4)}° ${currentLng >= 0 ? 'E' : 'O'}</div>`
      : ''}
    <div class="preview-cover-line"></div>
  </div>`;

  // Photos
  if (currentPhotos.length > 0) {
    html += '<div class="preview-photos">';
    if (currentPhotos.length === 1) {
      html += `<div class="preview-photos-1"><img src="${currentPhotos[0]}" alt=""></div>`;
    } else if (currentPhotos.length === 2) {
      html += `<div class="preview-photos-2">
        <img src="${currentPhotos[0]}" alt="">
        <img src="${currentPhotos[1]}" alt="">
      </div>`;
    } else {
      html += `<div class="preview-photos-3plus">
        <img class="main-photo" src="${currentPhotos[0]}" alt="">
        <div class="side-photos">
          <img src="${currentPhotos[1]}" alt="">
          <img src="${currentPhotos[2]}" alt="">
        </div>
      </div>`;
    }
    html += '</div>';
  }

  // Map
  html += '<div class="preview-map">';
  if (currentLat !== null && currentLng !== null) {
    html += `<iframe src="https://www.openstreetmap.org/export/embed.html?bbox=${currentLng-.05},${currentLat-.05},${currentLng+.05},${currentLat+.05}&layer=mapnik&marker=${currentLat},${currentLng}" loading="lazy"></iframe>`;
  } else {
    html += `<div class="preview-map-placeholder">Carte non disponible</div>`;
  }
  html += '</div>';

  // Body
  html += '<div class="preview-body">';

  const sections = [
    { label: 'Hébergement',        items: hotels },
    { label: 'Restaurants',        items: restaurants },
    { label: 'Shopping & Boutiques', items: boutiques },
    { label: 'Visites & Lieux',    items: lieux }
  ];

  sections.forEach(sec => {
    html += `<div class="preview-section">
      <div class="preview-section-header">
        <div class="preview-section-square"></div>
        <div class="preview-section-title">${escHtml(sec.label)}</div>
        <div class="preview-section-line"></div>
      </div>`;
    if (sec.items.length === 0) {
      html += `<div class="preview-empty">Aucun élément renseigné</div>`;
    } else {
      sec.items.forEach(item => {
        html += `<div class="preview-item">
          <div class="preview-item-bullet"></div>
          <div class="preview-item-text">${escHtml(item)}</div>
        </div>`;
      });
    }
    html += '</div>';
  });

  if (notes.trim()) {
    html += `<div class="preview-notes">
      <div class="preview-notes-text">${escHtml(notes).replace(/\n/g, '<br>')}</div>
    </div>`;
  }

  html += `<div class="preview-footer">
    <div class="preview-footer-text">${escHtml(currentDest || '—')}</div>
    <div class="preview-footer-text">${escHtml(periodStr || '—')}</div>
  </div>`;

  html += '</div>'; // preview-body

  document.getElementById('preview-content').innerHTML = html;
}

// ══════════════════════════════════════
// COLLECT / SAVE / NEW
// ══════════════════════════════════════
function collectFiche() {
  return {
    dest:       currentDest,
    destShort:  currentDestShort,
    countryCode: currentCountryCode || '',
    lat:        currentLat,
    lng:       currentLng,
    mois:      document.getElementById('sel-mois').value,
    annee:     document.getElementById('sel-annee').value,
    hotels:      getListData('hotels').filter(x => x.trim()),
    restaurants: getListData('restaurants').filter(x => x.trim()),
    boutiques:   getListData('boutiques').filter(x => x.trim()),
    lieux:       getListData('lieux').filter(x => x.trim()),
    notes:     document.getElementById('notes-textarea').value,
    photos:    currentPhotos,
    savedAt:   new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  };
}

async function saveFiche() {
  if (!currentDest.trim()) { toast('Veuillez sélectionner une destination'); return; }
  const fiche = collectFiche();
  const payload = buildDbPayload(fiche);
  try {
    if (editingId) {
      const { error } = await supabase.from('fiches').update(payload).eq('id', editingId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('fiches').insert(payload).select('id').single();
      if (error) throw error;
      if (data?.id) editingId = data.id;
    }
    toast('Fiche sauvegardée !');
    await refreshFichesFromSupabase();
    renderFicheList();
  } catch (e) {
    console.error(e);
    toast('Erreur lors de la sauvegarde');
  }
}

/**
 * Vide le formulaire (destination, cartes, listes avec une ligne vide, notes, photos, édition).
 * Ne change pas les onglets ni la vue prévisualisation.
 */
function resetFormCore() {
  editingId = null;
  currentDest = '';
  currentDestShort = '';
  currentCountryCode = '';
  currentLat = null;
  currentLng = null;
  currentPhotos = [];

  document.getElementById('loc-search-state').style.display = 'block';
  document.getElementById('loc-selected-state').style.display = 'none';
  document.getElementById('loc-input').value = '';
  document.getElementById('sel-mois').value = '';
  document.getElementById('sel-annee').value = '';
  document.getElementById('notes-textarea').value = '';

  closeDropdown();

  initLists();
  ['hotels', 'restaurants', 'boutiques', 'lieux'].forEach(k => _accordionUpdateBadge(k));

  renderPhotoGrid();

  const banner = document.getElementById('shared-banner');
  if (banner) banner.remove();

  document.querySelectorAll('#lists-accordion .accordion-item').forEach(ai => _accordionClose(ai));
  const firstAccItem = document.querySelector('#lists-accordion .accordion-item');
  if (firstAccItem) _accordionOpen(firstAccItem);

  updatePreview();
}

function newFiche() {
  if (!confirmAbandonIfEditing()) return;
  resetFormCore();
  switchTab('form', { skipFormReset: true });
  switchView('editor');
  const sc = document.querySelector('#editorView .editor-scroll');
  if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' });
}

function loadFicheIntoForm(fiche) {
  currentDest      = fiche.dest || '';
  currentDestShort = fiche.destShort || fiche.dest || '';
  const rawCC = fiche.countryCode;
  currentCountryCode = (typeof rawCC === 'string' && /^[a-z]{2}$/i.test(rawCC)) ? rawCC.toUpperCase() : '';
  if (!currentCountryCode && currentDest) {
    const lc = currentDest.lastIndexOf(',');
    if (lc > -1)
      currentCountryCode = isoFromCountryName(currentDest.slice(lc + 1).trim()) || '';
  }
  currentLat       = fiche.lat ?? null;
  currentLng       = fiche.lng ?? null;
  currentPhotos    = Array.isArray(fiche.photos) ? fiche.photos : [];

  if (currentDest) {
    applySelectedState();
  } else {
    document.getElementById('loc-search-state').style.display = 'block';
    document.getElementById('loc-selected-state').style.display = 'none';
  }

  document.getElementById('sel-mois').value = fiche.mois || '';
  document.getElementById('sel-annee').value = fiche.annee || '';
  document.getElementById('notes-textarea').value = fiche.notes || '';

  renderList('hotels',      fiche.hotels?.length      ? fiche.hotels      : ['']);
  renderList('restaurants', fiche.restaurants?.length ? fiche.restaurants : ['']);
  renderList('boutiques',   fiche.boutiques?.length   ? fiche.boutiques   : ['']);
  renderList('lieux',       fiche.lieux?.length       ? fiche.lieux       : ['']);

  renderPhotoGrid();
  updatePreview();
}

// ══════════════════════════════════════
// MY NOTES LIST
// ══════════════════════════════════════
function renderFicheList() {
  const container = document.getElementById('fiches-list');
  if (!container) return;

  if (fiches.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">✦</div>
      <div class="empty-state-text">Aucune fiche sauvegardée.<br>Créez votre première destination !</div>
    </div>`;
    return;
  }

  container.innerHTML = fiches.map((f, i) => `
    <div class="fiche-card" role="button" tabindex="0" onclick="openFicheDetail(${i})"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openFicheDetail(${i});}">
      <div class="fiche-card-top"></div>
      <div class="fiche-card-body">
        <div class="fiche-card-dest">${escHtml(f.dest || 'Destination inconnue')}</div>
        <div class="fiche-card-meta">${escHtml([f.mois, f.annee].filter(Boolean).join(' · '))}</div>
        <div class="fiche-card-stats">
          <div class="fiche-stat">
            <span class="fiche-stat-num">${(f.hotels||[]).length}</span>
            <span class="fiche-stat-label">Hôtels</span>
          </div>
          <div class="fiche-stat">
            <span class="fiche-stat-num">${(f.restaurants||[]).length}</span>
            <span class="fiche-stat-label">Restos</span>
          </div>
          <div class="fiche-stat">
            <span class="fiche-stat-num">${(f.lieux||[]).length}</span>
            <span class="fiche-stat-label">Visites</span>
          </div>
          <div class="fiche-stat">
            <span class="fiche-stat-num">${(f.boutiques||[]).length}</span>
            <span class="fiche-stat-label">Shopping</span>
          </div>
        </div>
        <div class="fiche-card-actions" onclick="event.stopPropagation()">
          <button type="button" class="fiche-action-btn" onclick="event.stopPropagation(); editFiche(${i})">Modifier</button>
          <button type="button" class="fiche-action-btn" onclick="event.stopPropagation(); shareFiche(${i})">Partager</button>
          <button type="button" class="fiche-action-btn pdf" onclick="event.stopPropagation(); exportFichePDF(${i})">PDF</button>
          <button type="button" class="fiche-action-btn delete" onclick="event.stopPropagation(); deleteFiche(${i})">Supprimer</button>
        </div>
      </div>
    </div>`).join('');
}

function editFiche(i) {
  const f = fiches[i];
  if (!f?.id) { toast('Impossible d’ouvrir cette fiche'); return; }
  closeDetailPanel();
  editingId = f.id;
  loadFicheIntoForm(f);
  switchTab('form', { skipFormReset: true });
  switchView('editor');
  const sc = document.querySelector('#editorView .editor-scroll');
  if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteFiche(i) {
  const f = fiches[i];
  if (!f?.id) return;
  if (!confirm(`Supprimer la fiche "${f.dest}" ?`)) return;
  try {
    const { error } = await supabase.from('fiches').delete().eq('id', f.id);
    if (error) throw error;
    await refreshFichesFromSupabase();
    if (detailFicheIdx === i) {
      closeDetailPanel({ goList: true });
    } else {
      renderFicheList();
    }
    toast('Fiche supprimée');
    updateNavBar();
  } catch (e) {
    console.error(e);
    toast('Erreur lors de la suppression');
  }
}

function shareFiche(i) {
  openShareMenu(buildSharePayloadFromSavedFiche(fiches[i]));
}

// ══════════════════════════════════════
// SHARED FICHE
// ══════════════════════════════════════
function showSharedFiche(fiche) {
  window._sharedFiche = fiche;

  const formTab = document.getElementById('tab-form');
  const banner = document.createElement('div');
  banner.id = 'shared-banner';
  banner.className = 'shared-banner';
  banner.innerHTML = `
    <div class="shared-banner-title">✦ Fiche partagée</div>
    <div class="shared-banner-actions">
      <button class="btn-add-shared" onclick="addSharedFiche()">Ajouter à mes fiches</button>
      <button class="btn-create-mine" onclick="newFiche()">Créer la mienne</button>
    </div>`;
  formTab.insertBefore(banner, formTab.firstChild);

  loadFicheIntoForm(fiche);
}

async function addSharedFiche() {
  if (!window._sharedFiche) return;
  const shared = window._sharedFiche;
  const fiche = {
    ...shared,
    savedAt: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  };
  const key = f => (f.dest || '') + (f.mois || '') + (f.annee || '');
  if (fiches.some(f => key(f) === key(fiche))) {
    toast('Cette fiche est déjà dans vos fiches');
    return;
  }
  const payload = buildDbPayload(fiche);
  try {
    const { error } = await supabase.from('fiches').insert(payload);
    if (error) throw error;
    await refreshFichesFromSupabase();
    renderFicheList();
    toast('Fiche ajoutée à vos fiches !');
  } catch (e) {
    console.error(e);
    toast('Erreur lors de l’ajout de la fiche');
  }
}

// ══════════════════════════════════════
// EXPORT / IMPORT JSON
// ══════════════════════════════════════
function exportAllJSON() {
  if (fiches.length === 0) { toast('Aucune fiche à exporter'); return; }
  const blob = new Blob([JSON.stringify(fiches, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'travel-book-chachou-backup.json'; a.click();
  URL.revokeObjectURL(url);
}

function importJSON(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error('Format invalide');
      const dupKey = f => (f.dest || '') + (f.mois || '') + (f.annee || '');
      const existingKeys = new Set(fiches.map(dupKey));
      let added = 0;
      for (const raw of imported) {
        const fk = dupKey(raw);
        if (existingKeys.has(fk)) continue;
        const payload = buildDbPayload({
          ...raw,
          dest: raw.dest,
          hotels: coerceJsonArray(raw.hotels),
          restaurants: coerceJsonArray(raw.restaurants),
          boutiques: coerceJsonArray(raw.boutiques),
          lieux: coerceJsonArray(raw.lieux),
          notes: raw.notes || '',
          photos: coercePhotosUrls(raw.photos),
          lat: raw.lat ?? null,
          lng: raw.lng ?? null,
          mois: raw.mois || '',
          annee: raw.annee || '',
          destShort: raw.destShort,
          countryCode: raw.countryCode,
          savedAt: raw.savedAt || raw.saved_at
        });
        const { error } = await supabase.from('fiches').insert(payload);
        if (!error) {
          existingKeys.add(fk);
          added++;
        }
      }
      await refreshFichesFromSupabase();
      renderFicheList();
      toast(`Import réussi — ${added} nouvelle(s) fiche(s) ajoutée(s)`);
    } catch (err) {
      console.warn(err);
      toast("Erreur lors de l'import");
    }
    input.value = '';
  };
  reader.readAsText(file);
}


// ══════════════════════════════════════
// PDF EXPORT
// ══════════════════════════════════════
async function exportPDF() {
  if (!currentDest.trim()) { toast('Sélectionnez une destination avant de générer le PDF'); return; }
  await generatePDF(collectFiche());
}

async function exportFichePDF(i) {
  await generatePDF(fiches[i]);
}

async function generatePDF(fiche) {
  if (!window.jspdf) { toast('jsPDF non chargé — vérifiez votre connexion'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const ML = 18, W = 210, TW = 174;

  const C = {
    ink:       [28,  53,  87],
    gold:      [91,  143, 168],
    goldLight: [240, 235, 224],
    red:       [192, 57,  43],
    dark:      [28,  53,  87],
    muted:     [107, 127, 142],
    border:    [91,  143, 168],
    section:   [240, 235, 224],
    white:     [255, 255, 255],
    greyLight: [148, 163, 184]
  };

  // ── COVER ──
  doc.setFillColor(...C.dark);
  doc.rect(0, 0, W, 62, 'F');

  doc.setFillColor(...C.red);
  doc.rect(0, 62, W, 3, 'F');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...C.greyLight);
  doc.text('LE TRAVEL BOOK DE CHACHOU', ML, 12);

  const moisAnnee = [fiche.mois, fiche.annee].filter(Boolean).join(' ').toUpperCase();
  if (moisAnnee) {
    doc.setTextColor(...C.gold);
    doc.text(moisAnnee, W - ML - doc.getTextWidth(moisAnnee), 12);
  }

  let ville = fiche.dest || '', pays = '';
  const ci2 = ville.indexOf(',');
  if (ci2 > -1) { pays = ville.substring(ci2 + 1).trim(); ville = ville.substring(0, ci2).trim(); }

  doc.setFont('times', 'italic');
  doc.setFontSize(36);
  doc.setTextColor(...C.white);
  doc.text(ville, ML, 42);

  if (pays) {
    const vw = doc.getTextWidth(ville);
    doc.setFontSize(20);
    doc.setTextColor(...C.goldLight);
    doc.text(`, ${pays}`, ML + vw + 1, 42);
  }

  if (moisAnnee) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(180, 178, 170);
    doc.text(moisAnnee, ML, 52);
  }

  if (fiche.lat != null && fiche.lng != null) {
    const coords = `${Math.abs(fiche.lat).toFixed(4)}° ${fiche.lat >= 0 ? 'N' : 'S'}  ${Math.abs(fiche.lng).toFixed(4)}° ${fiche.lng >= 0 ? 'E' : 'O'}`;
    doc.setFontSize(7);
    doc.setTextColor(140, 136, 130);
    doc.text(coords, W - ML - doc.getTextWidth(coords), 58);
  }

  let yPos = 65;

  // ── PHOTOS ──
  if (fiche.photos && fiche.photos.length > 0) {
    const photos = fiche.photos.slice(0, 3);
    if (photos.length === 1) {
      try { doc.addImage(photos[0], 'JPEG', 0, yPos, W, 45); } catch {}
      yPos += 45;
    } else if (photos.length === 2) {
      const hw = (W - 1) / 2;
      try { doc.addImage(photos[0], 'JPEG', 0, yPos, hw, 35); } catch {}
      try { doc.addImage(photos[1], 'JPEG', hw + 1, yPos, hw, 35); } catch {}
      yPos += 35;
    } else {
      const mw = W * 0.55, sw = W - mw - 1;
      try { doc.addImage(photos[0], 'JPEG', 0, yPos, mw, 35); } catch {}
      try { doc.addImage(photos[1], 'JPEG', mw + 1, yPos, sw, 17); } catch {}
      try { doc.addImage(photos[2], 'JPEG', mw + 1, yPos + 18, sw, 17); } catch {}
      yPos += 35;
    }
  }

  yPos += 4;

  function checkPage(h) {
    if (yPos + h > 281) { doc.addPage(); yPos = 16; }
  }

  function drawSection(label, items) {
    if (!items || items.length === 0) return;
    checkPage(22);

    doc.setFillColor(...C.red);
    doc.rect(ML, yPos, 5, 5, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.red);
    const lbl = label.toUpperCase();
    doc.text(lbl, ML + 7, yPos + 3.8);

    const lx = ML + 7 + doc.getTextWidth(lbl) + 3;
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.3);
    doc.line(lx, yPos + 2.5, W - ML, yPos + 2.5);

    yPos += 9;

    items.forEach((item, idx) => {
      const lines = doc.splitTextToSize(item, TW - 8);
      const itemH = lines.length * 5 + 4;
      checkPage(itemH + 2);

      doc.setFillColor(...C.red);
      doc.circle(ML + 2.5, yPos + 2.5, 1, 'F');

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...C.ink);
      lines.forEach((line, li) => doc.text(line, ML + 6, yPos + 4.5 + li * 5));

      yPos += itemH;

      if (idx < items.length - 1) {
        doc.setDrawColor(...C.section);
        doc.setLineWidth(0.2);
        doc.line(ML, yPos, W - ML, yPos);
        yPos += 1;
      }
    });

    yPos += 5;
  }

  drawSection('Hébergement',        fiche.hotels);
  drawSection('Restaurants',        fiche.restaurants);
  drawSection('Shopping & Boutiques', fiche.boutiques);
  drawSection('Visites & Lieux',    fiche.lieux);

  // ── NOTES ──
  if (fiche.notes && fiche.notes.trim()) {
    const lines = doc.splitTextToSize(fiche.notes, TW - 10);
    const boxH = lines.length * 5 + 12;
    checkPage(boxH + 6);

    doc.setFillColor(...C.section);
    doc.rect(ML, yPos, TW, boxH, 'F');

    doc.setFillColor(...C.gold);
    doc.rect(ML, yPos, 2, boxH, 'F');

    doc.setFont('times', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(...C.muted);
    lines.forEach((line, i) => doc.text(line, ML + 6, yPos + 8 + i * 5));

    yPos += boxH + 4;
  }

  // ── FOOTER (all pages) ──
  const total = doc.internal.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    const fy = 290;

    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.3);
    doc.line(ML, fy - 4, W - ML, fy - 4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(175, 170, 163);

    doc.text((fiche.dest || '').toUpperCase(), ML, fy);

    const period = [fiche.mois, fiche.annee].filter(Boolean).join(' ').toUpperCase();
    if (period) doc.text(period, W - ML - doc.getTextWidth(period), fy);

    const pg = `${p} / ${total}`;
    doc.text(pg, W / 2 - doc.getTextWidth(pg) / 2, fy);
  }

  const slug = (fiche.dest || 'voyage').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  doc.save(`travel-book-chachou-${slug}-${fiche.annee || 'voyage'}.pdf`);
  toast('PDF téléchargé !');
}

// ══════════════════════════════════════
// UTILS
// ══════════════════════════════════════
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Attributs onclick du HTML — les modules ES n'exposent pas de globales */
Object.assign(window, {
  openFicheDetail,
  switchView,
  editFromPreview,
  switchTab,
  navBarBack,
  openShareMenu,
  closeShareMenu,
  shareCopyLink,
  shareByEmail,
  shareByWhatsApp,
  shareBySms,
  shareNative,
  geolocate,
  clearLocation,
  addItem,
  exportAllJSON,
  importJSON,
  exportPDF,
  saveFiche,
  newFiche,
  removeItem,
  removePhoto,
  editFiche,
  shareFiche,
  exportFichePDF,
  deleteFiche,
  addSharedFiche,
  onLocInput,
  updatePreview,
  onPhotoFiles,
  searchLocation
});