/* ============================================================
   easymind — script.js
   TypeForm-style reminder flow + NLP + AI polish + Django REST
   ============================================================ */

/* ─── CONFIG ─────────────────────────────────────────────── */
const API_BASE = 'http://127.0.0.1:8000/api/reminders/';   // Django REST endpoint
const AI_ENABLED = true;              // toggle AI polishing

/* ─── SPEED SETTINGS ─────────────────────────────────────── */
const SPEEDS = {
  slow:   { transition: 600, delay: 300 },
  normal: { transition: 400, delay: 200 },
  fast:   { transition: 200, delay: 80  },
};
let currentSpeed = 'normal';

/* ─── STATE ──────────────────────────────────────────────── */
let state = {
  step: 0,           // 0 = q1, 1 = q2, 2 = q3, 3 = done, 4 = final
  reminderText: '',
  parsedTitle: '',
  date: '',
  time: '',
  location: '',
  forLocation: false,  // true = reminder TO GO somewhere; false = AT location
};

/* ─── DOM CACHE ──────────────────────────────────────────── */
const wrappers     = () => document.querySelectorAll('.reminder-form-wrapper');
const q1Input      = () => document.querySelector('.question-1 input');
const q2DateInput  = () => document.querySelector('.question-2 .reminder-form-multiple-inputs input:first-child');
const q2TimeInput  = () => document.querySelector('.question-2 .reminder-form-multiple-inputs input:last-child');
const q3ForInput   = () => document.querySelector('.question-3 .reminder-form-multiple-inputs input:first-child');
const q3AtInput    = () => document.querySelector('.question-3 .reminder-form-multiple-inputs input:last-child');
const finalMessage = () => document.querySelector('.reminder-form-final-message h1');
const addAnotherBtn = () => document.querySelector('.reminder-form-options button:first-child');
const viewAllBtn    = () => document.querySelector('.reminder-form-options button:last-child');

/* ─── UTILS ──────────────────────────────────────────────── */
function speed() { return SPEEDS[currentSpeed]; }

