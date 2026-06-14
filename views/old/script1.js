/* ============================================================
   easymind — script.js
   TypeForm-style reminder flow + NLP + Ollama AI + Django REST
   ============================================================ */

/* ─── CONFIG ─────────────────────────────────────────────── */
const API_BASE    = '/api/reminders/';
const AI_PARSE    = '/api/ai/parse/';
const AI_POLISH   = '/api/ai/polish/';
const AUTH_CSRF   = '/api/auth/csrf/';
const AUTH_WHOAMI = '/api/auth/whoami/';
const AUTH_GUEST  = '/api/auth/guest/';
const AUTH_LOGIN  = '/api/auth/login/';
const AUTH_REG    = '/api/auth/register/';
const AUTH_LOGOUT = '/api/auth/logout/';

/* ─── SPEED SETTINGS ─────────────────────────────────────── */
const SPEEDS = {
  slow:   { transition: 600, delay: 300 },
  normal: { transition: 400, delay: 200 },
  fast:   { transition: 200, delay: 80  },
};
let currentSpeed = 'normal';

/* ─── STATE ──────────────────────────────────────────────── */
let csrfToken = '';
let currentUser = null;  // { username, is_guest }

let state = {
  step: 0,
  reminderText: '',
  parsedTitle: '',
  date: '',
  time: '',
  location: '',
  forLocation: false,
};

/* ─── DOM CACHE ──────────────────────────────────────────── */
const wrappers    = () => document.querySelectorAll('.reminder-form-wrapper');
const q1Input     = () => document.querySelector('.question-1 input');
const q2DateInput = () => document.querySelector('.question-2 .reminder-form-multiple-inputs input:first-child');
const q2TimeInput = () => document.querySelector('.question-2 .reminder-form-multiple-inputs input:last-child');
const q3ForInput  = () => document.querySelector('.question-3 .reminder-form-multiple-inputs input:first-child');
const q3AtInput   = () => document.querySelector('.question-3 .reminder-form-multiple-inputs input:last-child');
const finalMessage = () => document.querySelector('.reminder-form-final-message h1');

/* ─── UTILS ──────────────────────────────────────────────── */
function speed() { return SPEEDS[currentSpeed]; }

function formatDate(d) { return d.toISOString().split('T')[0]; }

function friendlyDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
}

function shakeInput(el) {
  if (!el) return;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 400);
}

function showLoadingOnButton(btn) {
  if (!btn) return;
  btn.dataset.origText = btn.querySelector('h2')?.textContent || btn.textContent || '';
  if (btn.querySelector('h2')) btn.querySelector('h2').textContent = '…';
  else btn.textContent = '…';
  btn.disabled = true;
}

function hideLoadingOnButton(btn) {
  if (!btn) return;
  if (btn.querySelector('h2')) btn.querySelector('h2').textContent = btn.dataset.origText || 'enter';
  else btn.textContent = btn.dataset.origText || 'enter';
  btn.disabled = false;
}

/* ─── STEP TRANSITIONS ───────────────────────────────────── */
function showStep(index) {
  const all = wrappers();
  all.forEach((el, i) => {
    el.classList.remove('active', 'hidden', 'exiting');
    if (i === index) {
      el.style.display = 'block';
      el.classList.add('active');
      el.style.opacity = '0';
      el.style.transform = 'translateY(30px)';
      requestAnimationFrame(() => {
        el.style.transition = `opacity ${speed().transition}ms ease, transform ${speed().transition}ms ease`;
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      });
      setTimeout(() => {
        const inp = el.querySelector('input');
        if (inp) inp.focus();
      }, speed().delay + 50);
    } else {
      el.style.display = 'none';
      el.classList.add('hidden');
    }
  });
  state.step = index;
}

function exitAndShow(nextIndex) {
  const all = wrappers();
  const current = all[state.step];
  if (current) {
    current.style.transition = `opacity ${speed().transition * 0.6}ms ease, transform ${speed().transition * 0.6}ms ease`;
    current.style.opacity = '0';
    current.style.transform = 'translateY(-20px)';
    setTimeout(() => showStep(nextIndex), speed().transition * 0.6 + speed().delay);
  } else {
    showStep(nextIndex);
  }
}

