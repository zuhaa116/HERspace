/* ═══════════════════════════════════════════════
   HerSpace — app.js
   ═══════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────
   0. AUTH GATE — runs before everything else
   ───────────────────────────────────────────────── */
   
let currentUser = null;
let mentorsLoaded = false;
let allMentors = [];
async function bootstrapAuth() {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (!data.user) {
      window.location.replace('/');
      return;
    }
    currentUser = data.user;
    renderHeaderUser();
  } catch (err) {
    window.location.replace('/');
  }
}

function renderHeaderUser() {
  if (!currentUser) return;
  const firstName = currentUser.name.trim().split(/\s+/)[0];
  const nameEl = document.getElementById('user-name-display');
  if (nameEl) nameEl.textContent = firstName;

  const avatarEl = document.getElementById('user-avatar');
  if (!avatarEl) return;
  if (currentUser.avatarFilename) {
    avatarEl.innerHTML = `<img src="/uploads/${encodeURIComponent(currentUser.avatarFilename)}" alt="" />`;
  } else {
    const parts = currentUser.name.trim().split(/\s+/);
    const initials = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
    avatarEl.textContent = initials || currentUser.name[0].toUpperCase();
  }
}
/* ─── Home card shortcuts ─── */
function goToHealthTracker() {
  switchScreen('chatbot');
  // Wait for chatbot screen to render, then jump to Health sub-tab
  setTimeout(() => { if (typeof switchSubTab === 'function') switchSubTab('health'); }, 50);
}

/* ─── Profile modal ─── */
let pendingAvatarFile = null;
let pendingCvFile = null;

function openProfileModal() {
  if (!currentUser) return;
  pendingAvatarFile = null;
  pendingCvFile = null;

  document.getElementById('pm-name').textContent = currentUser.name;
  document.getElementById('pm-email').textContent = currentUser.email;
  document.getElementById('pm-phone').value = currentUser.phone || '';
  document.getElementById('pm-cv-name').textContent = currentUser.cvFilename ? 'CV uploaded ✓' : 'Choose file…';

  const preview = document.getElementById('pm-avatar-preview');
  if (currentUser.avatarFilename) {
    preview.innerHTML = `<img src="/uploads/${encodeURIComponent(currentUser.avatarFilename)}" alt="" />`;
  } else {
    const parts = currentUser.name.trim().split(/\s+/);
    const initials = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
    preview.textContent = initials || currentUser.name[0].toUpperCase();
  }

  document.getElementById('profile-error').hidden = true;
  document.getElementById('profile-success').hidden = true;
  document.getElementById('profile-modal').classList.add('active');
}

function closeProfileModal() {
  document.getElementById('profile-modal').classList.remove('active');
}

function onAvatarChosen(e) {
  const file = e.target.files[0];
  if (!file) return;
  pendingAvatarFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById('pm-avatar-preview').innerHTML = `<img src="${ev.target.result}" alt="" />`;
  };
  reader.readAsDataURL(file);
}

function onProfileCvChosen(e) {
  const file = e.target.files[0];
  if (!file) return;
  pendingCvFile = file;
  document.getElementById('pm-cv-name').textContent = file.name;
}

async function saveProfile() {
  const errEl = document.getElementById('profile-error');
  const okEl = document.getElementById('profile-success');
  const btn = document.getElementById('profile-save-btn');
  errEl.hidden = true; okEl.hidden = true;

  const form = new FormData();
  form.append('phone', document.getElementById('pm-phone').value.trim());
  if (pendingAvatarFile) form.append('avatar', pendingAvatarFile);
  if (pendingCvFile) form.append('cv', pendingCvFile);

  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch('/api/profile', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Could not save.';
      errEl.hidden = false;
      btn.disabled = false; btn.textContent = 'Save changes';
      return;
    }
    currentUser = data.user;
    renderHeaderUser();
    okEl.hidden = false;
    btn.disabled = false; btn.textContent = 'Save changes';
    setTimeout(closeProfileModal, 900);
  } catch (err) {
    errEl.textContent = 'Could not reach server.';
    errEl.hidden = false;
    btn.disabled = false; btn.textContent = 'Save changes';
  }
}

async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch (e) { /* still bounce to landing */ }
  window.location.replace('/');
}

document.addEventListener('DOMContentLoaded', bootstrapAuth);

/* ─────────────────────────────────────────────────
   1. SCREEN NAVIGATION
   ───────────────────────────────────────────────── */
const SCREENS = ['home', 'community', 'map', 'chatbot'];

function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById('screen-' + name);
  if (screen) screen.classList.add('active');

  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.remove('nav-tab-active');
    t.removeAttribute('aria-current');
  });
  const nav = document.getElementById('nav-' + name);
  if (nav) {
    nav.classList.add('nav-tab-active');
    nav.setAttribute('aria-current', 'page');
  }

  if (name === 'map' && !mapInitialised) initMap();

  // Always load companies when community is opened — defensive against stale state
  if (name === 'community') {
    if (!companiesLoaded) {
      console.log('[switchScreen] community opened, calling loadCompanies');
      loadCompanies();
    } else {
      console.log('[switchScreen] community already loaded');
    }
  }

}
/* ─────────────────────────────────────────────────
   2. COMMUNITY PILL TABS
   ───────────────────────────────────────────────── */
