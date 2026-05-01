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
/** index dans fiches[] pour la vue détail lecture seule */
let detailFicheIdx = null;
/** id Supabase de la fiche ouverte en plein écran — null si aucune ; préféré à l’index (réordonnancement) */
let detailFicheId = null;

let _detailFlagGen = 0;
let _ficheListFlagGen = 0;
let currentPhotos = [];
let currentLat = null;
let currentLng = null;
let currentDest = '';
let currentDestShort = '';
let currentCountryCode = ''; /* ISO 3166-1 alpha-2 — fourni par Nominatim quand disponible */

/** Date d’entrée au format YYYY-MM-DD (navigateur ou fuseau de la destination). */
let journalEntryDateISO = '';

let locDebounceTimer = null;

function frenchLongDateLabel(d) {
  return new Date(d).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function isoDateLocal(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function setJournalDateDisplay(label) {
  const el = document.getElementById('journal-date-display');
  if (!el || !label) return;
  el.textContent = label.charAt(0).toUpperCase() + label.slice(1);
}

function applyBrowserJournalDate() {
  const d = new Date();
  journalEntryDateISO = isoDateLocal(d);
  setJournalDateDisplay(frenchLongDateLabel(d));
}

async function refreshJournalDisplayedDate() {
  const latOk = typeof currentLat === 'number' && Number.isFinite(currentLat);
  const lngOk = typeof currentLng === 'number' && Number.isFinite(currentLng);

  if (latOk && lngOk) {
    try {
      const res = await fetch(
        `https://timeapi.io/api/time/current/coordinate?latitude=${currentLat}&longitude=${currentLng}`
      );
      const data = await res.json();
      const dateTime = data?.dateTime;
      if (typeof dateTime !== 'string' || dateTime.length < 10) throw new Error('missing dateTime');

      journalEntryDateISO = dateTime.slice(0, 10);
      const parsed = new Date(dateTime);
      if (Number.isNaN(parsed.getTime())) throw new Error('invalid date');
      setJournalDateDisplay(
        parsed.toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        })
      );
    } catch {
      applyBrowserJournalDate();
    }
  } else applyBrowserJournalDate();
}

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
      showSharedFiche(sharedFiche);
      updateNavBar();
      return;
    } catch (e) {
      console.warn('Shared fiche parse error:', e);
    }
  }

  applyBrowserJournalDate();
  renderPhotoGrid();
  renderFicheList();
  updateNavBar();
});

/** BFCache retour/avant : réinitialiser le détail — évite une fiche « collée » (ex. Bordeaux partout). */
window.addEventListener('pageshow', e => {
  if (!e.persisted) return;
  clearDetailSelectionAndDom();
  hideDetailOverlayIfVisible();
  updateNavBar();
});


document.addEventListener('keydown', e => {

  if (e.key !== 'Escape') return;
  const m = document.getElementById('share-modal');
  if (m && m.classList.contains('is-open')) closeShareMenu();


});


// ══════════════════════════════════════
// TAB SWITCHING : Mon journal ↔ Mes fiches
// ══════════════════════════════════════
function ensureEditorVisible() {
  document.getElementById('editorView')?.classList.add('active');
}
function clearDetailSelectionAndDom() {
  detailFicheIdx = null;
  detailFicheId = null;
  const dc = document.getElementById('detail-content');
  if (dc) dc.innerHTML = '';
  _detailFlagGen++;
}

/** Ferme l’overlay détail sans toucher aux onglets (editor déjà visible). */
function hideDetailOverlayIfVisible() {
  const dv = document.getElementById('detailView');
  const ev = document.getElementById('editorView');
  if (dv?.classList.contains('active')) {
    dv.classList.remove('active');
    ev?.classList.add('active');
  }
}

/**
 * @param {'journal'|'list'} tab
 * @param {{ skipJournalReset?: boolean, skipDetailReset?: boolean }} [options]
 */
function switchTab(tab, options = {}) {
  const { skipJournalReset = false, skipDetailReset = false } = options;

  if (tab === 'journal' && !skipJournalReset) resetJournalForm();

  const toJournal = tab === 'journal';

  if (!toJournal && !skipDetailReset) {
    clearDetailSelectionAndDom();
    hideDetailOverlayIfVisible();
  }

  const tj = document.getElementById('tab-journal');
  const tl = document.getElementById('tab-list');
  if (tj) {
    tj.classList.toggle('active', toJournal);
    tj.toggleAttribute('hidden', !toJournal);
  }
  if (tl) {
    tl.classList.toggle('active', !toJournal);
    tl.toggleAttribute('hidden', toJournal);
  }
  const jBtn = document.getElementById('tab-journal-btn');
  const lBtn = document.getElementById('tab-list-btn');
  if (jBtn) jBtn.classList.toggle('active', toJournal);
  if (lBtn) lBtn.classList.toggle('active', !toJournal);

  if (!toJournal) renderFicheList();
  ensureEditorVisible();
  updateNavBar();
  return true;
}