function showStep(index) {
  const all = wrappers();
  all.forEach((el, i) => {
    el.classList.remove('active', 'hidden', 'exiting');
    if (i === index) {
      el.style.display = 'block';
      el.classList.add('active');
      // slide-up entrance
      el.style.opacity = '0';
      el.style.transform = 'translateY(30px)';
      requestAnimationFrame(() => {
        el.style.transition = `opacity ${speed().transition}ms ease, transform ${speed().transition}ms ease`;
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      });
      // focus first input
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

/* ─── NATURAL LANGUAGE PARSING ───────────────────────────── */
/**
 * Given a free-text string, attempt to extract:
 *   date, time, location
 * Returns an object with whatever was found (null if not found).
 */
function parseNaturalLanguage(text) {
  const result = { date: null, time: null, location: null, cleanTitle: text };

  // ── TIME ──────────────────────────────────────────────────
  // e.g. "at 9am", "by 5:30 PM", "@ 8", "11pm"
  const timePatterns = [
    /\b(?:at|by|@)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i,
    /\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/i,
    /\b(\d{1,2}\s*(?:am|pm))\b/i,
  ];
  for (const pat of timePatterns) {
    const m = text.match(pat);
    if (m) {
      result.time = normalizeTime(m[1].trim());
      result.cleanTitle = result.cleanTitle.replace(m[0], '').trim();
      break;
    }
  }

  // ── DATE ──────────────────────────────────────────────────
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

  const relativeMap = {
    'today':     today,
    'tonight':   today,
    'tomorrow':  tomorrow,
  };
  for (const [word, date] of Object.entries(relativeMap)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(result.cleanTitle)) {
      result.date = formatDate(date);
      result.cleanTitle = result.cleanTitle.replace(new RegExp(`\\b${word}\\b`, 'i'), '').trim();
      break;
    }
  }

  // weekdays: "next Monday", "this Friday"
  if (!result.date) {
    const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const wdMatch = result.cleanTitle.match(/\b(?:next\s+|this\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (wdMatch) {
      const targetDay = weekdays.indexOf(wdMatch[1].toLowerCase());
      const d = new Date(today);
      let diff = targetDay - d.getDay();
      if (diff <= 0 || /\bnext\b/i.test(wdMatch[0])) diff += 7;
      d.setDate(d.getDate() + diff);
      result.date = formatDate(d);
      result.cleanTitle = result.cleanTitle.replace(wdMatch[0], '').trim();
    }
  }

  // explicit date: "June 15", "15 June", "Jun 15th", "6/15"
  if (!result.date) {
    const months = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec';
    const explicitMatch = result.cleanTitle.match(
      new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${months})\\b|\\b(${months})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b|\\b(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?\\b`, 'i')
    );
    if (explicitMatch) {
      const parsed = new Date(explicitMatch[0]);
      if (!isNaN(parsed)) {
        if (parsed < today) parsed.setFullYear(today.getFullYear() + 1);
        result.date = formatDate(parsed);
        result.cleanTitle = result.cleanTitle.replace(explicitMatch[0], '').trim();
      }
    }
  }

  // "in X days/weeks"
  if (!result.date) {
    const inMatch = result.cleanTitle.match(/\bin\s+(\d+)\s+(day|days|week|weeks)\b/i);
    if (inMatch) {
      const n = parseInt(inMatch[1]);
      const d = new Date(today);
      if (/week/i.test(inMatch[2])) d.setDate(d.getDate() + n * 7);
      else d.setDate(d.getDate() + n);
      result.date = formatDate(d);
      result.cleanTitle = result.cleanTitle.replace(inMatch[0], '').trim();
    }
  }

  // ── LOCATION ──────────────────────────────────────────────
  // "at [place]", "@ [place]"  — only if it doesn't look like a time
  const locMatch = result.cleanTitle.match(/\b(?:at|@)\s+([A-Z][a-zA-Z\s]+?)(?:\s+by|\s+on|\s+before|$)/);
  if (locMatch && !locMatch[1].match(/^\d/)) {
    result.location = locMatch[1].trim();
    result.cleanTitle = result.cleanTitle.replace(locMatch[0], '').trim();
  }

  // tidy up double-spaces, trailing prepositions, punctuation
  result.cleanTitle = result.cleanTitle
    .replace(/\s{2,}/g, ' ')
    .replace(/^(by|at|on|for|before|,)\s*/i, '')
    .replace(/[,\s]+$/, '')
    .trim();

  return result;
}

function normalizeTime(raw) {
  // strip and clean, return "HH:MM" 24h or readable "9:00 AM"
  return raw.replace(/\s+/g, '').toUpperCase();
}

function formatDate(d) {
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function friendlyDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T12:00:00'); // noon avoids TZ edge cases
  return d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
}

/* ─── AI POLISHING  ──────────────────────────────────────── */
async function aiPolish(rawText) {
  if (!AI_ENABLED) return rawText;
  try {
    const res = await fetch('http://127.0.0.1:8000/api/ai/polish/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `You are a reminder title cleaner. Take this raw reminder text and return ONLY a clean, concise reminder title (max 10 words). Remove filler words, fix grammar, make it action-oriented. Raw text: "${rawText}". Reply with ONLY the cleaned title, nothing else.`
        }]
      })
    });
    const data = await res.json();
    return data?.content?.[0]?.text?.trim() || rawText;
  } catch {
    return rawText;
  }
}

async function aiParseQuickRemind(text) {
  try {
    const res = await fetch('http://127.0.0.1:8000/api/ai/parse/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `You are a reminder parser. Parse the following text into a JSON object with keys: title (string), date (YYYY-MM-DD or null), time (HH:MM 24h string or null), location (string or null). Today is ${new Date().toISOString().split('T')[0]}. Text: "${text}". Reply with ONLY valid JSON, no markdown, no explanation.`
        }]
      })
    });
    const data = await res.json();
    const raw = data?.content?.[0]?.text?.trim() || '{}';
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ─── DJANGO REST API ─────────────────────────────────────── */
async function saveReminder(payload) {
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCookie('csrftoken'),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Save reminder failed:', err);
    return null;
  }
}

async function fetchReminders() {
  try {
    const res = await fetch(API_BASE);
    return await res.json();
  } catch {
    return [];
  }
}

function getCookie(name) {
  const v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
  return v ? v.pop() : '';
}

/* ─── FORM FLOW ──────────────────────────────────────────── */
async function handleQ1() {
  const val = q1Input()?.value?.trim();
  if (!val) { shakeInput(q1Input()); return; }

  // NLP parse
  const parsed = parseNaturalLanguage(val);
  state.reminderText = val;

  // AI polish title in background
  showLoadingOnButton(document.querySelector('.question-1 .enter-button'));
  state.parsedTitle = await aiPolish(parsed.cleanTitle || val);
  hideLoadingOnButton(document.querySelector('.question-1 .enter-button'));

  // if NLP found everything, skip to done
  if (parsed.date && parsed.time) {
    state.date = parsed.date;
    state.time = parsed.time;
    state.location = parsed.location || '';
    await submitAndFinish();
    return;
  }

  // if NLP found date but not time, skip date input
  if (parsed.date) {
    state.date = parsed.date;
    prefillQ2Date(parsed.date);
  }
  if (parsed.time) {
    state.time = parsed.time;
  }

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

  // parse date input
  const parsedDate = parseNaturalLanguage(dateVal);
  state.date = parsedDate.date || parsedDate.cleanTitle; // fallback to raw

  const parsedTime = parseNaturalLanguage(timeVal || '');
  state.time = parsedTime.time || timeVal || '';

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
  // Build API payload
  const payload = {
    title: state.parsedTitle || state.reminderText,
    date:  state.date,
    time:  state.time || null,
    location: state.location || '',
  };

  // Show "Done!" flash
  exitAndShow(3);

  // Save to Django
  const saved = await saveReminder(payload);

  // Build confirmation message
  const msg = buildConfirmationMessage(payload, saved);

  // After brief pause, show final screen
  setTimeout(() => {
    if (finalMessage()) finalMessage().textContent = msg;
    exitAndShow(4);
  }, speed().transition * 1.5 + 300);
}

function buildConfirmationMessage(payload, saved) {
  const title = payload.title;
  const date  = payload.date ? friendlyDate(payload.date) : 'the scheduled time';
  const timeStr = payload.time ? ` at ${payload.time}` : '';
  const locStr  = payload.location ? ` at ${payload.location}` : '';
  return `We'll remind you a day before and 15 minutes before for "${title}", on ${date}${timeStr}${locStr}.`;
}

function resetForm() {
  state = { step: 0, reminderText: '', parsedTitle: '', date: '', time: '', location: '', forLocation: false };
  document.querySelectorAll('input').forEach(i => i.value = '');
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
      <input type="text" id="quick-remind-input" placeholder='Try "Apply for OSAP tomorrow by 5PM" — AI will handle the rest' autocomplete="off">
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

  // Events
  document.getElementById('quick-remind-close').onclick = hideQuickRemind;
  document.getElementById('quick-remind-submit').onclick = handleQuickRemind;
  document.getElementById('quick-remind-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleQuickRemind();
    if (e.key === 'Escape') hideQuickRemind();
  });

  overlay.addEventListener('click', e => { if (e.target === overlay) hideQuickRemind(); });
}

function showQuickRemind() {
  const overlay = document.getElementById('quick-remind-overlay');
  overlay.classList.add('active');
  setTimeout(() => document.getElementById('quick-remind-input')?.focus(), 100);
}

function hideQuickRemind() {
  const overlay = document.getElementById('quick-remind-overlay');
  overlay.classList.remove('active');
  document.getElementById('quick-remind-input').value = '';
  document.getElementById('quick-remind-status').textContent = '';
}

async function handleQuickRemind() {
  const input = document.getElementById('quick-remind-input');
  const status = document.getElementById('quick-remind-status');
  const val = input?.value?.trim();
  if (!val) { shakeInput(input); return; }

  status.textContent = '✦ AI is reading that…';
  input.disabled = true;

  // Try AI parse first, fall back to NLP
  let parsed = await aiParseQuickRemind(val);
  if (!parsed || !parsed.title) {
    const nlp = parseNaturalLanguage(val);
    parsed = {
      title: await aiPolish(nlp.cleanTitle || val),
      date: nlp.date,
      time: nlp.time,
      location: nlp.location,
    };
  }

  const payload = {
    title: parsed.title || val,
    date:  parsed.date || null,
    time:  parsed.time || null,
    location: parsed.location || '',
  };

  const saved = await saveReminder(payload);
  input.disabled = false;

  if (saved) {
    const dateStr = payload.date ? friendlyDate(payload.date) : 'soon';
    status.textContent = `✓ Reminder set — "${payload.title}" on ${dateStr}`;
    status.classList.add('success');
    input.value = '';
    setTimeout(hideQuickRemind, 2200);
  } else {
    status.textContent = '✗ Something went wrong. Try again.';
    status.classList.add('error');
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

  // group reminders by date
  const remindersByDate = {};
  reminders.forEach(r => {
    if (!remindersByDate[r.date]) remindersByDate[r.date] = [];
    remindersByDate[r.date].push(r);
  });

  const year  = calViewDate.getFullYear();
  const month = calViewDate.getMonth();
  monthLabel.textContent = new Date(year, month, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });

  // Day headers
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split('T')[0];

  let html = '<div class="cal-day-headers">' + days.map(d => `<span>${d}</span>`).join('') + '</div>';
  html += '<div class="cal-days">';

  // empty cells before first day
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const iso  = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const rems = remindersByDate[iso] || [];
    const count = rems.length;
    const isToday = iso === today;
    const hasRem  = count > 0;

    html += `<div class="cal-cell${isToday ? ' today' : ''}${hasRem ? ' has-reminders' : ''}" 
                  data-date="${iso}" data-count="${count}">
               <span class="cal-num">${d}</span>
               ${hasRem ? `<span class="cal-dot">${count > 3 ? '3+' : '•'.repeat(count)}</span>` : ''}
             </div>`;
  }
  html += '</div>';
  grid.innerHTML = html;

  // Click on day to show detail
  grid.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
    cell.onclick = () => {
      const date = cell.dataset.date;
      const rems = remindersByDate[date] || [];
      detail.innerHTML = `
        <h3>${friendlyDate(date)}</h3>
        ${rems.length === 0
          ? '<p class="cal-empty">No reminders.</p>'
          : rems.map(r => `<div class="cal-rem-item"><strong>${r.title}</strong>${r.time ? ' · '+r.time : ''}</div>`).join('')
        }
      `;
    };
  });

  // Prev / Next
  modal.querySelector('#cal-prev').onclick = () => {
    calViewDate = new Date(year, month - 1, 1);
    fetchReminders().then(r => renderCalendar(modal, r));
  };
  modal.querySelector('#cal-next').onclick = () => {
    calViewDate = new Date(year, month + 1, 1);
    fetchReminders().then(r => renderCalendar(modal, r));
  };
}

/* ─── MICRO HELPERS ──────────────────────────────────────── */
function shakeInput(el) {
  if (!el) return;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 400);
}

function showLoadingOnButton(btn) {
  if (!btn) return;
  btn.dataset.origText = btn.querySelector('h2')?.textContent || '';
  if (btn.querySelector('h2')) btn.querySelector('h2').textContent = '…';
  btn.disabled = true;
}

function hideLoadingOnButton(btn) {
  if (!btn) return;
  if (btn.querySelector('h2')) btn.querySelector('h2').textContent = btn.dataset.origText || 'enter';
  btn.disabled = false;
}

/* ─── KEYBOARD SHORTCUTS ─────────────────────────────────── */
function initKeyboard() {
  document.addEventListener('keydown', e => {
    // Cmd/Ctrl + K → quick remind
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      showQuickRemind();
      return;
    }
    // Opt/Alt + C → calendar
    if (e.altKey && e.key === 'c') {
      e.preventDefault();
      showCalendarView();
      return;
    }
    // Escape → close overlays / form
    if (e.key === 'Escape') {
      const calModal = document.getElementById('calendar-modal');
      const qrOverlay = document.getElementById('quick-remind-overlay');
      if (calModal?.classList.contains('active')) { calModal.classList.remove('active'); return; }
      if (qrOverlay?.classList.contains('active')) { hideQuickRemind(); return; }
      handleClose();
      return;
    }
    // Enter → advance current step (only when not in overlay)
    if (e.key === 'Enter') {
      const qrOverlay = document.getElementById('quick-remind-overlay');
      if (qrOverlay?.classList.contains('active')) return; // handled inside overlay
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
  // Animate close: slide out, then reset
  const all = wrappers();
  const current = all[state.step];
  if (current) {
    current.style.transition = `opacity 300ms ease, transform 300ms ease`;
    current.style.opacity = '0';
    current.style.transform = 'translateY(20px)';
    setTimeout(resetForm, 350);
  }
}

/* ─── LOADING ANIMATION ──────────────────────────────────── */
function playLoadAnimation() {
  const splash = document.createElement('div');
  splash.id = 'load-splash';
  splash.innerHTML = `<span class="load-logo">Aisé</span>`;
  document.body.appendChild(splash);

  // Force reflow then animate out
  setTimeout(() => {
    splash.style.opacity = '0';
    splash.style.transform = 'scale(1.04)';
  }, 700);
  setTimeout(() => splash.remove(), 4200);
}

/* ─── WIRE UP BUTTONS ────────────────────────────────────── */
function initButtons() {
  // Enter buttons on each step
  document.querySelector('.question-1 .enter-button')?.addEventListener('click', handleQ1);
  document.querySelector('.question-2 .enter-button')?.addEventListener('click', handleQ2);
  document.querySelector('.question-3 .enter-button')?.addEventListener('click', handleQ3);

  // Header: calendar icon
  document.querySelector('.calendar-view')?.addEventListener('click', showCalendarView);

  // Header: quick remind button
  document.querySelector('.quick-remind')?.addEventListener('click', showQuickRemind);

  // Header: close
  document.querySelector('.close-view')?.addEventListener('click', handleClose);

  // Final screen buttons (wired after DOM is built)
  document.addEventListener('click', e => {
    if (e.target.closest('.reminder-form-options button:first-child') ||
        e.target.closest('[data-action="add-another"]')) {
      resetForm();
    }
    if (e.target.closest('.reminder-form-options button:last-child') ||
        e.target.closest('[data-action="view-all"]')) {
      showCalendarView();
    }
  });
}

/* ─── STYLES (injected) ──────────────────────────────────── */
function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `

  /* ── Animations ── */
  @keyframes shake {
    0%,100%{ transform:translateX(0) }
    20%    { transform:translateX(-6px) }
    40%    { transform:translateX(6px) }
    60%    { transform:translateX(-4px) }
    80%    { transform:translateX(4px) }
  }
  .shake { animation: shake 0.35s ease; }

  /* ── Load Splash ── */
  #load-splash {
    position:fixed;inset:0;z-index:9999;
    background:var(--black);
    display:grid;place-content:center;
    transition: opacity 0.4s ease, transform 0.4s ease;
  }
  .load-logo {
    font-family:'Inter',sans-serif;
    font-size:clamp(2rem,8vw,5rem);
    font-weight:800;
    color:var(--white);
    letter-spacing:-0.04em;
    animation: logoIn 0.5s ease;
  }
  @keyframes logoIn {
    from { opacity:0; transform:translateY(12px); }
    to   { opacity:1; transform:translateY(0); }
  }

  /* ── Quick Remind Overlay ── */
  #quick-remind-overlay {
    position:fixed;inset:0;z-index:1000;
    background:rgba(0,0,0,0.45);
    display:none;
    align-items:flex-end;
    justify-content:center;
    padding-bottom:2.5rem;
    backdrop-filter:blur(4px);
  }
  #quick-remind-overlay.active { display:flex; animation:fadeIn 0.2s ease; }
  #quick-remind-bar {
    background:var(--white);
    border:2px solid var(--black);
    border-radius:780px;
    padding:0.75rem 1.25rem;
    display:flex;align-items:center;gap:0.75rem;
    width:min(680px,90vw);
    box-shadow:0 8px 32px rgba(0,0,0,0.18);
    animation: slideUp 0.25s ease;
  }
  @keyframes slideUp {
    from { transform:translateY(20px); opacity:0; }
    to   { transform:translateY(0);    opacity:1; }
  }
  .qr-icon { color:var(--medium-grey); display:flex; }
  #quick-remind-input {
    flex:1;border:none;outline:none;
    font-size:1rem;font-family:'Inter',sans-serif;
    background:transparent;color:var(--black);
  }
  #quick-remind-input::placeholder { color:var(--light-grey); }
  #quick-remind-submit {
    padding:0.4rem 0.75rem;min-width:auto;border-radius:20px;
  }
  #quick-remind-close {
    padding:0.4rem 0.75rem;min-width:auto;border-radius:20px;
    border:1.5px solid var(--light-grey);
  }
  #quick-remind-status {
    text-align:center;font-size:0.875rem;margin-top:0.5rem;
    color:var(--medium-grey);min-height:1.2em;
    transition:color 0.2s;
  }
  #quick-remind-status.success { color:#2a9d2a; }
  #quick-remind-status.error   { color:#c0392b; }

  /* ── Speed Control ── */
  #speed-control {
    position:fixed;bottom:1.5rem;right:1.5rem;
    display:flex;align-items:center;gap:0.4rem;
    background:var(--white);border:1.5px solid var(--light-grey);
    border-radius:780px;padding:0.3rem 0.75rem;
    font-size:0.75rem;z-index:500;
    box-shadow:0 2px 8px rgba(0,0,0,0.07);
  }
  .speed-label { color:var(--medium-grey);margin-right:0.2rem; }
  #speed-control button {
    background:transparent;color:var(--medium-grey);
    border:none;padding:0.2rem 0.5rem;font-size:0.75rem;
    border-radius:20px;cursor:pointer;transition:all 0.2s;
  }
  #speed-control button.active {
    background:var(--black);color:var(--white);
  }
  #speed-control button:hover:not(.active) { color:var(--black); }

  /* ── Calendar Modal ── */
  #calendar-modal {
    position:fixed;inset:0;z-index:1000;
    background:rgba(0,0,0,0.45);
    display:none;align-items:center;justify-content:center;
    backdrop-filter:blur(4px);
  }
  #calendar-modal.active { display:flex;animation:fadeIn 0.2s ease; }
  #calendar-inner {
    background:var(--white);
    border:2px solid var(--black);
    border-radius:16px;
    padding:2rem;
    width:min(560px,94vw);
    max-height:90vh;overflow-y:auto;
    animation:scaleIn 0.22s ease;
  }
  @keyframes scaleIn {
    from { transform:scale(0.96);opacity:0; }
    to   { transform:scale(1);   opacity:1; }
  }
  #calendar-header {
    display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;
  }
  #calendar-header h2 { flex:1;font-size:1.1rem;font-weight:700; }
  #calendar-header button {
    padding:0.3rem 0.75rem;font-size:1rem;border-radius:8px;
  }
  #cal-close { margin-left:auto;font-size:0.85rem; }
  .cal-day-headers {
    display:grid;grid-template-columns:repeat(7,1fr);
    text-align:center;font-size:0.7rem;font-weight:600;
    color:var(--medium-grey);margin-bottom:0.5rem;
  }
  .cal-days {
    display:grid;grid-template-columns:repeat(7,1fr);gap:2px;
  }
  .cal-cell {
    aspect-ratio:1;display:flex;flex-direction:column;
    align-items:center;justify-content:center;
    border-radius:8px;cursor:pointer;
    font-size:0.85rem;transition:background 0.15s;
    position:relative;
  }
  .cal-cell:hover:not(.empty) { background:var(--light-grey); }
  .cal-cell.today .cal-num {
    background:var(--black);color:var(--white);
    border-radius:50%;width:1.6em;height:1.6em;
    display:grid;place-content:center;
  }
  .cal-cell.has-reminders {
    font-weight:700;
  }
  .cal-cell.has-reminders .cal-num {
    font-size:1rem;
  }
  .cal-dot {
    font-size:0.6rem;color:var(--black);letter-spacing:-1px;
    position:absolute;bottom:3px;
  }
  .cal-cell.empty { cursor:default; }
  #calendar-day-detail {
    margin-top:1.5rem;border-top:1.5px solid var(--light-grey);
    padding-top:1rem;
  }
  #calendar-day-detail h3 { font-size:0.95rem;margin-bottom:0.75rem; }
  .cal-rem-item {
    padding:0.5rem 0;border-bottom:1px solid var(--light-grey);
    font-size:0.875rem;
  }
  .cal-rem-item:last-child { border-bottom:none; }
  .cal-empty { color:var(--medium-grey);font-size:0.875rem; }

  @keyframes fadeIn { from{opacity:0} to{opacity:1} }

  `;
  document.head.appendChild(style);
}

/* ─── INIT ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Restore speed preference
  const savedSpeed = localStorage.getItem('easymind_speed');
  if (savedSpeed && SPEEDS[savedSpeed]) currentSpeed = savedSpeed;

  injectStyles();
  playLoadAnimation();
  createQuickRemindOverlay();
  createSpeedControl();
  initButtons();
  initKeyboard();

  // Show first step after splash
  setTimeout(() => showStep(0), 800);
});