function communityTab(name) {
  ['workplaces', 'mentors'].forEach(id => {
    const btn = document.getElementById('tab-' + id);
    if (btn) {
      btn.classList.toggle('pill-tab-active', id === name);
      btn.setAttribute('aria-selected', id === name ? 'true' : 'false');
    }
    const panel = document.getElementById('panel-' + id);
    if (panel) panel.classList.toggle('active-panel', id === name);
  });

  // Update search placeholder for context
  const searchInput = document.getElementById('community-search');
  if (searchInput) {
    searchInput.placeholder = name === 'mentors' ? 'Search mentors…' : 'Search workplaces...';
  }

  // Lazy-load mentors the first time the tab opens
  if (name === 'mentors' && !mentorsLoaded) loadMentors();
}

let allCompanies = [];
let companiesLoaded = false;

async function loadCompanies() {
  if (companiesLoaded) return;
  const cityEl = document.getElementById('community-city');
  if (cityEl && currentUser) cityEl.textContent = currentUser.city;

  const listEl = document.getElementById('company-list');
  const loadingEl = document.getElementById('company-loading');
  const emptyEl = document.getElementById('company-empty');

  if (!listEl || !loadingEl || !emptyEl) {
    console.error('Community panel elements missing');
    return;
  }

  refreshCvBannerFromUser();
  listEl.innerHTML = '';
  loadingEl.style.display = 'block';
  emptyEl.hidden = true;

  try {
    const res = await fetch('/api/companies');
    console.log('[loadCompanies] status', res.status);
    if (!res.ok) throw new Error('Server error ' + res.status);
    const data = await res.json();
    console.log('[loadCompanies] got', data.companies?.length, 'companies');
    allCompanies = data.companies || [];
    companiesLoaded = true;
    loadingEl.style.display = 'none';
    renderCompanies(allCompanies);
  } catch (err) {
    console.error('[loadCompanies] error:', err);
    loadingEl.style.display = 'none';
    listEl.innerHTML = `<p class="company-error">Could not load companies. <a href="#" onclick="companiesLoaded=false;loadCompanies();return false;">Try again</a></p>`;
  }
}

function renderCompanies(companies) {
  const listEl = document.getElementById('company-list');
  const emptyEl = document.getElementById('company-empty');
  listEl.innerHTML = '';

if (!companies.length) {
  emptyEl.hidden = false;
  emptyEl.innerHTML = '<p>No jobs matched your CV strongly enough this week. <a href="#" onclick="companiesLoaded=false;loadCompanies();return false;">Refresh</a> or try uploading a different CV.</p>';
  return;
}
  emptyEl.hidden = true;

  companies.forEach((c, idx) => {
    const ratingNum = parseFloat(c.rating) || 0;
    const ratingClass = ratingNum >= 4.0 ? 'badge-sage' : (ratingNum >= 3.5 ? 'badge-parchment' : 'badge-blush');
    const tagPills = (c.tags || []).map(t => {
      const cls = /Safe|Maternity|Flexible|Hybrid|Day-care|Equal/.test(t) ? 'badge-sage'
        : /Mixed|Male-dom/.test(t) ? 'badge-parchment' : 'badge-blush';
      return `<span class="badge-pill ${cls}">${escapeHtml(t)}</span>`;
    }).join('');

    const card = document.createElement('article');
    card.className = 'standard-card company-card';
    card.setAttribute('tabindex', '0');
    card.innerHTML = `
      <div class="review-header">
        <div>
          <p class="review-company">${escapeHtml(c.name)}</p>
          <p class="opp-meta">${escapeHtml(c.industry || '')}${c.locationNote ? ' · ' + escapeHtml(c.locationNote) : ''}</p>
        </div>
        <span class="badge-pill ${ratingClass}">${ratingNum.toFixed(1)} ★</span>
      </div>
      ${tagPills ? `<div class="badge-row" style="margin: 6px 0;">${tagPills}</div>` : ''}
  ${c.matchReason ? `<p class="company-match-reason">${c.matchScore ? `<strong>${c.matchScore}% match</strong> · ` : ''}${escapeHtml(c.matchReason)}</p>` : ''}
${c.quote ? `<p class="review-quote">"${escapeHtml(c.quote)}"</p>` : ''}
      <p class="review-meta">${c.reviewCount || 0} reviews · AI-suggested · Tap for details</p>
    `;
    card.addEventListener('click', () => openCompanyModal(idx));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openCompanyModal(idx); });
    listEl.appendChild(card);
  });
}

function filterCompanies() {
  const q = document.getElementById('community-search').value.trim().toLowerCase();
  // Figure out which tab is active
  const onMentors = document.getElementById('panel-mentors')?.classList.contains('active-panel');

  if (onMentors) {
    if (!q) return renderMentors(allMentors);
    const filtered = allMentors.filter(m =>
      (m.name || '').toLowerCase().includes(q) ||
      (m.industry || '').toLowerCase().includes(q) ||
      (m.company || '').toLowerCase().includes(q) ||
      (m.title || '').toLowerCase().includes(q) ||
      (m.expertise || []).some(t => t.toLowerCase().includes(q))
    );
    renderMentors(filtered);
  } else {
    if (!q) return renderCompanies(allCompanies);
    const filtered = allCompanies.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.industry || '').toLowerCase().includes(q) ||
      (c.tags || []).some(t => t.toLowerCase().includes(q))
    );
    renderCompanies(filtered);
  }
}