/** Accueil = onglet journal seul, sans panneau détail. */
function currentPageIsHome() {
  if (detailFicheIdx != null || detailFicheId != null || document.getElementById('detailView')?.classList.contains('active')) return false;
  const editorVisible = document.getElementById('editorView')?.classList.contains('active');
  const journalTab = document.getElementById('tab-journal')?.classList.contains('active');
  return editorVisible && !!journalTab;
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

/** Remonte tous les conteneurs scrollables principaux (+ fenêtre sur mobile). */
function scrollAppToTop(opts = {}) {
  const behavior = opts.instant ? 'auto' : 'smooth';
  const tryScroll = el => {
    if (!el) return;
    try {
      el.scrollTo({ top: 0, left: 0, behavior });
    } catch {
      el.scrollTop = 0;
    }
  };
  tryScroll(window);
  tryScroll(document.documentElement);
  tryScroll(document.body);
  tryScroll(document.querySelector('#editorView .editor-scroll'));
  tryScroll(document.getElementById('detailView'));
}

/** Clic sur la barre du titre → journal vierge. */
function navSiteTitleGoHome(ev) {
  if (ev?.target?.closest?.('#topnav-back')) return;
  closeShareMenu();
  switchTab('journal', { skipJournalReset: false });
  scrollAppToTop();
}

function navBarBack() {
  if (detailFicheIdx != null || detailFicheId != null || document.getElementById('detailView')?.classList.contains('active')) {
    closeDetailPanel({ goList: true });
    return;
  }
  if (document.getElementById('tab-list')?.classList.contains('active')) {
    switchTab('journal');
    return;
  }
}

function closeDetailPanel(opts = {}) {
  clearDetailSelectionAndDom();
  const dv = document.getElementById('detailView');
  const ev = document.getElementById('editorView');
  if (dv) dv.classList.remove('active');
  if (ev) ev.classList.add('active');
  if (opts.goList && document.getElementById('tab-list'))
    switchTab('list', { skipJournalReset: true, skipDetailReset: true });
  updateNavBar();
}

/**
 * Drapeau : code ISO sauvegardé ou pays (extractCountry / restcountries translation) → circle-flags SVG.
 * Échec silencieux (emplacement vide).
 * @param {object} f
 */
function scheduleDetailCountryFlag(f) {
  const gen = ++_detailFlagGen;
  const wrap = document.getElementById('detail-flag-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  (async () => {
    let url = null;
    try {
      url = await resolveCircleFlagSvgUrl(f.dest || '', f.countryCode || '');
    } catch {
      /* silence */
    }
    if (gen !== _detailFlagGen || !wrap.isConnected || !url) return;
    wrap.innerHTML =
      `<img class="detail-flag-img" src="${escHtml(url)}" alt="" width="80" height="80" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
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
  if (detailFicheId != null && f.id && String(f.id) !== String(detailFicheId)) return;

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
      <div id="detail-flag-wrap" class="detail-flag-wrap" aria-hidden="true"></div>
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
      <button type="button" class="btn-detail-pdf" onclick="event.stopPropagation(); exportFichePDF(${idx})">↓ PDF</button>
    </div>`;

  scheduleDetailCountryFlag(f);
}

function openFicheDetail(idx) {
  const f = fiches[idx];
  if (!f) return;
  detailFicheIdx = idx;
  detailFicheId = f.id != null ? String(f.id) : null;
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
function toastDismiss() {
  const el = document.getElementById('toast');
  if (!el) return;
  clearTimeout(el._timer);
  el._timer = null;
  el.textContent = '';
  el.classList.remove('show', 'toast--loading');
}

function toast(msg, opts = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  const text = msg == null ? '' : String(msg).trim();
  const { loading = false, persist = false } = opts;
  clearTimeout(el._timer);
  el.classList.toggle('toast--loading', loading);
  if (!text && !loading) {
    toastDismiss();
    return;
  }
  el.textContent = text;
  el.classList.add('show');
  if (!persist && !loading)
    el._timer = setTimeout(() => {
      el.classList.remove('show', 'toast--loading');
    }, 2800);
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
  return buildSharePayloadFallback();
}


function openShareMenu(ctx) {
  _shareContext = ctx || null;
  const m = document.getElementById('share-modal');
  const list = m?.querySelector('.share-modal-list');
  document.getElementById('btn-share-native')?.remove();
  if (m) {
    m.classList.add('is-open');
    m.setAttribute('aria-hidden', 'false');
    if (list && typeof navigator.share === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'btn-share-native';
      btn.className = 'share-option-btn share-option-native';
      btn.onclick = shareNative;
      btn.innerHTML = `<svg class="share-opt-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><span>Partager…<span class="share-option-meta">Menu système (mobile)</span></span>`;
      list.insertBefore(btn, list.firstChild);
    }
  }
  document.body.style.overflow = 'hidden';
  document.querySelectorAll('.share-trigger[aria-haspopup="dialog"]').forEach(btn => {
    btn.setAttribute('aria-expanded', 'true');
  });
}

function closeShareMenu() {
  document.getElementById('btn-share-native')?.remove();
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

/** SVG ronds HatScripts circle-flags (jsDelivr) — suffixe fichier = ISO alpha-2 minuscules */
const CIRCLE_FLAGS_BASE = 'https://cdn.jsdelivr.net/gh/HatScripts/circle-flags@2.7.0/flags';

/**
 * Pays = dernière partie après virgules (ex. « Istanbul, Turquie » → « Turquie » ; sans virgule = chaîne entière).
 * @param {string} dest
 */
function extractCountry(dest) {
  if (dest == null || String(dest).trim() === '') return '';
  const parts = String(dest).split(',');
  return parts[parts.length - 1].trim();
}

async function circleFlagSvgUrlFromCountryName(countryName) {
  const name = String(countryName || '').trim();
  if (!name) return null;
  const apiUrl = `https://restcountries.com/v3.1/translation/${encodeURIComponent(name)}?fields=cca2`;
  try {
    const r = await fetch(apiUrl);
    if (!r.ok) return null;
    const data = await r.json();
    const hit = Array.isArray(data) && data[0];
    const cca2 = hit?.cca2;
    if (!cca2 || !/^[a-z]{2}$/i.test(String(cca2))) return null;
    return `${CIRCLE_FLAGS_BASE}/${String(cca2).toLowerCase()}.svg`;
  } catch {
    return null;
  }
}

/** @returns {Promise<string|null>} URL .svg circle-flags */
async function resolveCircleFlagSvgUrl(dest, storedCca2) {
  const raw = typeof storedCca2 === 'string' ? storedCca2.trim() : '';
  if (/^[a-z]{2}$/i.test(raw)) return `${CIRCLE_FLAGS_BASE}/${raw.toLowerCase()}.svg`;
  const country = extractCountry(dest);
  if (!country) return null;
  return circleFlagSvgUrlFromCountryName(country);
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
  if (!dd) return;
  dd.innerHTML = '';

  try {
    (results || []).forEach(r => {
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
  } catch (e) {
    console.warn('showDropdown:', e);
    closeDropdown();
  }
}

function closeDropdown() {
  const dd = document.getElementById('loc-dropdown');
  if (!dd) return;
  dd.style.display = 'none';
  dd.innerHTML = '';
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

  void refreshJournalDisplayedDate();
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
  const mm = document.getElementById('mini-map');
  if (mm) mm.innerHTML = '';
  void refreshJournalDisplayedDate();
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
}

// ══════════════════════════════════════
// JOURNAL — saisie quotidienne & Claude → fiches
// ══════════════════════════════════════

function resetJournalForm() {
  currentDest = '';
  currentDestShort = '';
  currentCountryCode = '';
  currentLat = null;
  currentLng = null;
  currentPhotos = [];

  document.getElementById('loc-search-state').style.display = 'block';
  document.getElementById('loc-selected-state').style.display = 'none';
  document.getElementById('loc-input').value = '';
  closeDropdown();

  void refreshJournalDisplayedDate();

  const body = document.getElementById('journal-body');
  if (body) body.value = '';

  renderPhotoGrid();

  document.querySelectorAll('#tab-journal .shared-banner, #shared-banner').forEach(el => el.remove());
}

function newJournalEntry() {
  resetJournalForm();
  switchTab('journal', { skipJournalReset: true });
  const sc = document.querySelector('#editorView .editor-scroll');
  if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' });
}

function mergeUniqueNormalized(base, additions) {
  const out = Array.isArray(base) ? [...base] : [];
  const seen = new Set(out.map(x => String(x).toLowerCase().trim()));
  for (const x of additions || []) {
    const t = String(x).trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function collectJournalPhotosFromEntries(rows) {
  const seen = new Set();
  const urls = [];
  for (const row of rows || []) {
    const u = unwrapPhotosBlob(row.photos).urls;
    for (const x of u) {
      const s = String(x).trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      urls.push(s);
      if (urls.length >= 18) break;
    }
    if (urls.length >= 18) break;
  }
  return urls;
}

function extractAnthropicJson(data) {
  const block =
    Array.isArray(data?.content)
      ? data.content.find(c => c && c.type === 'text')
      : null;
  let raw = block?.text;
  if (typeof raw !== 'string') raw = '{}';
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return {
      dest: '',
      hotels: [],
      restaurants: [],
      lieux: [],
      boutiques: [],
      notes: ''
    };
  }
}

function anthropicMessagesUrl() {
  return '/api/claude';
}

function anthropicRequestHeaders() {
  return { 'Content-Type': 'application/json' };
}

/** Fiche existante dont le champ `dest` contient le pays (ex. « France » dans « Bordeaux, France »). */
async function fetchFicheByPays(destRef) {
  const pays =
    extractCountry(destRef || '').trim() || String(destRef || '').trim();
  if (!pays) return null;
  const { data, error } = await supabase
    .from('fiches')
    .select('*')
    .ilike('dest', `%${pays}%`)
    .limit(1);
  if (error) {
    console.warn('[fiches] ilike', error);
    return null;
  }
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function analyseJournalEtMettreAJourFiche(destinationNorm) {
  const destLookup = destinationNorm.trim();
  if (!destLookup) return;

  const { data: entries, error: fetchErr } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('destination', destLookup)
    .order('date', { ascending: true });

  if (fetchErr) throw fetchErr;
  const rows = Array.isArray(entries) ? entries : [];
  if (rows.length === 0) return;

  const payloadClaude = rows.map(r => ({
    destination: r.destination,
    date: r.date,
    texte: r.texte ?? '',
    lat: r.lat ?? null,
    lng: r.lng ?? null
  }));

  const systemPrompt = `Tu es un assistant voyage. Analyse ces entrées de journal et extrais les informations.
Réponds UNIQUEMENT en JSON valide sans markdown ni backticks :
{
  "dest": "Ville, Pays",
  "hotels": ["hotel1"],
  "restaurants": ["resto1"],
  "lieux": ["lieu1"],
  "boutiques": ["boutique1"],
  "notes": "Synthèse courte des impressions"
}
Ne duplique pas les éléments. Fusionne intelligemment.`;

  const resp = await fetch(anthropicMessagesUrl(), {
    method: 'POST',
    headers: anthropicRequestHeaders(),
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: JSON.stringify(payloadClaude) }]
    })
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.error?.message || resp.statusText || 'Anthropic erreur';
    throw new Error(msg);
  }

  const json = extractAnthropicJson(data);

  const destForFiche =
    typeof json.dest === 'string' && json.dest.trim() ? json.dest.trim() : destLookup;

  const first = rows[0];
  const d0 =
    typeof first?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(first.date)
      ? new Date(`${first.date}T12:00:00`)
      : new Date();
  const mois = d0.toLocaleDateString('fr-FR', { month: 'long' });
  const annee = String(d0.getFullYear());
  const savedLabel = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const paysRef = extractCountry(destForFiche || destLookup) || extractCountry(destLookup) || destLookup;
  let ficheExistante =
    (await fetchFicheByPays(paysRef)) || (await fetchFicheByPays(destLookup));

  const journalPhotoUrls = collectJournalPhotosFromEntries(rows);

  const metaCountry =
    extractCountry(destForFiche || destLookup || '')
      ? isoFromCountryName(extractCountry(destForFiche || destLookup || '')) || ''
      : '';
  const countryGuess =
    metaCountry ||
    currentCountryCode ||
    (extractCountry(destForFiche || '') ? isoFromCountryName(extractCountry(destForFiche)) || '' : '');

  if (ficheExistante) {
    const app = rowToApp(ficheExistante);
    const merged = {
      dest: destForFiche || app.dest || destLookup,
      lat: app.lat ?? first?.lat ?? null,
      lng: app.lng ?? first?.lng ?? null,
      mois: app.mois || mois,
      annee: app.annee || annee,
      hotels: mergeUniqueNormalized(app.hotels, coerceJsonArray(json.hotels)),
      restaurants: mergeUniqueNormalized(app.restaurants, coerceJsonArray(json.restaurants)),
      lieux: mergeUniqueNormalized(app.lieux, coerceJsonArray(json.lieux)),
      boutiques: mergeUniqueNormalized(app.boutiques, coerceJsonArray(json.boutiques)),
      notes: typeof json.notes === 'string' ? json.notes : app.notes || '',
      photos: mergeUniqueNormalized(coercePhotosUrls(app.photos), journalPhotoUrls),
      destShort: app.destShort || (destForFiche || destLookup).split(',')[0]?.trim() || '',
      countryCode:
        app.countryCode ||
        (typeof countryGuess === 'string' ? countryGuess : '') ||
        (typeof metaCountry === 'string' ? metaCountry : ''),
      savedAt: savedLabel
    };
    const payload = buildDbPayload(merged);
    const { error: upErr } = await supabase.from('fiches').update(payload).eq('id', ficheExistante.id);
    if (upErr) throw upErr;
    return;
  }

  const ins = buildDbPayload({
    dest: destForFiche,
    lat: first?.lat ?? null,
    lng: first?.lng ?? null,
    mois,
    annee,
    hotels: coerceJsonArray(json.hotels),
    restaurants: coerceJsonArray(json.restaurants),
    lieux: coerceJsonArray(json.lieux),
    boutiques: coerceJsonArray(json.boutiques),
    notes: typeof json.notes === 'string' ? json.notes : '',
    photos: journalPhotoUrls,
    destShort: destForFiche.split(',')[0]?.trim() || destForFiche,
    countryCode: typeof countryGuess === 'string' ? countryGuess : '',
    savedAt: savedLabel
  });

  const { error: insErr } = await supabase.from('fiches').insert(ins);
  if (insErr) throw insErr;
}

async function saveJournalEntry() {
  const destTrim = currentDest.trim();
  if (!destTrim) {
    toast('Choisis une destination pour cette entrée.');
    return;
  }

  const entry_date = (journalEntryDateISO || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) {
    toast('Date indisponible — attends le chargement ou réessaie.');
    return;
  }

  const texte = document.getElementById('journal-body')?.value || '';
  const photos = coercePhotosUrls(currentPhotos);

  const rowPayload = {
    destination: destTrim,
    lat: currentLat ?? null,
    lng: currentLng ?? null,
    date: entry_date,
    texte,
    photos
  };

  try {
    const { error } = await supabase.from('journal_entries').insert(rowPayload);
    if (error) throw error;
  } catch (e) {
    console.error(e);
    toast("Impossible d’enregistrer le journal — vérifie les colonnes Supabase.");
    return;
  }

  toast('✨ Analyse de ta journée en cours...', { loading: true, persist: true });

  try {
    await analyseJournalEtMettreAJourFiche(destTrim);
    toastDismiss();
    toast('✨ Fiche mise à jour !');
    await refreshFichesFromSupabase();
    renderFicheList();
  } catch (e) {
    console.warn('[Claude / fiches]', e);
    toastDismiss();
    toast(
      'Journal sauvegardé. La mise à jour auto de la fiche a échoué — réessaie plus tard.',
      {
        persist: false
      }
    );
    try {
      await refreshFichesFromSupabase();
      renderFicheList();
    } catch {
      /* silence */
    }
  }
}

// ══════════════════════════════════════
// MY NOTES LIST
// ══════════════════════════════════════
async function scheduleFicheListFlags(renderGen) {
  const slots = document.querySelectorAll('#fiches-list .fiche-card-flag-slot');
  await Promise.all(
    Array.from(slots).map(async slot => {
      const idx = Number(slot.dataset.ficheIdx);
      const f = fiches[idx];
      if (!f) return;
      let url = null;
      try {
        url = await resolveCircleFlagSvgUrl(f.dest || '', f.countryCode || '');
      } catch {
        /* silence */
      }
      if (renderGen !== _ficheListFlagGen || !slot.isConnected || !url) return;
      slot.removeAttribute('aria-hidden');
      slot.innerHTML =
        `<img src="${escHtml(url)}" alt="" width="32" height="32" loading="lazy" decoding="async" class="fiche-flag-img" referrerpolicy="no-referrer">`;
    })
  );
}

function ficheListCountryLabel(f) {
  const p = extractCountry(f?.dest || '');
  return p && String(p).trim() ? String(p).trim() : 'Sans pays';
}

function renderFicheList() {
  const container = document.getElementById('fiches-list');
  if (!container) return;

  if (fiches.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">✦</div>
      <div class="empty-state-text">Aucune fiche encore.<br>Remplis une journée dans Mon journal — la fiche se crée automatiquement.</div>
    </div>`;
    return;
  }

  const byCountry = new Map();
  fiches.forEach((f, i) => {
    if (!f) return;
    const label = ficheListCountryLabel(f);
    if (!byCountry.has(label)) byCountry.set(label, []);
    byCountry.get(label).push({ f, idx: i });
  });

  const countries = [...byCountry.keys()].sort((a, b) =>
    a.localeCompare(b, 'fr', { sensitivity: 'base' })
  );

  const cardHtml = (f, i) => `
    <div class="fiche-card" role="button" tabindex="0" onclick="openFicheDetail(${i})"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openFicheDetail(${i});}">
      <div class="fiche-card-body">
        <div class="fiche-card-title-row">
          <div class="fiche-card-flag-slot" data-fiche-idx="${i}" aria-hidden="true"></div>
          <div class="fiche-card-dest">${escHtml(f.dest || 'Destination inconnue')}</div>
        </div>
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
          <button type="button" class="fiche-action-btn" onclick="event.stopPropagation(); shareFiche(${i})">Partager</button>
          <button type="button" class="fiche-action-btn pdf" onclick="event.stopPropagation(); exportFichePDF(${i})">PDF</button>
          <button type="button" class="fiche-action-btn delete" onclick="event.stopPropagation(); deleteFiche(${i})">Supprimer</button>
        </div>
      </div>
    </div>`;

  const parts = [];
  for (const c of countries) {
    parts.push(`<h2 class="fiche-country-title">${escHtml(c)}</h2>`);
    for (const { f, idx } of byCountry.get(c)) parts.push(cardHtml(f, idx));
  }

  const gen = ++_ficheListFlagGen;
  container.innerHTML = parts.join('');
  queueMicrotask(() => void scheduleFicheListFlags(gen));
}
async function deleteFiche(i) {
  const f = fiches[i];
  if (!f?.id) return;
  if (!confirm(`Supprimer la fiche "${f.dest}" ?`)) return;
  try {
    const { error } = await supabase.from('fiches').delete().eq('id', f.id);
    if (error) throw error;
    await refreshFichesFromSupabase();
    const openSame =
      (f.id != null && detailFicheId != null && String(f.id) === String(detailFicheId)) ||
      detailFicheIdx === i;
    if (openSame) {
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
function dismissSharedBannerAndJournal() {
  window._sharedFiche = null;
  document.querySelectorAll('#shared-banner').forEach(el => el.remove());
  resetJournalForm();
  switchTab('journal', { skipJournalReset: true });
}

function showSharedFiche(fiche) {
  window._sharedFiche = fiche;
  switchTab('journal', { skipJournalReset: true });
  document.querySelectorAll('#shared-banner').forEach(el => el.remove());

  const formTab = document.getElementById('tab-journal');
  const banner = document.createElement('div');
  banner.id = 'shared-banner';
  banner.className = 'shared-banner';
  const titre = escHtml(fiche?.dest || 'Fiche reçue');
  banner.innerHTML = `
    <div class="shared-banner-title">✦ Fiche partagée — ${titre}</div>
    <div class="shared-banner-actions">
      <button type="button" class="btn-add-shared" onclick="addSharedFiche()">Ajouter à mes fiches</button>
      <button type="button" class="btn-create-mine" onclick="dismissSharedBannerAndJournal()">Fermer et écrire mon journal</button>
    </div>`;
  formTab.insertBefore(banner, formTab.firstChild);
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
// PDF EXPORT (fiches uniquement depuis Mes fiches)
// ══════════════════════════════════════
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
  navSiteTitleGoHome,
  openFicheDetail,
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
  exportAllJSON,
  importJSON,
  removePhoto,
  shareFiche,
  exportFichePDF,
  deleteFiche,
  addSharedFiche,
  dismissSharedBannerAndJournal,
  saveJournalEntry,
  newJournalEntry,
  onLocInput,
  onPhotoFiles,
  searchLocation
});