/* ─── CLIENT-SIDE NLP FALLBACK ───────────────────────────── */
// Used when AI endpoint is unavailable or as a fast pre-pass
function parseNaturalLanguage(text) {
  const result = { date: null, time: null, location: null, cleanTitle: text };
  const today = new Date();

  // Time
  const timePats = [
    /\b(?:at|by|@)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i,
    /\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/i,
    /\b(\d{1,2}\s*(?:am|pm))\b/i,
  ];
  for (const pat of timePats) {
    const m = text.match(pat);
    if (m) {
      result.time = m[1].trim().replace(/\s+/g, '').toUpperCase();
      result.cleanTitle = result.cleanTitle.replace(m[0], '').trim();
      break;
    }
  }

  // Relative dates
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const relMap = { 'today': today, 'tonight': today, 'tomorrow': tomorrow };
  for (const [word, date] of Object.entries(relMap)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(result.cleanTitle)) {
      result.date = formatDate(date);
      result.cleanTitle = result.cleanTitle.replace(new RegExp(`\\b${word}\\b`, 'i'), '').trim();
      break;
    }
  }

  // Weekdays
  if (!result.date) {
    const wdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const wm = result.cleanTitle.match(/\b(?:next\s+|this\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (wm) {
      const target = wdays.indexOf(wm[1].toLowerCase());
      const d = new Date(today);
      let diff = target - d.getDay();
      if (diff <= 0 || /\bnext\b/i.test(wm[0])) diff += 7;
      d.setDate(d.getDate() + diff);
      result.date = formatDate(d);
      result.cleanTitle = result.cleanTitle.replace(wm[0], '').trim();
    }
  }

  // Explicit date
  if (!result.date) {
    const months = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec';
    const em = result.cleanTitle.match(new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${months})\\b|\\b(${months})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b|\\b(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?\\b`, 'i'
    ));
    if (em) {
      const parsed = new Date(em[0]);
      if (!isNaN(parsed)) {
        if (parsed < today) parsed.setFullYear(today.getFullYear() + 1);
        result.date = formatDate(parsed);
        result.cleanTitle = result.cleanTitle.replace(em[0], '').trim();
      }
    }
  }

  // "in X days/weeks"
  if (!result.date) {
    const im = result.cleanTitle.match(/\bin\s+(\d+)\s+(day|days|week|weeks)\b/i);
    if (im) {
      const n = parseInt(im[1]);
      const d = new Date(today);
      if (/week/i.test(im[2])) d.setDate(d.getDate() + n * 7);
      else d.setDate(d.getDate() + n);
      result.date = formatDate(d);
      result.cleanTitle = result.cleanTitle.replace(im[0], '').trim();
    }
  }

  result.cleanTitle = result.cleanTitle
    .replace(/\s{2,}/g, ' ')
    .replace(/^(by|at|on|for|before|,)\s*/i, '')
    .replace(/[,\s]+$/, '')
    .trim();

  return result;
}

/* ─── HTTP HELPERS ───────────────────────────────────────── */
async function apiFetch(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (csrfToken && options.method && options.method !== 'GET') {
    headers['X-CSRFToken'] = csrfToken;
  }
  const res = await fetch(url, { ...options, headers, credentials: 'include' });
  return res;
}

/* ─── AUTH FLOW ──────────────────────────────────────────── */
async function initAuth() {
  // 1. Get CSRF token — this also sets the cookie
  try {
    const r = await fetch(AUTH_CSRF, { credentials: 'include' });
    const data = await r.json();
    csrfToken = data.csrfToken;
  } catch (e) {
    console.error('CSRF fetch failed', e);
  }

  // 2. Check if already logged in
  try {
    const r = await apiFetch(AUTH_WHOAMI);
    const data = await r.json();
    if (data.authenticated) {
      currentUser = data;
      updateUserBadge();
      return;
    }
  } catch (e) { /* not logged in */ }

  // 3. Auto-login as guest
  await loginAsGuest();
}

async function loginAsGuest() {
  try {
    const r = await apiFetch(AUTH_GUEST, { method: 'POST', body: JSON.stringify({}) });
    const data = await r.json();
    currentUser = data;
    updateUserBadge();
  } catch (e) {
    console.error('Guest login failed', e);
  }
}

function updateUserBadge() {
  const badge = document.getElementById('user-badge');
  if (!badge || !currentUser) return;
  if (currentUser.is_guest) {
    badge.innerHTML = `<span class="badge-guest">guest</span> <button id="badge-save-account">save account</button>`;
    badge.querySelector('#badge-save-account')?.addEventListener('click', () => showAuthModal('register'));
  } else {
    badge.innerHTML = `<span class="badge-user">${currentUser.username}</span> <button id="badge-logout" class="badge-btn-sm">log out</button>`;
    badge.querySelector('#badge-logout')?.addEventListener('click', handleLogout);
  }
}

async function handleLogout() {
  await apiFetch(AUTH_LOGOUT, { method: 'POST', body: JSON.stringify({}) });
  currentUser = null;
  await loginAsGuest();
}

/* ─── AUTH MODAL ─────────────────────────────────────────── */
function createAuthModal() {
  const modal = document.createElement('div');
  modal.id = 'auth-modal';
  modal.innerHTML = `
    <div id="auth-inner">
      <button id="auth-close">✕</button>
      <div id="auth-tabs">
        <button class="auth-tab active" data-tab="register">create account</button>
        <button class="auth-tab" data-tab="login">log in</button>
      </div>

      <div id="auth-register" class="auth-pane active">
        <p class="auth-sub">Save your reminders permanently — takes 5 seconds.</p>
        <div class="auth-field"><input type="text"     id="reg-username" placeholder="username" autocomplete="username"></div>
        <div class="auth-field"><input type="password" id="reg-password" placeholder="password (min 6 chars)" autocomplete="new-password"></div>
        <div id="reg-error" class="auth-error"></div>
        <button id="reg-submit">create account</button>
        <p class="auth-note">Your guest reminders will be kept.</p>
      </div>

      <div id="auth-login" class="auth-pane">
        <div class="auth-field"><input type="text"     id="login-username" placeholder="username" autocomplete="username"></div>
        <div class="auth-field"><input type="password" id="login-password" placeholder="password" autocomplete="current-password"></div>
        <div id="login-error" class="auth-error"></div>
        <button id="login-submit">log in</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#auth-close').onclick = hideAuthModal;
  modal.addEventListener('click', e => { if (e.target === modal) hideAuthModal(); });

  // Tabs
  modal.querySelectorAll('.auth-tab').forEach(tab => {
    tab.onclick = () => {
      modal.querySelectorAll('.auth-tab, .auth-pane').forEach(el => el.classList.remove('active'));
      tab.classList.add('active');
      modal.querySelector(`#auth-${tab.dataset.tab}`).classList.add('active');
    };
  });

  // Register
  modal.querySelector('#reg-submit').onclick = async () => {
    const btn = modal.querySelector('#reg-submit');
    const errEl = modal.querySelector('#reg-error');
    const username = modal.querySelector('#reg-username').value.trim();
    const password = modal.querySelector('#reg-password').value.trim();
    errEl.textContent = '';
    showLoadingOnButton(btn);
    try {
      const r = await apiFetch(AUTH_REG, { method: 'POST', body: JSON.stringify({ username, password }) });
      const data = await r.json();
      if (data.error) { errEl.textContent = data.error; hideLoadingOnButton(btn); return; }
      currentUser = data;
      updateUserBadge();
      hideAuthModal();
    } catch (e) {
      errEl.textContent = 'Something went wrong.';
      hideLoadingOnButton(btn);
    }
  };

  // Login
  modal.querySelector('#login-submit').onclick = async () => {
    const btn = modal.querySelector('#login-submit');
    const errEl = modal.querySelector('#login-error');
    const username = modal.querySelector('#login-username').value.trim();
    const password = modal.querySelector('#login-password').value.trim();
    errEl.textContent = '';
    showLoadingOnButton(btn);
    try {
      const r = await apiFetch(AUTH_LOGIN, { method: 'POST', body: JSON.stringify({ username, password }) });
      const data = await r.json();
      if (data.error) { errEl.textContent = data.error; hideLoadingOnButton(btn); return; }
      currentUser = data;
      updateUserBadge();
      hideAuthModal();
    } catch (e) {
      errEl.textContent = 'Something went wrong.';
      hideLoadingOnButton(btn);
    }
  };

  // Enter key in inputs
  modal.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const pane = inp.closest('.auth-pane');
      pane?.querySelector('button[id$="-submit"]')?.click();
    });
  });
}