function openCompanyModal(idx) {
  const c = allCompanies[idx];
  if (!c) return;

  document.getElementById('cm-name').textContent = c.name || 'Company';
  document.getElementById('cm-industry').textContent = `${c.industry || ''}${c.locationNote ? ' · ' + c.locationNote : ''}`;

  const ratingNum = parseFloat(c.rating) || 0;
  const ratingEl = document.getElementById('cm-rating');
  ratingEl.textContent = `${ratingNum.toFixed(1)} ★`;
  ratingEl.className = 'badge-pill ' + (ratingNum >= 4.0 ? 'badge-sage' : (ratingNum >= 3.5 ? 'badge-parchment' : 'badge-blush'));
  document.getElementById('cm-rating-note').textContent = c.ratingNote || '';

  const tagsEl = document.getElementById('cm-tags');
  tagsEl.innerHTML = (c.tags || []).map(t => {
    const cls = /Safe|Maternity|Flexible|Hybrid|Day-care|Equal/.test(t) ? 'badge-sage'
      : /Mixed|Male-dom/.test(t) ? 'badge-parchment' : 'badge-blush';
    return `<span class="badge-pill ${cls}">${escapeHtml(t)}</span>`;
  }).join('');

  document.getElementById('cm-quote').textContent = c.quote ? `"${c.quote}"` : '';
  document.getElementById('cm-reviews').textContent = `${c.reviewCount || 0} reviews · AI-suggested`;

  const rolesEl = document.getElementById('cm-roles');
if (c.openRoles && c.openRoles.length) {
  rolesEl.innerHTML = c.openRoles.map(r => {
    if (c.realJobLink) {
      return `<a class="role-chip role-chip-link" href="${escapeAttr(c.realJobLink)}" target="_blank" rel="noopener">${escapeHtml(r)} →</a>`;
    }
    return `<span class="role-chip">${escapeHtml(r)}</span>`;
  }).join('');
} else {
  rolesEl.innerHTML = '<p class="company-modal-empty">No open roles listed.</p>';
}

  const contactEl = document.getElementById('cm-contact');
  const parts = [];
  if (c.website) parts.push(`<a class="contact-row" href="${escapeAttr(c.website)}" target="_blank" rel="noopener"><span class="contact-icon">🌐</span><span>${escapeHtml(c.website)}</span></a>`);
  if (c.email) parts.push(`<a class="contact-row" href="mailto:${escapeAttr(c.email)}"><span class="contact-icon">✉</span><span>${escapeHtml(c.email)}</span></a>`);
  if (c.phone) parts.push(`<a class="contact-row" href="tel:${escapeAttr(c.phone.replace(/[^0-9+]/g, ''))}"><span class="contact-icon">📞</span><span>${escapeHtml(c.phone)}</span></a>`);
  contactEl.innerHTML = parts.length ? parts.join('') : '<p class="company-modal-empty">No verified contact details — search the company website to apply.</p>';
// Update disclaimer based on data source
const discEl = document.getElementById('cm-disclaimer');
if (discEl) {
  discEl.textContent = c.realJobLink
    ? '✦ Real job listing from across the web. Tap a role to apply.'
    : '✦ AI-suggested — verify on the company\'s official website before applying.';
}
  const modal = document.getElementById('company-modal');
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.add('active');
}

function closeCompanyModal() {
  const modal = document.getElementById('company-modal');
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('active');
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

if (typeof escapeHtml !== 'function') {
  window.escapeHtml = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* ─── MENTORS ─── */
  let allMentors = [];
  let mentorsLoaded = false;

  async function loadMentors() {
  if (mentorsLoaded) return;
  const listEl = document.getElementById('mentor-list');
  const loadingEl = document.getElementById('mentor-loading');
  const emptyEl = document.getElementById('mentor-empty');

  if (!listEl || !loadingEl || !emptyEl) {
    console.error('Mentor panel elements missing — check app.html for #mentor-list, #mentor-loading, #mentor-empty');
    return;
  }

  listEl.innerHTML = '';

  function renderMentors(mentors) {
    const listEl = document.getElementById('mentor-list');
    const emptyEl = document.getElementById('mentor-empty');
    listEl.innerHTML = '';

    if (!mentors.length) { emptyEl.hidden = false; return; }
    emptyEl.hidden = true;

    mentors.forEach((m, idx) => {
      const rating = parseFloat(m.rating) || 0;
      const initials = (m.name || 'M').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
      const expertiseRow = (m.expertise || []).slice(0, 3).map(t =>
        `<span class="badge-pill badge-sage">${escapeHtml(t)}</span>`
      ).join('');

      const card = document.createElement('article');
      card.className = 'standard-card company-card mentor-card';
      card.setAttribute('tabindex', '0');
      card.innerHTML = `
      <div class="mentor-card-top">
        <div class="mentor-avatar">${escapeHtml(initials)}</div>
        <div class="mentor-card-name-wrap">
          <p class="review-company">${escapeHtml(m.name || 'Mentor')}</p>
          <p class="opp-meta">${escapeHtml(m.title || '')}${m.company ? ' · ' + escapeHtml(m.company) : ''}</p>
        </div>
        <span class="badge-pill badge-sage">${rating.toFixed(1)} ★</span>
      </div>
      ${expertiseRow ? `<div class="badge-row" style="margin: 6px 0;">${expertiseRow}</div>` : ''}
      <p class="review-meta">${m.yearsExperience || 0} yrs exp · ${m.mentees || 0} mentees · Tap for details</p>
    `;
      card.addEventListener('click', () => openMentorModal(idx));
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openMentorModal(idx); });
      listEl.appendChild(card);
    });
  }

  function openMentorModal(idx) {
    const m = allMentors[idx];
    if (!m) return;

    const initials = (m.name || 'M').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    document.getElementById('mm-avatar').textContent = initials;
    document.getElementById('mm-name').textContent = m.name || 'Mentor';
    document.getElementById('mm-title').textContent = `${m.title || ''}${m.company ? ' · ' + m.company : ''}`;

    const rating = parseFloat(m.rating) || 0;
    document.getElementById('mm-rating').textContent = `${rating.toFixed(1)} ★`;
    document.getElementById('mm-exp').textContent = `${m.yearsExperience || 0} yrs experience`;

    document.getElementById('mm-bio').textContent = m.bio ? `"${m.bio}"` : '';

    const expertEl = document.getElementById('mm-expertise');
    expertEl.innerHTML = (m.expertise || []).map(t => `<span class="badge-pill badge-sage">${escapeHtml(t)}</span>`).join('') || '<p class="company-modal-empty">No expertise tags listed.</p>';

    document.getElementById('mm-availability').textContent = m.availability || 'On request';
    document.getElementById('mm-mentees').textContent = `${m.mentees || 0} mentees so far`;

    document.getElementById('mm-languages').textContent = (m.languages || []).join(' · ') || 'Not specified';

    const contactEl = document.getElementById('mm-contact');
    const parts = [];
    if (m.linkedin) parts.push(`<a class="contact-row" href="${escapeAttr(m.linkedin.startsWith('http') ? m.linkedin : 'https://' + m.linkedin)}" target="_blank" rel="noopener"><span class="contact-icon">in</span><span>${escapeHtml(m.linkedin)}</span></a>`);
    if (m.email) parts.push(`<a class="contact-row" href="mailto:${escapeAttr(m.email)}"><span class="contact-icon">✉</span><span>${escapeHtml(m.email)}</span></a>`);
    contactEl.innerHTML = parts.length ? parts.join('') : '<p class="company-modal-empty">No contact details — connect after sign-up.</p>';

    const modal = document.getElementById('mentor-modal');
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('active');
  }

  function closeMentorModal() {
    const modal = document.getElementById('mentor-modal');
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('active');
  }
}

/* ─────────────────────────────────────────────────
   3. SAFE MAP — Light theme, routing, trip tracking
   ───────────────────────────────────────────────── */
let leafletMap = null;
let mapInitialised = false;
let allReports = [];
let reportLayers = [];

// Routing state
let originMarker = null;
let destinationMarker = null;
let originLatLng = null;
let destinationLatLng = null;
let routeLayer = null;
let routeData = null; // { coords, distanceM, expectedSeconds }

// Trip state
let tripActive = false;
let tripTimer = null;
let tripStartTime = 0;
let tripGpsWatchId = null;
let simulatedDot = null;
let simulatedIndex = 0;
let simulationInterval = null;

// Report placement state
let reportPlacementMode = false;
let pendingReportLatLng = null;
let pendingReportMarker = null;

const ORIGIN_LATLNG = [31.5204, 74.3587]; // Lahore center (Gulberg)

function initMap() {
  if (mapInitialised) return;
  mapInitialised = true;

  leafletMap = L.map('safe-map', {
    center: ORIGIN_LATLNG,
    zoom: 13,
    zoomControl: false,
    attributionControl: false,
  });

  // Light, modern theme — CartoDB Voyager
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(leafletMap);

  // Static origin (the user's current location for the demo)
  originMarker = L.marker(ORIGIN_LATLNG, {
    icon: L.divIcon({
      className: '',
      html: '<div class="map-pin pin-origin"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    }),
  }).addTo(leafletMap).bindTooltip('You are here', { direction: 'top' });
  originLatLng = ORIGIN_LATLNG;

  // Click handler — for placing a report pin
  leafletMap.on('click', (e) => {
    if (!reportPlacementMode) return;
    pendingReportLatLng = e.latlng;
    if (pendingReportMarker) leafletMap.removeLayer(pendingReportMarker);
    pendingReportMarker = L.marker(e.latlng, {
      icon: L.divIcon({ className: '', html: '<div class="map-pin pin-pending"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
    }).addTo(leafletMap);
    document.getElementById('report-location-text').textContent = `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}  ✓`;
  });

  loadReports();
}

function mapZoomIn() { if (leafletMap) leafletMap.zoomIn(); }
function mapZoomOut() { if (leafletMap) leafletMap.zoomOut(); }

/* ─── Reports — render as permanent red zones ─── */
async function loadReports() {
  try {
    const res = await fetch('/api/reports');
    const data = await res.json();
    allReports = data.reports || [];
    renderReports();
  } catch (e) { console.error('Could not load reports', e); }
}

function renderReports() {
  reportLayers.forEach(l => leafletMap.removeLayer(l));
  reportLayers = [];

  // Each report becomes a translucent red circle (300m radius — "danger zone")
  allReports.forEach(r => {
    const circle = L.circle([r.lat, r.lng], {
      radius: 250,
      color: '#E94B4B',
      weight: 1.5,
      opacity: 0.7,
      fillColor: '#E94B4B',
      fillOpacity: 0.18,
      dashArray: '4, 4',
    }).addTo(leafletMap);
    circle.bindTooltip(`${categoryLabel(r.category)}: ${r.description}`, { direction: 'top', sticky: true });
    reportLayers.push(circle);

    // Center pin
    const m = L.marker([r.lat, r.lng], {
      icon: L.divIcon({ className: '', html: '<div class="map-pin pin-flagged"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
    }).addTo(leafletMap);
    reportLayers.push(m);
  });
}

function categoryLabel(cat) {
  return ({ dimly_lit: 'Dimly lit', crowd: 'Crowd', harassment: 'Harassment', infrastructure: 'Infrastructure', other: 'Other' })[cat] || 'Reported';
}

/* ─── Report Modal ─── */
function openReportModal() {
  switchScreen('map');
  reportPlacementMode = true;
  pendingReportLatLng = null;
  if (pendingReportMarker) { leafletMap.removeLayer(pendingReportMarker); pendingReportMarker = null; }
  document.getElementById('report-location-text').textContent = 'Tap the map to choose…';
  document.getElementById('report-description').value = '';
  const err = document.getElementById('report-error'); err.hidden = true;
  const btn = document.getElementById('report-submit'); btn.disabled = false; btn.textContent = 'Submit report';
  document.getElementById('report-modal').classList.add('active');
}

function closeReportModal() {
  reportPlacementMode = false;
  document.getElementById('report-modal').classList.remove('active');
  if (pendingReportMarker) { leafletMap.removeLayer(pendingReportMarker); pendingReportMarker = null; }
}

async function submitReport() {
  const errEl = document.getElementById('report-error');
  errEl.hidden = true;
  if (!pendingReportLatLng) { errEl.textContent = 'Tap the map to place a pin first.'; errEl.hidden = false; return; }
  const description = document.getElementById('report-description').value.trim();
  if (description.length < 5) { errEl.textContent = 'Please add a short description.'; errEl.hidden = false; return; }

  const payload = {
    lat: pendingReportLatLng.lat, lng: pendingReportLatLng.lng,
    category: document.getElementById('report-category').value,
    timeOfDay: document.getElementById('report-time').value,
    description,
  };
  const btn = document.getElementById('report-submit');
  btn.disabled = true; btn.textContent = 'AI reviewing…';
  try {
    const res = await fetch('/api/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.reason || data.error || 'Could not accept.'; errEl.hidden = false; btn.disabled = false; btn.textContent = 'Submit report'; return; }
    closeReportModal();
    await loadReports();
  } catch (e) {
    errEl.textContent = 'Could not reach server.'; errEl.hidden = false;
    btn.disabled = false; btn.textContent = 'Submit report';
  }
}

/* ─── Destination search & routing ─── */
async function searchDestination() {
  const q = document.getElementById('destination-input').value.trim();
  if (!q) return;

  // Geocode using OSM Nominatim — biased to Lahore for the demo
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Lahore, Pakistan')}&format=json&limit=1`);
    const results = await res.json();
    if (!results.length) {
      alert('Could not find that place. Try another name.');
      return;
    }
    const lat = parseFloat(results[0].lat);
    const lng = parseFloat(results[0].lon);
    setDestination([lat, lng], results[0].display_name);
  } catch (e) {
    alert('Could not search. Check your connection.');
  }
}

async function setDestination(latlng, label) {
  destinationLatLng = latlng;
  if (destinationMarker) leafletMap.removeLayer(destinationMarker);
  destinationMarker = L.marker(latlng, {
    icon: L.divIcon({ className: '', html: '<div class="map-pin pin-destination">📍</div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
  }).addTo(leafletMap).bindTooltip(label || 'Destination', { direction: 'top' });

  // Fit map to show both points
  leafletMap.fitBounds([originLatLng, latlng], { padding: [40, 40] });

  // Fetch walking route from OSRM
  await fetchRoute();
}

async function fetchRoute() {
  if (!originLatLng || !destinationLatLng) return;
  const url = `https://router.project-osrm.org/route/v1/foot/${originLatLng[1]},${originLatLng[0]};${destinationLatLng[1]},${destinationLatLng[0]}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes || !data.routes.length) {
      document.getElementById('route-summary-text').textContent = 'No route found.';
      return;
    }
    const route = data.routes[0];
    const coords = route.geometry.coordinates.map(c => [c[1], c[0]]); // [lat,lng]

    routeData = {
      coords,
      distanceM: route.distance,
      expectedSeconds: route.duration,
    };

    // Check if route passes near any red zones (within 200m)
    const dangerCount = coords.filter(c =>
      allReports.some(r => metresBetween({ lat: c[0], lng: c[1] }, r) < 200)
    ).length;
    const dangerRatio = dangerCount / coords.length;

    // Draw the route
    if (routeLayer) leafletMap.removeLayer(routeLayer);
    routeLayer = L.polyline(coords, {
      color: dangerRatio > 0.15 ? '#E89B4B' : '#4A6B45',
      weight: 5, opacity: 0.85,
    }).addTo(leafletMap);

    // Update summary card
    const mins = Math.round(route.duration / 60);
    const km = (route.distance / 1000).toFixed(1);
    document.getElementById('route-summary-text').textContent = `${mins} min · ${km} km walking`;
    const warn = document.getElementById('route-warning');
    if (dangerRatio > 0.15) {
      warn.textContent = `⚠ This route passes through ${dangerCount > 5 ? 'several' : 'a'} reported area${dangerCount > 1 ? 's' : ''}. Stay alert.`;
      warn.hidden = false;
    } else {
      warn.textContent = '✓ Route avoids all reported zones.';
      warn.hidden = false;
      warn.className = 'route-warning route-warning-safe';
    }
    document.getElementById('route-summary').hidden = false;
  } catch (e) {
    console.error('Routing error', e);
  }
}

function metresBetween(a, b) {
  const toRad = d => d * Math.PI / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function clearRoute() {
  if (routeLayer) { leafletMap.removeLayer(routeLayer); routeLayer = null; }
  if (destinationMarker) { leafletMap.removeLayer(destinationMarker); destinationMarker = null; }
  routeData = null; destinationLatLng = null;
  document.getElementById('route-summary').hidden = true;
  document.getElementById('destination-input').value = '';
}

/* ─── Trip tracking ─── */
function startTrip() {
  if (!routeData) return;
  tripActive = true;
  tripStartTime = Date.now();
  document.getElementById('route-summary').hidden = true;
  document.getElementById('trip-card').hidden = false;

  // Try real GPS first; if unavailable, simulate
  if (navigator.geolocation) {
    tripGpsWatchId = navigator.geolocation.watchPosition(
      (pos) => updateLivePosition([pos.coords.latitude, pos.coords.longitude]),
      (err) => { console.warn('GPS unavailable, simulating:', err.message); startSimulation(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
    );
    // If GPS doesn't fire in 4 seconds, fall back to simulation
    setTimeout(() => { if (!simulatedDot && simulatedIndex === 0) startSimulation(); }, 4000);
  } else {
    startSimulation();
  }

  // Timer + checks every second
  tripTimer = setInterval(tickTrip, 1000);
  tickTrip();
}

function startSimulation() {
  if (simulationInterval) return;
  simulatedIndex = 0;
  if (!simulatedDot) {
    simulatedDot = L.marker(routeData.coords[0], {
      icon: L.divIcon({ className: '', html: '<div class="map-pin pin-live"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    }).addTo(leafletMap);
  }
  // Move along the route at expected pace (so it arrives on time)
  const totalSteps = routeData.coords.length;
  const stepInterval = (routeData.expectedSeconds * 1000) / totalSteps;
  simulationInterval = setInterval(() => {
    simulatedIndex++;
    if (simulatedIndex >= totalSteps) {
      clearInterval(simulationInterval);
      return;
    }
    simulatedDot.setLatLng(routeData.coords[simulatedIndex]);
  }, Math.max(500, stepInterval));
}

function updateLivePosition(latlng) {
  if (!simulatedDot) {
    simulatedDot = L.marker(latlng, {
      icon: L.divIcon({ className: '', html: '<div class="map-pin pin-live"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    }).addTo(leafletMap);
  } else {
    simulatedDot.setLatLng(latlng);
  }
  // If GPS started working, stop simulation
  if (simulationInterval) { clearInterval(simulationInterval); simulationInterval = null; }
}

function tickTrip() {
  if (!tripActive) return;
  const elapsedSec = (Date.now() - tripStartTime) / 1000;
  const expected = routeData.expectedSeconds;
  const remaining = Math.max(0, expected - elapsedSec);
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);
  document.getElementById('trip-eta').textContent = `${mins}:${String(secs).padStart(2, '0')}`;

  // Progress ring
  const ring = document.getElementById('ring-progress');
  if (ring) {
    const circumference = 2 * Math.PI * 26;
    const progress = Math.min(1, elapsedSec / expected);
    ring.style.strokeDasharray = `${circumference}`;
    ring.style.strokeDashoffset = `${circumference * (1 - progress)}`;
  }

  // Pace check: alarm if 25% slower than expected (elapsed > 1.25 × expected)
  if (elapsedSec > expected * 1.25 && document.getElementById('alarm-overlay').hidden) {
    triggerAlarm();
  } else if (elapsedSec > expected * 1.1) {
    document.getElementById('trip-status').textContent = '⚠ Behind schedule';
    document.getElementById('trip-status').className = 'trip-status trip-status-warn';
  } else {
    document.getElementById('trip-status').textContent = '✓ On track';
    document.getElementById('trip-status').className = 'trip-status';
  }
}

function arrivedTrip() {
  stopTrip();
  alert('Great — glad you got there safely! 💚');
}

function cancelTrip() {
  if (!confirm('Cancel this trip? The alarm will be turned off.')) return;
  stopTrip();
}

function stopTrip() {
  tripActive = false;
  if (tripTimer) { clearInterval(tripTimer); tripTimer = null; }
  if (simulationInterval) { clearInterval(simulationInterval); simulationInterval = null; }
  if (tripGpsWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(tripGpsWatchId);
    tripGpsWatchId = null;
  }
  if (simulatedDot) { leafletMap.removeLayer(simulatedDot); simulatedDot = null; }
  simulatedIndex = 0;
  document.getElementById('trip-card').hidden = true;
  dismissAlarm();
}

/* ─── Alarm + emergency contact ─── */
let alarmAudio = null;
function triggerAlarm() {
  const overlay = document.getElementById('alarm-overlay');
  if (!overlay.hidden) return; // already firing
  overlay.hidden = false;

  // Loud-ish beep via WebAudio
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; gain.gain.value = 0.25;
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 1500);
    }
  } catch (e) { }
}

function dismissAlarm() {
  document.getElementById('alarm-overlay').hidden = true;
}

function alertEmergencyContact() {
  dismissAlarm();
  // Demo only — pretend we sent an alert
  const name = (currentUser && currentUser.name) ? currentUser.name.split(' ')[0] : 'You';
  const contactEl = document.getElementById('alert-contact-name');
  contactEl.textContent = `${name}'s emergency contact`;
  const toast = document.getElementById('alert-toast');
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 4500);
}


/* ─────────────────────────────────────────────────
   4. CHATBOT — STATE
   ───────────────────────────────────────────────── */
let activeSubTab = 'career';

// Separate message histories per sub-tab
const chatHistory = {
  career: [
    { role: 'assistant', content: "Hi! I tailored your CV for TechNova and built your interview prep. Your energy may be lower this week based on your cycle — want lighter tasks scheduled?" },
    { role: 'user', content: "Yes please. And prep me for the interview." },
    { role: 'assistant', content: "📄 CV ready · Tailored for TechNova — 5 interview questions added." },
  ],
  health: [],
  wellbeing: [],
};

/* ─────────────────────────────────────────────────
   5. SUB-TAB SWITCHING
   ───────────────────────────────────────────────── */
function switchSubTab(name) {
  activeSubTab = name;

  ['career', 'health', 'wellbeing'].forEach(id => {
    const btn = document.getElementById('subtab-' + id);
    const panel = document.getElementById('panel-' + id);
    if (!btn || !panel) return;
    if (id === name) {
      btn.classList.add('sub-tab-active');
      btn.setAttribute('aria-selected', 'true');
      panel.classList.add('active-panel');
      scrollToBottom(id);
    } else {
      btn.classList.remove('sub-tab-active');
      btn.setAttribute('aria-selected', 'false');
      panel.classList.remove('active-panel');
    }
  });

  // Focus input
  const input = document.getElementById('chat-input');
  if (input) input.focus();
}

/* ─────────────────────────────────────────────────
   6. RENDER A CHAT BUBBLE
   ───────────────────────────────────────────────── */
function renderBubble(subTab, role, text) {
  const container = document.getElementById('messages-' + subTab);
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'bubble-row ' + (role === 'user' ? 'bubble-user' : 'bubble-ai');

  const bubble = document.createElement('div');
  bubble.className = 'bubble ' + (role === 'user' ? 'user-bubble' : 'ai-bubble');
  bubble.textContent = text;

  row.appendChild(bubble);
  container.appendChild(row);
  scrollToBottom(subTab);
}

/* ─────────────────────────────────────────────────
   7. TYPING INDICATOR
   ───────────────────────────────────────────────── */
function showTyping(subTab) {
  const container = document.getElementById('messages-' + subTab);
  if (!container) return null;

  const row = document.createElement('div');
  row.className = 'bubble-row bubble-ai';
  row.id = 'typing-indicator-' + subTab;

  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';

  row.appendChild(indicator);
  container.appendChild(row);
  scrollToBottom(subTab);
  return row;
}

function removeTyping(subTab) {
  const el = document.getElementById('typing-indicator-' + subTab);
  if (el) el.remove();
}

/* ─────────────────────────────────────────────────
   8. AUTO-SCROLL
   ───────────────────────────────────────────────── */
function scrollToBottom(subTab) {
  const panel = document.getElementById('panel-' + subTab);
  if (panel) panel.scrollTop = panel.scrollHeight;
}

/* ─────────────────────────────────────────────────
   9. SEND MESSAGE
   ───────────────────────────────────────────────── */
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input ? input.value.trim() : '';
  if (!text) return;

  input.value = '';
  input.disabled = true;

  const sub = activeSubTab;

  // Add to history & render
  chatHistory[sub].push({ role: 'user', content: text });
  renderBubble(sub, 'user', text);

  // Typing indicator
  showTyping(sub);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subTab: sub, messages: chatHistory[sub] }),
    });

    const data = await res.json();
    removeTyping(sub);

    if (data.reply) {
      chatHistory[sub].push({ role: 'assistant', content: data.reply });
      renderBubble(sub, 'assistant', data.reply);
    } else {
      renderBubble(sub, 'assistant', 'Sorry, I couldn\'t reach C.A.R.E. right now. Try again in a moment.');
    }
  } catch (err) {
    removeTyping(sub);
    renderBubble(sub, 'assistant', 'Sorry, I couldn\'t reach C.A.R.E. right now. Try again in a moment.');
  } finally {
    input.disabled = false;
    input.focus();
  }
}

/* ─────────────────────────────────────────────────
   10. QUICK CHIPS
   ───────────────────────────────────────────────── */
function sendChip(subTab, text) {
  const input = document.getElementById('chat-input');
  if (input) input.value = text;
  switchSubTab(subTab);
  sendMessage();
}

/* ─────────────────────────────────────────────────
   11. MOOD SELECTION (Wellbeing)
   ───────────────────────────────────────────────── */
function sendMood(mood) {
  switchSubTab('wellbeing');
  switchScreen('chatbot');

  const input = document.getElementById('chat-input');
  if (input) input.value = `I'm feeling ${mood} today.`;
  sendMessage();
}

/* ─────────────────────────────────────────────────
   12. KEYBOARD SUBMIT
   ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('chat-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
});
// Safety: make sure alarm is hidden on load (in case CSS race condition)
document.addEventListener('DOMContentLoaded', () => {
  const ao = document.getElementById('alarm-overlay');
  if (ao) ao.hidden = true;
  const tc = document.getElementById('trip-card');
  if (tc) tc.hidden = true;
  const rs = document.getElementById('route-summary');
  if (rs) rs.hidden = true;
  const at = document.getElementById('alert-toast');
  if (at) at.hidden = true;
});
/* ─── CV upload from Community ─── */
/* ─── CV upload from Community ─── */
async function onCvUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const banner = document.getElementById('cv-banner');
  const btn = document.getElementById('cv-banner-btn');
  const titleEl = document.getElementById('cv-banner-title');
  const subEl = document.getElementById('cv-banner-sub');

  // Show loading toast
  const loadingToast = showToast(`Uploading ${file.name}…`, 'loading');

  btn.disabled = true;
  btn.textContent = 'Uploading…';
  titleEl.textContent = 'Reading your CV…';
  subEl.textContent = 'AI is matching jobs to your skills.';

  const form = new FormData();
  form.append('cv', file);

  try {
    const res = await fetch('/api/cv/upload', { method: 'POST', body: form });
    const data = await res.json();
    dismissToast(loadingToast);

    if (!res.ok) {
      const errMsg = data.error || 'Try a different file.';
      showToast(errMsg, 'error');
      titleEl.textContent = 'CV upload failed';
      subEl.textContent = errMsg.slice(0, 60);
      btn.disabled = false;
      btn.textContent = 'Try again';
      return;
    }

    showToast(`CV uploaded — matching jobs now`, 'success');
    banner.classList.add('cv-banner-success');
    titleEl.textContent = '✓ CV uploaded — matching jobs to you';
    subEl.textContent = `${file.name} · Tap to replace`;
    btn.textContent = 'Replace';
    btn.disabled = false;

    companiesLoaded = false;
    const matchingToast = showToast('AI is finding new matches…', 'loading');
    await loadCompanies();
    dismissToast(matchingToast);
    showToast('Found ' + (allCompanies.length || 0) + ' matched jobs', 'success');

  } catch (err) {
    dismissToast(loadingToast);
    showToast('Could not reach the server', 'error');
    titleEl.textContent = 'Upload failed';
    subEl.textContent = 'Check your connection and try again.';
    btn.disabled = false;
    btn.textContent = 'Try again';
  }
}