function showAuthModal(tab = 'register') {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.querySelectorAll('.auth-tab, .auth-pane').forEach(el => el.classList.remove('active'));
  modal.querySelector(`.auth-tab[data-tab="${tab}"]`)?.classList.add('active');
  modal.querySelector(`#auth-${tab}`)?.classList.add('active');
  modal.classList.add('active');
  setTimeout(() => modal.querySelector(`#${tab === 'register' ? 'reg' : 'login'}-username`)?.focus(), 100);
}

function hideAuthModal() {
  document.getElementById('auth-modal')?.classList.remove('active');
}

/* ─── USER BADGE IN HEADER ───────────────────────────────── */
function createUserBadge() {
  const badge = document.createElement('div');
  badge.id = 'user-badge';
  document.querySelector('header')?.appendChild(badge);
}

/* ─── AI CALLS (local Ollama via Django) ─────────────────── */
async function aiParse(text) {
  try {
    const r = await apiFetch(AI_PARSE, { method: 'POST', body: JSON.stringify({ text }) });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();  // { title, date, time, location }
  } catch (e) {
    console.warn('AI parse failed, using client NLP:', e);
    return null;
  }
}

async function aiPolish(text) {
  try {
    const r = await apiFetch(AI_POLISH, { method: 'POST', body: JSON.stringify({ text }) });
    if (!r.ok) throw new Error(`${r.status}`);
    const data = await r.json();
    return data.title || text;
  } catch {
    return text;  // graceful fallback
  }
}