function refreshCvBannerFromUser() {
  if (!currentUser || !currentUser.cvFilename) return;
  const banner = document.getElementById('cv-banner');
  const btn = document.getElementById('cv-banner-btn');
  const titleEl = document.getElementById('cv-banner-title');
  const subEl = document.getElementById('cv-banner-sub');
  if (!banner) return;
  banner.classList.add('cv-banner-success');
  titleEl.textContent = '✓ CV uploaded — matching jobs to you';
  subEl.textContent = 'Tap Replace to upload a new one.';
  btn.textContent = 'Replace';
}

// On load, show "✓ CV uploaded" state if the user already has one
function refreshCvBannerFromUser() {
  if (!currentUser || !currentUser.cvFilename) return;
  const banner = document.getElementById('cv-banner');
  const btn = document.getElementById('cv-banner-btn');
  const titleEl = document.getElementById('cv-banner-title');
  const subEl = document.getElementById('cv-banner-sub');
  if (!banner) return;
  banner.classList.add('cv-banner-success');
  titleEl.textContent = '✓ CV uploaded — matching jobs to you';
  subEl.textContent = 'Tap Replace to upload a new one.';
 btn.textContent = 'Replace';
}}
/* ─── Toast notifications ─── */
function showToast(message, type) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + (type || 'info');
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'loading' ? '⟳' : 'ℹ';
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  // Auto-dismiss after 4 seconds unless it's a loading toast
  if (type !== 'loading') {
    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
  return toast;
}