/* ─── DJANGO REST API ─────────────────────────────────────── */
async function saveReminder(payload) {
  try {
    const r = await apiFetch(API_BASE, { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      console.error('Save reminder error:', err);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.error('Save reminder failed:', e);
    return null;
  }
}

async function fetchReminders() {
  try {
    const r = await apiFetch(API_BASE);
    if (!r.ok) return [];
    return await r.json();
  } catch {
    return [];
  }
}

/* ─── FORM FLOW ──────────────────────────────────────────── */
async function handleQ1() {
  const val = q1Input()?.value?.trim();
  if (!val) { shakeInput(q1Input()); return; }

  state.reminderText = val;
  const btn = document.querySelector('.question-1 .enter-button');
  showLoadingOnButton(btn);

  // Try AI parse first (handles date+time+title in one shot)
  const aiResult = await aiParse(val);

  if (aiResult) {
    state.parsedTitle = aiResult.title || val;
    if (aiResult.date && aiResult.time) {
      // AI got everything — skip the rest of the form
      state.date = aiResult.date;
      state.time = aiResult.time;
      state.location = aiResult.location || '';
      hideLoadingOnButton(btn);
      await submitAndFinish();
      return;
    }
    if (aiResult.date) { state.date = aiResult.date; prefillQ2Date(aiResult.date); }
    if (aiResult.time) { state.time = aiResult.time; }
  } else {
    // Fallback: client-side NLP
    const nlp = parseNaturalLanguage(val);
    state.parsedTitle = nlp.cleanTitle || val;
    if (nlp.date && nlp.time) {
      state.date = nlp.date;
      state.time = nlp.time;
      state.location = nlp.location || '';
      hideLoadingOnButton(btn);
      await submitAndFinish();
      return;
    }
    if (nlp.date) { state.date = nlp.date; prefillQ2Date(nlp.date); }
    if (nlp.time) { state.time = nlp.time; }
  }

  hideLoadingOnButton(btn);
  exitAndShow(1);
}

function prefillQ2Date(date) {
  const el = q2DateInput();
  if (el && date) el.value = friendlyDate(date);
}

async function handleQ2() {
  const dateVal = q2DateInput()?.value?.trim();
  const timeVal = q2TimeInput()?.value?.trim();
  if (!dateVal) { shakeInput(q2DateInput()); return; }

  // Parse whatever the user typed using client NLP (good enough for date/time fields)
  const pd = parseNaturalLanguage(dateVal);
  state.date = pd.date || dateVal;

  const pt = parseNaturalLanguage(timeVal || '');
  state.time = pt.time || timeVal || '';

  exitAndShow(2);
}

async function handleQ3() {
  const forVal = q3ForInput()?.value?.trim();
  const atVal  = q3AtInput()?.value?.trim();
  state.location = atVal || forVal || '';
  state.forLocation = !!forVal && !atVal;
  await submitAndFinish();
}

async function submitAndFinish() {
  const payload = {
    title:    state.parsedTitle || state.reminderText,
    date:     state.date,
    time:     state.time || null,
    location: state.location || '',
  };

  exitAndShow(3);  // "Done!" flash
  const saved = await saveReminder(payload);
  const msg = buildConfirmationMessage(payload, saved);

  setTimeout(() => {
    if (finalMessage()) finalMessage().textContent = msg;
    exitAndShow(4);
  }, speed().transition * 1.5 + 300);
}

function buildConfirmationMessage(payload, saved) {
  const title   = payload.title;
  const date    = payload.date ? friendlyDate(payload.date) : 'the scheduled time';
  const timeStr = payload.time ? ` at ${payload.time}` : '';
  const locStr  = payload.location ? ` at ${payload.location}` : '';
  const saveOk  = saved ? '' : ' (note: reminder could not be saved — please check your connection)';
  return `We'll remind you a day before and 15 minutes before for "${title}", on ${date}${timeStr}${locStr}.${saveOk}`;
}

function resetForm() {
  state = { step: 0, reminderText: '', parsedTitle: '', date: '', time: '', location: '', forLocation: false };
  document.querySelectorAll('.reminder-form-wrapper input').forEach(i => i.value = '');
  showStep(0);
}

/* ─── QUICK REMIND BAR ───────────────────────────────────── */
function createQuickRemindOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'quick-remind-overlay';
  overlay.innerHTML = `
    <div id="quick-remind-bar">
      <span class="qr-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1z"/>
        </svg>
      </span>
      <input type="text" id="quick-remind-input" placeholder='eg. "Apply for OSAP tomorrow by 5PM"' autocomplete="off">
      <button id="quick-remind-submit">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18 12c0 1.65-1.35 3-3 3H9v-3l-5 4 5 4v-3h6c2.76 0 5-2.24 5-5V4h-2z"/>
        </svg>
      </button>
      <button id="quick-remind-close" class="light">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>
    <div id="quick-remind-status"></div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('quick-remind-close').onclick = hideQuickRemind;
  document.getElementById('quick-remind-submit').onclick = handleQuickRemind;
  document.getElementById('quick-remind-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleQuickRemind();
    if (e.key === 'Escape') hideQuickRemind();
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) hideQuickRemind(); });
}

function showQuickRemind() {
  document.getElementById('quick-remind-overlay').classList.add('active');
  setTimeout(() => document.getElementById('quick-remind-input')?.focus(), 100);
}

function hideQuickRemind() {
  document.getElementById('quick-remind-overlay').classList.remove('active');
  const inp = document.getElementById('quick-remind-input');
  const status = document.getElementById('quick-remind-status');
  if (inp) inp.value = '';
  if (status) { status.textContent = ''; status.className = ''; }
}

async function handleQuickRemind() {
  const input  = document.getElementById('quick-remind-input');
  const status = document.getElementById('quick-remind-status');
  const val = input?.value?.trim();
  if (!val) { shakeInput(input); return; }

  status.textContent = '✦ reading that…';
  status.className = '';
  input.disabled = true;

  const aiResult = await aiParse(val);
  let payload;

  if (aiResult && aiResult.title) {
    payload = { title: aiResult.title, date: aiResult.date || null, time: aiResult.time || null, location: aiResult.location || '' };
  } else {
    const nlp = parseNaturalLanguage(val);
    payload = { title: nlp.cleanTitle || val, date: nlp.date || null, time: nlp.time || null, location: nlp.location || '' };
  }

  const saved = await saveReminder(payload);
  input.disabled = false;

  if (saved) {
    const dateStr = payload.date ? friendlyDate(payload.date) : 'soon';
    status.textContent = `✓  "${payload.title}" — ${dateStr}`;
    status.className = 'success';
    input.value = '';
    setTimeout(hideQuickRemind, 2400);
  } else {
    status.textContent = '✗ Could not save. Check connection.';
    status.className = 'error';
  }
}

/* ─── SPEED CONTROLS ─────────────────────────────────────── */
function createSpeedControl() {
  const ctrl = document.createElement('div');
  ctrl.id = 'speed-control';
  ctrl.innerHTML = `
    <span class="speed-label">speed</span>
    <button data-speed="slow"   class="${currentSpeed === 'slow'   ? 'active' : ''}">slow</button>
    <button data-speed="normal" class="${currentSpeed === 'normal' ? 'active' : ''}">normal</button>
    <button data-speed="fast"   class="${currentSpeed === 'fast'   ? 'active' : ''}">fast</button>
  `;
  document.body.appendChild(ctrl);
  ctrl.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      currentSpeed = btn.dataset.speed;
      ctrl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      localStorage.setItem('easymind_speed', currentSpeed);
    };
  });
}

/* ─── CALENDAR VIEW ──────────────────────────────────────── */
async function showCalendarView() {
  const reminders = await fetchReminders();
  const calEl = document.getElementById('calendar-modal') || createCalendarModal();
  renderCalendar(calEl, reminders);
  calEl.classList.add('active');
}

function createCalendarModal() {
  const modal = document.createElement('div');
  modal.id = 'calendar-modal';
  modal.innerHTML = `
    <div id="calendar-inner">
      <div id="calendar-header">
        <button id="cal-prev">‹</button>
        <h2 id="cal-month-label"></h2>
        <button id="cal-next">›</button>
        <button id="cal-close" class="light">✕</button>
      </div>
      <div id="calendar-grid"></div>
      <div id="calendar-day-detail"></div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#cal-close').onclick = () => modal.classList.remove('active');
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
  return modal;
}

let calViewDate = new Date();

function renderCalendar(modal, reminders) {
  const monthLabel = modal.querySelector('#cal-month-label');
  const grid       = modal.querySelector('#calendar-grid');
  const detail     = modal.querySelector('#calendar-day-detail');

  const remindersByDate = {};
  reminders.forEach(r => {
    if (!remindersByDate[r.date]) remindersByDate[r.date] = [];
    remindersByDate[r.date].push(r);
  });

  const year = calViewDate.getFullYear();
  const month = calViewDate.getMonth();
  monthLabel.textContent = new Date(year, month, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });

  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso = new Date().toISOString().split('T')[0];

  let html = '<div class="cal-day-headers">' + days.map(d => `<span>${d}</span>`).join('') + '</div>';
  html += '<div class="cal-days">';
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const iso  = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const rems = remindersByDate[iso] || [];
    const count = rems.length;
    const isToday = iso === todayIso;
    html += `<div class="cal-cell${isToday ? ' today' : ''}${count ? ' has-reminders' : ''}" data-date="${iso}">
               <span class="cal-num">${d}</span>
               ${count ? `<span class="cal-dot">${count > 3 ? '3+' : '•'.repeat(count)}</span>` : ''}
             </div>`;
  }
  html += '</div>';
  grid.innerHTML = html;

  grid.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
    cell.onclick = () => {
      const date = cell.dataset.date;
      const rems = remindersByDate[date] || [];
      detail.innerHTML = `
        <h3>${friendlyDate(date)}</h3>
        ${rems.length === 0
          ? '<p class="cal-empty">No reminders.</p>'
          : rems.map(r => `<div class="cal-rem-item"><strong>${r.title}</strong>${r.time ? ' · '+r.time : ''}</div>`).join('')}
      `;
    };
  });

  modal.querySelector('#cal-prev').onclick = () => {
    calViewDate = new Date(year, month - 1, 1);
    fetchReminders().then(r => renderCalendar(modal, r));
  };
  modal.querySelector('#cal-next').onclick = () => {
    calViewDate = new Date(year, month + 1, 1);
    fetchReminders().then(r => renderCalendar(modal, r));
  };
}

/* ─── KEYBOARD SHORTCUTS ─────────────────────────────────── */
function initKeyboard() {
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); showQuickRemind(); return; }
    if (e.altKey && e.key === 'c') { e.preventDefault(); showCalendarView(); return; }
    if (e.key === 'Escape') {
      if (document.getElementById('auth-modal')?.classList.contains('active')) { hideAuthModal(); return; }
      if (document.getElementById('calendar-modal')?.classList.contains('active')) {
        document.getElementById('calendar-modal').classList.remove('active'); return;
      }
      if (document.getElementById('quick-remind-overlay')?.classList.contains('active')) { hideQuickRemind(); return; }
      handleClose();
      return;
    }
    if (e.key === 'Enter') {
      if (document.getElementById('quick-remind-overlay')?.classList.contains('active')) return;
      if (document.getElementById('auth-modal')?.classList.contains('active')) return;
      advanceCurrentStep();
    }
  });
}

function advanceCurrentStep() {
  switch (state.step) {
    case 0: handleQ1(); break;
    case 1: handleQ2(); break;
    case 2: handleQ3(); break;
  }
}

function handleClose() {
  const all = wrappers();
  const current = all[state.step];
  if (current) {
    current.style.transition = `opacity 300ms ease, transform 300ms ease`;
    current.style.opacity = '0';
    current.style.transform = 'translateY(20px)';
    setTimeout(resetForm, 350);
  }
}