function dismissToast(toast) {
  if (!toast) return;
  toast.classList.add('toast-out');
  setTimeout(() => toast.remove(), 300);
}
// Defensive: define onCvUpload at global scope if it isn't already
if (typeof window.onCvUpload !== 'function') {
  window.onCvUpload = async function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const banner = document.getElementById('cv-banner');
    const btn = document.getElementById('cv-banner-btn');
    const titleEl = document.getElementById('cv-banner-title');
    const subEl = document.getElementById('cv-banner-sub');

    const loadingToast = showToast(`Uploading ${file.name}…`, 'loading');
    btn.disabled = true;
    btn.textContent = 'Uploading…';
    titleEl.textContent = 'Reading your CV…';
    subEl.textContent = 'AI is matching jobs to your skills.';

    const form = new FormData();
    form.append('cv', file);

    try {
      const res = await fetch('/api/cv/upload', { method: 'POST', body: form });
      const data = await res.json();
      dismissToast(loadingToast);

      if (!res.ok) {
        const errMsg = data.error || 'Try a different file.';
        showToast(errMsg, 'error');
        titleEl.textContent = 'CV upload failed';
        subEl.textContent = errMsg.slice(0, 60);
        btn.disabled = false;
        btn.textContent = 'Try again';
        return;
      }

      showToast('CV uploaded — matching jobs now', 'success');
      banner.classList.add('cv-banner-success');
      titleEl.textContent = '✓ CV uploaded — matching jobs to you';
      subEl.textContent = `${file.name} · Tap to replace`;
      btn.textContent = 'Replace';
      btn.disabled = false;

      companiesLoaded = false;
      const matchingToast = showToast('AI is finding new matches…', 'loading');
      await loadCompanies();
      dismissToast(matchingToast);
      showToast('Found ' + (allCompanies.length || 0) + ' matched jobs', 'success');
    } catch (err) {
      dismissToast(loadingToast);
      showToast('Could not reach the server', 'error');
      titleEl.textContent = 'Upload failed';
      subEl.textContent = 'Check your connection and try again.';
      btn.disabled = false;
      btn.textContent = 'Try again';
    }
  };
}
// Make sure onCvUpload is globally accessible from HTML
if (typeof onCvUpload === 'function') {
  window.onCvUpload = onCvUpload;
}
// Defensive global registration — ensures onCvUpload is callable from HTML
window.onCvUpload = onCvUpload;