/* ─── WIRE UP BUTTONS ────────────────────────────────────── */
function initButtons() {
  document.querySelector('.question-1 .enter-button')?.addEventListener('click', handleQ1);
  document.querySelector('.question-2 .enter-button')?.addEventListener('click', handleQ2);
  document.querySelector('.question-3 .enter-button')?.addEventListener('click', handleQ3);
  document.querySelector('.calendar-view')?.addEventListener('click', showCalendarView);
  document.querySelector('.quick-remind')?.addEventListener('click', showQuickRemind);
  document.querySelector('.close-view')?.addEventListener('click', handleClose);

  document.addEventListener('click', e => {
    if (e.target.closest('.reminder-form-options button:first-child')) resetForm();
    if (e.target.closest('.reminder-form-options button:last-child'))  showCalendarView();
  });
}

/* ─── LOADING SPLASH ─────────────────────────────────────── */
function playLoadAnimation() {
  const splash = document.createElement('div');
  splash.id = 'load-splash';
  splash.innerHTML = `<span class="load-logo">easymind</span>`;
  document.body.appendChild(splash);
  setTimeout(() => { splash.style.opacity = '0'; splash.style.transform = 'scale(1.04)'; }, 700);
  setTimeout(() => splash.remove(), 1200);
}

/* ─── INJECTED STYLES ────────────────────────────────────── */
function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
  @keyframes shake {
    0%,100%{ transform:translateX(0) }
    20%{ transform:translateX(-6px) }
    40%{ transform:translateX(6px) }
    60%{ transform:translateX(-4px) }
    80%{ transform:translateX(4px) }
  }
  .shake { animation:shake 0.35s ease; }

  /* Splash */
  #load-splash {
    position:fixed;inset:0;z-index:9999;background:var(--black);
    display:grid;place-content:center;
    transition:opacity 0.4s ease, transform 0.4s ease;
  }
  .load-logo {
    font-family:'Inter',sans-serif;font-size:clamp(2rem,8vw,5rem);
    font-weight:800;color:var(--white);letter-spacing:-0.04em;
    animation:logoIn 0.5s ease;
  }
  @keyframes logoIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }

  /* User badge */
  #user-badge {
    display:flex;align-items:center;gap:0.5rem;font-size:0.8rem;
  }
  .badge-guest { color:var(--medium-grey); }
  .badge-user  { font-weight:600; }
  #user-badge button {
    font-size:0.75rem;padding:0.2rem 0.6rem;border-radius:20px;
    background:transparent;color:var(--black);border:1.5px solid var(--light-grey);
  }
  #user-badge button:hover { border-color:var(--black); }

  /* Auth modal */
  #auth-modal {
    position:fixed;inset:0;z-index:2000;
    background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);
    display:none;align-items:center;justify-content:center;
  }
  #auth-modal.active { display:flex;animation:fadeIn 0.2s ease; }
  #auth-inner {
    background:var(--white);border:2px solid var(--black);border-radius:16px;
    padding:2rem;width:min(400px,92vw);position:relative;
    animation:scaleIn 0.22s ease;
  }
  #auth-close {
    position:absolute;top:1rem;right:1rem;
    background:transparent;border:none;color:var(--medium-grey);
    font-size:1rem;padding:0.25rem 0.5rem;cursor:pointer;
  }
  #auth-tabs {
    display:flex;gap:0.5rem;margin-bottom:1.5rem;
  }
  .auth-tab {
    flex:1;padding:0.5rem;border:1.5px solid var(--light-grey);border-radius:8px;
    background:transparent;color:var(--medium-grey);font-size:0.875rem;cursor:pointer;
    transition:all 0.15s;
  }
  .auth-tab.active { background:var(--black);color:var(--white);border-color:var(--black); }
  .auth-pane { display:none;flex-direction:column;gap:0.75rem; }
  .auth-pane.active { display:flex; }
  .auth-sub { font-size:0.875rem;color:var(--medium-grey);margin-bottom:0.25rem; }
  .auth-field input {
    width:100%;border:none;border-bottom:1.5px solid var(--medium-grey);
    padding:0.6rem 0.25rem;font-size:1rem;font-family:'Inter',sans-serif;
    outline:none;background:transparent;
  }
  .auth-field input:focus { border-bottom-color:var(--black); }
  .auth-pane button[id$="-submit"] {
    margin-top:0.5rem;width:100%;padding:0.75rem;
    background:var(--black);color:var(--white);border:none;border-radius:8px;
    font-size:1rem;font-family:'Inter',sans-serif;cursor:pointer;
    transition:opacity 0.15s;
  }
  .auth-pane button[id$="-submit"]:hover { opacity:0.85; }
  .auth-error { color:#c0392b;font-size:0.8rem;min-height:1em; }
  .auth-note  { font-size:0.75rem;color:var(--medium-grey);text-align:center; }

  /* Quick Remind */
  #quick-remind-overlay {
    position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.45);
    display:none;align-items:flex-end;justify-content:center;
    padding-bottom:2.5rem;backdrop-filter:blur(4px);
  }
  #quick-remind-overlay.active { display:flex;animation:fadeIn 0.2s ease; }
  #quick-remind-bar {
    background:var(--white);border:2px solid var(--black);border-radius:780px;
    padding:0.75rem 1.25rem;display:flex;align-items:center;gap:0.75rem;
    width:min(680px,90vw);box-shadow:0 8px 32px rgba(0,0,0,0.18);
    animation:slideUp 0.25s ease;
  }
  @keyframes slideUp { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
  .qr-icon { color:var(--medium-grey);display:flex; }
  #quick-remind-input {
    flex:1;border:none;outline:none;font-size:1rem;
    font-family:'Inter',sans-serif;background:transparent;color:var(--black);
  }
  #quick-remind-input::placeholder { color:var(--light-grey); }
  #quick-remind-submit, #quick-remind-close {
    padding:0.4rem 0.75rem;min-width:auto;border-radius:20px;
  }
  #quick-remind-close { background:transparent;border:1.5px solid var(--light-grey);color:var(--black); }
  #quick-remind-status {
    text-align:center;font-size:0.875rem;margin-top:0.5rem;
    color:var(--medium-grey);min-height:1.2em;transition:color 0.2s;
  }
  #quick-remind-status.success { color:#2a9d2a; }
  #quick-remind-status.error   { color:#c0392b; }

  /* Speed control */
  #speed-control {
    position:fixed;bottom:1.5rem;right:1.5rem;display:flex;align-items:center;gap:0.4rem;
    background:var(--white);border:1.5px solid var(--light-grey);border-radius:780px;
    padding:0.3rem 0.75rem;font-size:0.75rem;z-index:500;
    box-shadow:0 2px 8px rgba(0,0,0,0.07);
  }
  .speed-label { color:var(--medium-grey);margin-right:0.2rem; }
  #speed-control button {
    background:transparent;color:var(--medium-grey);border:none;
    padding:0.2rem 0.5rem;font-size:0.75rem;border-radius:20px;cursor:pointer;transition:all 0.2s;
  }
  #speed-control button.active { background:var(--black);color:var(--white); }
  #speed-control button:hover:not(.active) { color:var(--black); }

  /* Calendar */
  #calendar-modal {
    position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.45);
    display:none;align-items:center;justify-content:center;backdrop-filter:blur(4px);
  }
  #calendar-modal.active { display:flex;animation:fadeIn 0.2s ease; }
  #calendar-inner {
    background:var(--white);border:2px solid var(--black);border-radius:16px;
    padding:2rem;width:min(560px,94vw);max-height:90vh;overflow-y:auto;
    animation:scaleIn 0.22s ease;
  }
  @keyframes scaleIn { from{transform:scale(0.96);opacity:0} to{transform:scale(1);opacity:1} }
  #calendar-header { display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem; }
  #calendar-header h2 { flex:1;font-size:1.1rem;font-weight:700; }
  #calendar-header button { padding:0.3rem 0.75rem;font-size:1rem;border-radius:8px; }
  #cal-close { margin-left:auto;font-size:0.85rem; }
  .cal-day-headers { display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:0.7rem;font-weight:600;color:var(--medium-grey);margin-bottom:0.5rem; }
  .cal-days { display:grid;grid-template-columns:repeat(7,1fr);gap:2px; }
  .cal-cell { aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-size:0.85rem;transition:background 0.15s;position:relative; }
  .cal-cell:hover:not(.empty) { background:var(--light-grey); }
  .cal-cell.today .cal-num { background:var(--black);color:var(--white);border-radius:50%;width:1.6em;height:1.6em;display:grid;place-content:center; }
  .cal-cell.has-reminders { font-weight:700; }
  .cal-cell.has-reminders .cal-num { font-size:1rem; }
  .cal-dot { font-size:0.6rem;color:var(--black);letter-spacing:-1px;position:absolute;bottom:3px; }
  .cal-cell.empty { cursor:default; }
  #calendar-day-detail { margin-top:1.5rem;border-top:1.5px solid var(--light-grey);padding-top:1rem; }
  #calendar-day-detail h3 { font-size:0.95rem;margin-bottom:0.75rem; }
  .cal-rem-item { padding:0.5rem 0;border-bottom:1px solid var(--light-grey);font-size:0.875rem; }
  .cal-rem-item:last-child { border-bottom:none; }
  .cal-empty { color:var(--medium-grey);font-size:0.875rem; }

  @keyframes fadeIn { from{opacity:0} to{opacity:1} }
  `;
  document.head.appendChild(style);
}

/* ─── INIT ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  const savedSpeed = localStorage.getItem('easymind_speed');
  if (savedSpeed && SPEEDS[savedSpeed]) currentSpeed = savedSpeed;

  injectStyles();
  playLoadAnimation();
  createUserBadge();
  createAuthModal();
  createQuickRemindOverlay();
  createSpeedControl();
  initButtons();
  initKeyboard();

  // Auth must complete before any API calls
  await initAuth();

  setTimeout(() => showStep(0), 800);
});
