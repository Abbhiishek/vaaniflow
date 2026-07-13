'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let settings = {};
let history = [];
const saveTimers = new Map();
let configInfo = null;
let lastAppView = 'home';
let hotkeyLabels = {};

// Keep this enabled while developing the onboarding experience. It only
// forces the welcome screen in unpackaged builds; production still shows it
// once, when provider configuration is missing.
const FORCE_WELCOME_IN_DEVELOPMENT = true;

const SETTINGS_CATEGORIES = new Set(['general', 'system', 'appearance', 'provider', 'account']);

// ---------------- navigation ----------------

function showSettingsCategory(category) {
  const next = SETTINGS_CATEGORIES.has(category) ? category : 'general';
  $$('.settings-nav-item').forEach((item) => item.classList.toggle('active', item.dataset.settingsCategory === next));
  $$('.settings-page').forEach((page) => {
    const active = page.dataset.settingsPage === next;
    page.hidden = !active;
    page.classList.toggle('active', active);
  });
  $('.settings-main').scrollTop = 0;
}

function showView(name, settingsCategory = 'general') {
  const target = $(`#view-${name}`) ? name : 'home';
  $$('.view').forEach((v) => v.classList.remove('active'));
  $(`#view-${target}`).classList.add('active');
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === target));
  document.body.classList.toggle('settings-mode', target === 'settings');
  if (target === 'settings') showSettingsCategory(settingsCategory);
  else lastAppView = target;
}

function navigateTo(view, category = 'general') {
  const route = view === 'settings' ? `/settings/${category}` : `/${view}`;
  if (window.location.hash.slice(1) === route) showView(view, category);
  else window.location.hash = route;
}

function routeFromLocation() {
  const route = window.location.hash.slice(1) || '/home';
  const match = route.match(/^\/settings\/([^/]+)$/);
  if (match) showView('settings', match[1]);
  else showView(route.replace(/^\//, '') || 'home');
}

function showWelcomeScreen() {
  document.body.classList.add('welcome-mode');
  $('#welcome-screen').hidden = false;
  requestAnimationFrame(() => $('#welcome-screen').classList.add('welcome-ready'));
  setTimeout(() => $('#welcome-get-started').focus(), 450);
}

function hideWelcomeScreen() {
  $('#welcome-screen').classList.add('welcome-leaving');
  setTimeout(() => {
    $('#welcome-screen').hidden = true;
    $('#welcome-screen').classList.remove('welcome-ready', 'welcome-leaving');
    document.body.classList.remove('welcome-mode');
  }, 360);
}

$$('.nav-item').forEach((btn) => btn.addEventListener('click', () => navigateTo(btn.dataset.view)));
$$('.settings-nav-item').forEach((btn) => btn.addEventListener('click', () => navigateTo('settings', btn.dataset.settingsCategory)));
$('#settings-back').addEventListener('click', () => navigateTo(lastAppView));
$('#sidebar-profile').addEventListener('click', () => navigateTo('settings', 'account'));
$('#settings-profile-summary').addEventListener('click', () => navigateTo('settings', 'account'));
window.addEventListener('hashchange', routeFromLocation);

$('#btn-dictate').addEventListener('click', () => window.vaani.toggleDictation());
$('#welcome-get-started').addEventListener('click', async () => {
  const button = $('#welcome-get-started');
  button.disabled = true;
  try {
    if (!settings.onboardingCompleted) {
      settings = await window.vaani.setSettings({ onboardingCompleted: true });
    }
  } finally {
    hideWelcomeScreen();
    navigateTo('home');
    setTimeout(() => { button.disabled = false; }, 400);
  }
});

// ---------------- toast ----------------

let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

// ---------------- live dictation status ----------------

let homeSessionResetTimer = null;
let homeSessionType = 'idle';
let homeSessionMode = 'ptt';

function storedShortcutLabel() {
  return hotkeyLabels[settings.hotkey] || customShortcutLabel(settings.hotkey) || 'Your shortcut';
}

function syncHomeShortcut() {
  const shortcut = storedShortcutLabel();
  $('#home-shortcut').textContent = shortcut;
  if (homeSessionType === 'idle') {
    $('#home-session-detail').textContent = `Hold ${shortcut} and speak. Release to insert your words.`;
  } else if (homeSessionType === 'recording') {
    $('#home-session-detail').textContent = homeSessionMode === 'handsfree'
      ? `Press ${shortcut} again or Space to finish.`
      : `Release ${shortcut} to finish.`;
  }
}

function updateHomeSession(message = { type: 'idle' }) {
  clearTimeout(homeSessionResetTimer);
  const card = $('#home-session');
  const label = $('#home-session-label');
  const detail = $('#home-session-detail');
  const shortcut = storedShortcutLabel();
  const type = message.type || 'idle';

  if (type === 'start') {
    homeSessionType = 'recording';
    homeSessionMode = message.mode || 'ptt';
    card.className = 'home-session recording';
    label.textContent = homeSessionMode === 'handsfree' ? 'Recording hands-free' : 'Recording';
    detail.textContent = homeSessionMode === 'handsfree'
      ? `Press ${shortcut} again or Space to finish.`
      : `Release ${shortcut} to finish.`;
  } else if (type === 'mode') {
    homeSessionType = 'recording';
    homeSessionMode = message.mode || 'handsfree';
    card.className = 'home-session recording';
    label.textContent = 'Recording hands-free';
    detail.textContent = `Press ${shortcut} again or Space to finish.`;
  } else if (type === 'partial') {
    if (homeSessionType !== 'recording') updateHomeSession({ type: 'start', mode: homeSessionMode });
    if (message.text) detail.textContent = message.text;
  } else if (type === 'processing' || type === 'status') {
    homeSessionType = 'processing';
    card.className = 'home-session processing';
    label.textContent = type === 'status' && message.text ? message.text : 'Transcribing';
    detail.textContent = 'Turning your recording into text…';
  } else if (type === 'done') {
    homeSessionType = 'done';
    card.className = 'home-session done';
    label.textContent = 'Dictation complete';
    detail.textContent = `${message.words || 0} word${message.words === 1 ? '' : 's'} ${message.pasted ? 'inserted' : 'copied'}.`;
    homeSessionResetTimer = setTimeout(() => updateHomeSession({ type: 'idle' }), 1800);
  } else if (type === 'error') {
    homeSessionType = 'error';
    card.className = 'home-session error';
    label.textContent = 'Dictation stopped';
    detail.textContent = message.message || 'Something went wrong.';
    homeSessionResetTimer = setTimeout(() => updateHomeSession({ type: 'idle' }), 3200);
  } else {
    homeSessionType = 'idle';
    homeSessionMode = 'ptt';
    card.className = 'home-session ready';
    label.textContent = 'Ready to dictate';
    detail.textContent = `Hold ${shortcut} and speak. Release to insert your words.`;
  }

  $('#home-shortcut').textContent = shortcut;
}

window.vaani.onSession(updateHomeSession);

// ---------------- home: past generations ----------------

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDay(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function transcriptCard(entry) {
  const card = document.createElement('div');
  card.className = 'transcript';

  const text = document.createElement('div');
  text.className = 'transcript-text';
  text.textContent = entry.text;

  const meta = document.createElement('div');
  meta.className = 'transcript-meta';

  const time = document.createElement('span');
  time.textContent = `${fmtTime(entry.ts)} · ${entry.words} words · ${fmtDuration(entry.durationMs)}`
    + (entry.app ? ` · ${entry.app}` : '');

  const spacer = document.createElement('span');
  spacer.className = 'spacer';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'icon-btn';
  copyBtn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>Copy';
  copyBtn.addEventListener('click', async () => {
    await window.vaani.copyText(entry.text);
    toast('Copied to clipboard');
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn delete';
  delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>Delete';
  delBtn.addEventListener('click', async () => {
    history = await window.vaani.deleteTranscript(entry.id);
    renderAll();
  });

  meta.append(time, spacer, copyBtn, delBtn);
  card.append(text, meta);
  return card;
}

function renderHistory() {
  const list = $('#history-list');
  const q = $('#search').value.trim().toLowerCase();
  list.innerHTML = '';
  const filtered = q ? history.filter((e) => e.text.toLowerCase().includes(q)) : history;
  $('#history-empty').hidden = filtered.length > 0;

  let lastDay = null;
  for (const entry of filtered.slice(0, 300)) {
    const day = fmtDay(entry.ts);
    if (day !== lastDay) {
      const label = document.createElement('div');
      label.className = 'day-label';
      label.textContent = day;
      list.appendChild(label);
      lastDay = day;
    }
    list.appendChild(transcriptCard(entry));
  }
}

$('#search').addEventListener('input', renderHistory);

$('#btn-clear-history').addEventListener('click', async () => {
  if (!history.length) return;
  history = await window.vaani.clearHistory();
  renderAll();
  toast('History cleared');
});

window.vaani.onHistoryChanged(async () => {
  history = await window.vaani.getHistory();
  renderAll();
});

// ---------------- insights ----------------

const TYPING_WPM = 40; // average typing speed the "time saved" stat compares against

// function words excluded from the "Top words" ranking so it surfaces what the
// user actually talks about, not English plumbing
const COMMON_WORDS = new Set(('the,and,that,this,with,for,you,your,not,are,was,were,have,has,had,but,they,them,their,then,than,there,here,what,when,where,which,who,why,how,can,could,would,should,will,shall,may,might,must,just,like,also,very,really,about,into,over,under,after,before,between,because,its,from,out,off,all,any,some,more,most,much,many,few,now,only,even,still,too,again,once,she,him,her,his,hers,our,ours,out,being,been,does,did,doing,get,got,going,want,need,make,made,let,say,said,see,know,think,thing,things,one,two,way,well,yes,yeah,okay,right,actually,basically,something,anything,everything,nothing,someone,anyone,everyone,dont,cant,wont,didnt,doesnt,isnt,arent,wasnt,youre,thats,were,weve,ive,ill,youll,hes,shes,theyre,lets,gonna,kind,sort,bit,lot,use,using,used').split(','));

function tokenizeWords(s) {
  return (String(s || '').toLowerCase().match(/[a-z][a-z'’-]*[a-z]/g) || [])
    .map((w) => w.replace(/[’']/g, ''));
}

function renderStats() {
  const totalWords = history.reduce((n, e) => n + e.words, 0);
  const totalMs = history.reduce((n, e) => n + e.durationMs, 0);
  const averageWpm = totalMs > 3000 ? Math.round(totalWords / (totalMs / 60000)) : null;
  const days = new Set(history.map((e) => new Date(e.ts).toDateString()));
  $('#stat-words').textContent = totalWords.toLocaleString();
  $('#stat-count').textContent = history.length.toLocaleString();
  $('#stat-wpm').textContent = averageWpm ?? '–';

  const reachedMilestone = [100000, 50000, 25000, 10000, 5000, 1000]
    .find((milestone) => totalWords >= milestone);
  $('#stat-milestone').textContent = reachedMilestone
    ? `${new Intl.NumberFormat([], { notation: 'compact', maximumFractionDigits: 0 }).format(reachedMilestone)} milestone`
    : 'Building momentum';
  $('#stat-count-sub').textContent = `${days.size.toLocaleString()} active day${days.size === 1 ? '' : 's'}`;
  $('#stat-wpm-sub').textContent = averageWpm
    ? `${(averageWpm / TYPING_WPM).toFixed(1)}× typical typing pace`
    : 'Compared with typing';

  // ---- savings ----
  const chars = history.reduce((n, e) => n + e.text.length, 0);
  $('#stat-keys').textContent = chars >= 100000
    ? new Intl.NumberFormat([], { notation: 'compact', maximumFractionDigits: 1 }).format(chars)
    : chars.toLocaleString();

  const savedMin = Math.max(0, totalWords / TYPING_WPM - totalMs / 60000);
  $('#stat-time').textContent = savedMin < 1 ? '–'
    : savedMin < 60 ? `${Math.round(savedMin)}m`
    : `${Math.floor(savedMin / 60)}h ${Math.round(savedMin % 60)}m`;

  const monthsActive = new Set(history.map((e) => {
    const d = new Date(e.ts);
    return `${d.getFullYear()}-${d.getMonth()}`;
  })).size;
  $('#stat-words-sub').textContent = monthsActive
    ? `${days.size.toLocaleString()} active days across ${monthsActive} month${monthsActive === 1 ? '' : 's'}`
    : 'Across all your dictations';
  $('#insights-period-label').textContent = monthsActive
    ? `${monthsActive} active month${monthsActive === 1 ? '' : 's'}`
    : 'All-time overview';
  $('#active-days-badge').textContent = `${days.size.toLocaleString()} active day${days.size === 1 ? '' : 's'}`;

  // streak: consecutive days (ending today or yesterday) with ≥1 dictation
  let streak = 0;
  const cursor = new Date();
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1); // grace: today not yet used
  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  $('#stat-streak').textContent = streak;
  $('#stat-streak-sub').textContent = streak > 1 ? `${streak} days and counting` : 'Keep the rhythm going';

  const hour = new Date().getHours();
  $('#greeting').textContent = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

// GitHub-style contribution heatmap: last ~18 weeks of words/day
function renderHeatmap() {
  const container = $('#heatmap');
  container.innerHTML = '';

  const byDay = new Map();
  for (const e of history) {
    const key = new Date(e.ts).toDateString();
    byDay.set(key, (byDay.get(key) || 0) + e.words);
  }

  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (25 * 7 + today.getDay())); // back to a Sunday, 26 columns (~6 months)
  const max = Math.max(1, ...byDay.values());

  const cursor = new Date(start);
  while (cursor <= today) {
    const words = byDay.get(cursor.toDateString()) || 0;
    const level = words === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((words / max) * 4)));
    const cell = document.createElement('i');
    cell.dataset.level = level;
    cell.title = `${cursor.toLocaleDateString([], { month: 'short', day: 'numeric' })} — ${words.toLocaleString()} words`;
    container.appendChild(cell);
    cursor.setDate(cursor.getDate() + 1);
  }
}

function renderChart() {
  const container = $('#chart');
  container.innerHTML = '';
  const days = [];
  const byDay = new Map();
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
    byDay.set(d.toDateString(), 0);
  }
  for (const e of history) {
    const key = new Date(e.ts).toDateString();
    if (byDay.has(key)) byDay.set(key, byDay.get(key) + e.words);
  }
  const max = Math.max(1, ...byDay.values());
  const today = new Date().toDateString();
  days.forEach((d) => {
    const words = byDay.get(d.toDateString());
    const col = document.createElement('div');
    col.className = 'chart-col' + (d.toDateString() === today ? ' today' : '');
    col.title = `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} — ${words.toLocaleString()} words`;
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.style.height = `${Math.max(2, Math.round((words / max) * 100))}%`;
    const label = document.createElement('span');
    label.className = 'chart-day';
    label.textContent = d.toLocaleDateString([], { weekday: 'narrow' });
    col.append(bar, label);
    container.appendChild(col);
  });
}

function renderTopApps() {
  const container = $('#top-apps');
  container.innerHTML = '';
  const byApp = new Map();
  for (const e of history) {
    if (!e.app) continue;
    byApp.set(e.app, (byApp.get(e.app) || 0) + e.words);
  }
  const top = [...byApp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!top.length) {
    const empty = document.createElement('div');
    empty.className = 'insight-empty';
    empty.textContent = 'Dictate into a few apps and they show up here.';
    container.appendChild(empty);
    return;
  }
  const max = top[0][1];
  for (const [app, words] of top) {
    const row = document.createElement('div');
    row.className = 'app-row';
    const left = document.createElement('div');
    left.className = 'app-name';
    const icon = document.createElement('span');
    icon.className = 'app-icon';
    icon.textContent = app.split(/[\s.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
    const details = document.createElement('div');
    details.className = 'app-details';
    const name = document.createElement('div');
    name.className = 'app-title';
    name.textContent = app;
    const bar = document.createElement('div');
    bar.className = 'app-bar';
    bar.style.width = `${Math.max(6, Math.round((words / max) * 100))}%`;
    details.append(name, bar);
    left.append(icon, details);
    const count = document.createElement('span');
    count.className = 'app-words';
    count.textContent = `${words.toLocaleString()} words`;
    row.append(left, count);
    container.appendChild(row);
  }
}

// Ranked word list with count + bar, shared by "Top words" and "Words the AI fixes most".
function renderWordList(container, entries, emptyText, countLabel) {
  container.innerHTML = '';
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'insight-empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  const max = entries[0][1];
  entries.forEach(([word, count], i) => {
    const row = document.createElement('div');
    row.className = 'word-row';
    const rank = document.createElement('span');
    rank.className = 'word-rank';
    rank.textContent = `${i + 1}.`;
    const nameWrap = document.createElement('div');
    nameWrap.className = 'word-name';
    const name = document.createElement('div');
    name.textContent = word;
    const bar = document.createElement('div');
    bar.className = 'word-bar';
    bar.style.width = `${Math.max(6, Math.round((count / max) * 100))}%`;
    nameWrap.append(name, bar);
    const num = document.createElement('span');
    num.className = 'word-count';
    num.textContent = `${count.toLocaleString()}${countLabel}`;
    row.append(rank, nameWrap, num);
    container.appendChild(row);
  });
}

// Top 10 words the user actually says (function words excluded).
function renderTopWords() {
  const counts = new Map();
  for (const e of history) {
    for (const w of tokenizeWords(e.text)) {
      if (w.length < 3 || COMMON_WORDS.has(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  renderWordList($('#top-words'), top, 'Dictate a bit and your most-used words show up here.', '×');
}

// Words that appear in the raw transcript but got removed/changed by the
// polish stage or correction rules — i.e. what Whisper mishears or the user
// stumbles over. Needs entries recorded with `raw` (v1.1+).
function renderFixedWords() {
  const fixed = new Map();
  for (const e of history) {
    if (!e.raw) continue;
    const rawCounts = new Map();
    for (const w of tokenizeWords(e.raw)) rawCounts.set(w, (rawCounts.get(w) || 0) + 1);
    for (const w of tokenizeWords(e.text)) {
      if (rawCounts.has(w)) rawCounts.set(w, rawCounts.get(w) - 1);
    }
    for (const [w, n] of rawCounts) {
      if (n > 0 && w.length >= 2) fixed.set(w, (fixed.get(w) || 0) + n);
    }
  }
  const top = [...fixed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  renderWordList($('#fixed-words'), top, 'Once polished dictations accumulate, the words that get cleaned up most appear here.', '× fixed');
}

function renderAll() {
  renderStats();
  renderHeatmap();
  renderChart();
  renderTopApps();
  renderTopWords();
  renderFixedWords();
  renderHistory();
}

// ---------------- settings fields ----------------

const FIELDS = {
  language: { el: '#set-language', type: 'select' },
  appLanguage: { el: '#set-appLanguage', type: 'select' },
  micDeviceId: { el: '#set-mic', type: 'select' },
  hotkey: { el: '#set-hotkey', type: 'select' },
  autoLearnVocabulary: { el: '#set-autoLearnVocabulary', type: 'bool' },
  windowTransparency: { el: '#set-windowTransparency', type: 'range' },
  accentColor: { el: '#set-accentColor', type: 'color' },
  sounds: { el: '#set-sounds', type: 'bool' },
  muteMusicWhileDictating: { el: '#set-muteMusicWhileDictating', type: 'bool' },
  launchAtLogin: { el: '#set-launchAtLogin', type: 'bool' },
  showFlowBar: { el: '#set-showFlowBar', type: 'bool' },
  showInDock: { el: '#set-showInDock', type: 'bool' },
  milestoneNotifications: { el: '#set-milestoneNotifications', type: 'bool' }
};

function readField(key) {
  const { el, type } = FIELDS[key];
  const node = $(el);
  return type === 'bool' ? node.checked : node.value;
}

function writeField(key, value) {
  const { el, type } = FIELDS[key];
  const node = $(el);
  if (type === 'bool') node.checked = !!value;
  else node.value = value ?? '';
}

function scheduleSave(key) {
  clearTimeout(saveTimers.get(key));
  const timer = setTimeout(async () => {
    let value = readField(key);
    if (key === 'windowTransparency') value = Number(value) || 0;
    settings = await window.vaani.setSettings({ [key]: value });
    if (key === 'hotkey') syncHomeShortcut();
    if (key === 'appLanguage') document.documentElement.lang = value || 'en';
    const note = $('#general-save-note');
    if (note && ['language', 'appLanguage', 'micDeviceId', 'hotkey'].includes(key)) {
      note.textContent = 'Saved on this device.';
      setTimeout(() => { note.textContent = 'Changes save automatically on this device.'; }, 1400);
    }
  }, ['windowTransparency', 'accentColor'].includes(key) ? 350 : 0);
  saveTimers.set(key, timer);
}

for (const key of Object.keys(FIELDS)) {
  const node = $(FIELDS[key].el);
  const immediate = ['range', 'color'].includes(FIELDS[key].type);
  node.addEventListener(immediate ? 'input' : 'change', () => scheduleSave(key));
}

// ---------------- shortcut recorder ----------------

let shortcutRecording = false;
const SHORTCUT_MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'
]);

function shortcutKeyLabel(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const labels = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    PageUp: 'Page Up', PageDown: 'Page Down', Insert: 'Insert', Delete: 'Delete',
    Semicolon: ';', Equal: '=', Comma: ',', Minus: '-', Period: '.', Slash: '/',
    Backquote: '`', BracketLeft: '[', Backslash: '\\', BracketRight: ']', Quote: "'"
  };
  return labels[code] || (/^F([1-9]|1[0-9]|2[0-4])$/.test(code) ? code : '');
}

function customShortcutLabel(id) {
  if (!String(id).startsWith('custom:')) return hotkeyLabels[id] || id;
  const parts = id.slice(7).split('+');
  const code = parts.pop();
  const names = { Control: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Win' };
  return [...parts.map((part) => names[part] || part), shortcutKeyLabel(code)].join(' + ');
}

function ensureHotkeyOption(id, label = customShortcutLabel(id)) {
  if (!id) return;
  const select = $('#set-hotkey');
  let option = [...select.options].find((item) => item.value === id);
  if (!option) {
    option = document.createElement('option');
    option.value = id;
    select.appendChild(option);
  }
  option.textContent = label;
}

async function stopShortcutRecording(message = '') {
  if (!shortcutRecording) return;
  shortcutRecording = false;
  await window.vaani.setShortcutCapture(false);
  $('#shortcut-record').classList.remove('recording');
  $('#shortcut-record').textContent = 'Record';
  $('#shortcut-recording').hidden = true;
  if (message) {
    $('#shortcut-help').textContent = message;
    setTimeout(() => { $('#shortcut-help').textContent = 'Hold the shortcut and speak. Release to insert your words.'; }, 2200);
  }
}

async function startShortcutRecording() {
  if (shortcutRecording) {
    await stopShortcutRecording('Shortcut recording cancelled.');
    return;
  }
  shortcutRecording = true;
  await window.vaani.setShortcutCapture(true);
  $('#shortcut-record').classList.add('recording');
  $('#shortcut-record').textContent = 'Cancel';
  $('#shortcut-recording').hidden = false;
  $('#shortcut-help').textContent = 'Use Ctrl, Alt, or Win with another key. Function keys also work alone.';
}

$('#shortcut-record').addEventListener('click', startShortcutRecording);
document.addEventListener('keydown', async (event) => {
  if (!shortcutRecording) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.code === 'Escape') {
    await stopShortcutRecording('Shortcut recording cancelled.');
    return;
  }
  if (SHORTCUT_MODIFIER_CODES.has(event.code)) return;
  const key = shortcutKeyLabel(event.code);
  if (!key) {
    $('#shortcut-help').textContent = 'That key is not supported. Try a letter, number, navigation key, or F-key.';
    return;
  }
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Control');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Meta');
  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(event.code);
  if (!functionKey && !modifiers.some((modifier) => ['Control', 'Alt', 'Meta'].includes(modifier))) {
    $('#shortcut-help').textContent = 'Add Ctrl, Alt, or Win so normal typing cannot start dictation.';
    return;
  }
  const id = `custom:${[...modifiers, event.code].join('+')}`;
  const label = [...modifiers.map((modifier) => ({ Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' })[modifier]), key].join(' + ');
  ensureHotkeyOption(id, label);
  $('#set-hotkey').value = id;
  settings = await window.vaani.setSettings({ hotkey: id });
  if (settings.hotkey !== id) {
    await stopShortcutRecording('That shortcut could not be activated. Try another combination.');
    return;
  }
  hotkeyLabels[id] = label;
  syncHomeShortcut();
  await stopShortcutRecording(`Shortcut saved: ${label}`);
});

// ---------------- style profiles ----------------

const STYLE_FIELDS = ['personalStyle', 'workStyle', 'emailStyle', 'otherStyle', 'cleanupLevel'];

function syncStyleControls() {
  for (const key of STYLE_FIELDS) {
    const input = document.querySelector(`input[name="${key}"][value="${settings[key]}"]`)
      || document.querySelector(`input[name="${key}"]`);
    if (input) input.checked = true;
  }
}

for (const key of STYLE_FIELDS) {
  $$(`input[name="${key}"]`).forEach((input) => input.addEventListener('change', async () => {
    if (!input.checked) return;
    settings = await window.vaani.setSettings({ [key]: input.value });
  }));
}

function showStylePanel(name) {
  $$('.style-tab').forEach((tab) => {
    const active = tab.dataset.styleTab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  $$('.style-panel').forEach((panel) => {
    const active = panel.dataset.stylePanel === name;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
}

$$('.style-tab').forEach((tab) => tab.addEventListener('click', () => showStylePanel(tab.dataset.styleTab)));

// ---------------- appearance (transparency + primary color) ----------------

// Applies the theme instantly from current control values; the acrylic window
// material itself is switched by the main process when the setting persists.
function applyAppearance() {
  const transparency = Math.max(0, Math.min(100, Number(readField('windowTransparency')) || 0));
  const t = transparency / 100;
  const root = document.documentElement.style;
  root.setProperty('--bg-alpha', String(1 - t));
  root.setProperty('--surface-alpha', String(Math.min(1, 1 - t + 0.08)));
  $('#transparency-label').textContent = t > 0 ? `${transparency}%` : 'Off';
  $('#set-windowTransparency').style.setProperty('--range-progress', `${transparency}%`);

  let accent = String(readField('accentColor') || '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(accent)) accent = '#e8e9eb';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  root.setProperty('--accent', accent);
  root.setProperty('--accent-text', luma > 150 ? '#101113' : '#ffffff');
  root.setProperty('--accent-hover', `color-mix(in srgb, ${accent} 82%, white)`);
  $$('.color-swatches button').forEach((button) => button.classList.toggle('active', button.dataset.accent.toLowerCase() === accent.toLowerCase()));
}

$('#set-windowTransparency').addEventListener('input', applyAppearance);
$('#set-accentColor').addEventListener('input', applyAppearance);
$('#accent-reset').addEventListener('click', () => {
  writeField('windowTransparency', 0);
  writeField('accentColor', '#e8e9eb');
  applyAppearance();
  scheduleSave('windowTransparency');
  scheduleSave('accentColor');
});

$$('.color-swatches button').forEach((button) => button.addEventListener('click', () => {
  writeField('accentColor', button.dataset.accent);
  applyAppearance();
  scheduleSave('accentColor');
}));

// ---------------- personal dictionary ----------------

let dictionaryEntries = [];
let editingDictionaryId = null;
let pendingDictionaryDeleteId = null;
const dictionaryModel = window.VaaniDictionaryModel;

function syncDictionaryEntries() {
  dictionaryEntries = dictionaryModel.ensureEntries(settings.dictionaryEntries);
}

function dictionaryAction(label, path, onClick, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `dictionary-action ${className}`.trim();
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="${path}"/></svg>`;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function renderDictionary() {
  const list = $('#dict-list');
  const empty = $('#dict-empty');
  const query = $('#dict-search').value.trim().toLocaleLowerCase();
  const sort = $('#dict-sort').value;
  const filtered = dictionaryEntries.filter((entry) => {
    if (!query) return true;
    return `${entry.from} ${entry.to}`.toLocaleLowerCase().includes(query);
  });

  filtered.sort((a, b) => {
    if (sort === 'alpha') return String(a.to || a.from).localeCompare(String(b.to || b.from));
    if (sort === 'recent') return Number(b.createdAt || 0) - Number(a.createdAt || 0);
    return Number(!!b.starred) - Number(!!a.starred)
      || Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });

  const count = dictionaryEntries.length;
  $('#dict-count').textContent = query ? `${filtered.length} of ${count}` : `${count} ${count === 1 ? 'entry' : 'entries'}`;
  list.innerHTML = '';
  empty.hidden = filtered.length > 0;

  if (!filtered.length) {
    const searching = !!query && count > 0;
    $('#dict-empty-title').textContent = searching ? 'No matching entries' : 'Your words will live here';
    $('#dict-empty-copy').textContent = searching
      ? 'Try another spelling or clear the search.'
      : 'Add a name, phrase, or replacement and Vaani will use it on your next dictation.';
    $('#dict-empty-add').textContent = searching ? 'Clear search' : 'Add your first entry';
    return;
  }

  for (const entry of filtered) {
    const row = document.createElement('div');
    row.className = `dictionary-entry${entry.starred ? ' starred' : ''}`;
    row.tabIndex = 0;
    row.addEventListener('dblclick', () => openDictionaryEditor(entry));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') openDictionaryEditor(entry);
    });

    const text = document.createElement('div');
    text.className = 'dictionary-entry-text';
    const phrase = document.createElement('div');
    phrase.className = 'dictionary-entry-phrase';
    if (entry.from === entry.to) {
      phrase.textContent = entry.to;
    } else {
      const from = document.createElement('span');
      from.textContent = entry.from;
      const arrow = document.createElement('span');
      arrow.className = 'dictionary-entry-arrow';
      arrow.textContent = '→';
      const to = document.createElement('strong');
      to.textContent = entry.to || '(remove)';
      phrase.append(from, arrow, to);
    }
    const meta = document.createElement('div');
    meta.className = 'dictionary-entry-meta';
    const kind = entry.from === entry.to ? 'Exact spelling' : 'Replacement';
    const source = entry.source === 'learned' ? 'learned automatically' : entry.source === 'imported' ? 'imported' : 'personal';
    meta.textContent = `${kind} · ${source}`;
    text.append(phrase, meta);

    const actions = document.createElement('div');
    actions.className = 'dictionary-actions';
    actions.append(
      dictionaryAction('Edit entry', 'M3 17.3V21h3.7L17.8 9.9l-3.7-3.7L3 17.3zm17.7-10.2a1 1 0 0 0 0-1.4l-2.4-2.4a1 1 0 0 0-1.4 0L15 5.2l3.7 3.7 2-1.8z', () => openDictionaryEditor(entry)),
      dictionaryAction('Delete entry', 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zm3.5-9h1.5v7H9.5v-7zm3.5 0h1.5v7H13v-7zM15.5 4l-1-1h-5l-1 1H5v2h14V4h-3.5z', () => openDictionaryDelete(entry), 'delete'),
      dictionaryAction(entry.starred ? 'Remove priority' : 'Prioritize entry', 'm12 17.3-6.2 3.3 1.2-7L2 8.7l7-1L12 1.3l3.1 6.4 7 .9-5.1 5 1.2 7-6.2-3.3z', () => toggleDictionaryStar(entry.id), entry.starred ? 'star active' : 'star')
    );
    row.append(text, actions);
    list.appendChild(row);
  }
}

function showDictionaryError(message) {
  const error = $('#dict-editor-error');
  error.textContent = message;
  error.hidden = !message;
}

function openDictionaryEditor(entry = null, seed = null) {
  editingDictionaryId = entry?.id ?? null;
  $('#dict-editor-title').textContent = entry ? 'Edit entry' : 'Add an entry';
  const from = entry ? (entry.from === entry.to ? '' : entry.from) : (seed?.from || '');
  const to = entry ? entry.to : (seed?.to || '');
  $('#dict-from').value = from;
  $('#dict-to').value = to;
  $('#dict-starred').checked = !!entry?.starred;
  showDictionaryError('');
  $('#dict-editor-backdrop').hidden = false;
  requestAnimationFrame(() => (to ? $('#dict-from') : $('#dict-to')).focus());
}

function closeDictionaryEditor() {
  editingDictionaryId = null;
  $('#dict-editor-backdrop').hidden = true;
  showDictionaryError('');
}

async function saveDictionaryEntries(nextEntries, message) {
  settings = await window.vaani.setSettings({ dictionaryEntries: nextEntries });
  syncDictionaryEntries();
  renderDictionary();
  if (message) toast(message);
}

async function toggleDictionaryStar(id) {
  if (!id) return;
  const next = dictionaryModel.toggleStar(dictionaryEntries, id);
  const starred = next.find((entry) => entry.id === id)?.starred;
  await saveDictionaryEntries(next, starred ? 'Entry prioritized' : 'Priority removed');
}

function openDictionaryDelete(entry) {
  pendingDictionaryDeleteId = entry.id || null;
  const label = entry.from === entry.to ? entry.to : `${entry.from} → ${entry.to}`;
  $('#dict-delete-copy').textContent = `“${label}” will be removed permanently.`;
  $('#dict-delete-backdrop').hidden = false;
  requestAnimationFrame(() => $('#dict-delete-confirm').focus());
}

function closeDictionaryDelete() {
  pendingDictionaryDeleteId = null;
  $('#dict-delete-backdrop').hidden = true;
}

$('#dict-editor').addEventListener('submit', async (event) => {
  event.preventDefault();
  const to = $('#dict-to').value.replace(/\s+/g, ' ').trim();
  const from = $('#dict-from').value.replace(/\s+/g, ' ').trim() || to;
  if (!to) return showDictionaryError('Enter how Vaani should write this term.');
  const duplicate = dictionaryModel.findDuplicate(dictionaryEntries, from, editingDictionaryId);
  if (duplicate) return showDictionaryError(`“${from}” is already in your dictionary.`);

  const existing = dictionaryEntries.find((entry) => entry.id === editingDictionaryId);
  const value = {
    ...(existing || {}),
    from,
    to,
    starred: $('#dict-starred').checked,
    source: existing?.source || 'manual',
    createdAt: existing?.createdAt || Date.now()
  };
  const next = existing
    ? dictionaryModel.updateEntry(dictionaryEntries, existing.id, value)
    : [...dictionaryEntries, value];
  await saveDictionaryEntries(next, existing ? 'Dictionary entry updated' : 'Added to your dictionary');
  closeDictionaryEditor();
});

$('#dict-add-btn').addEventListener('click', () => openDictionaryEditor());
$('#dict-empty-add').addEventListener('click', () => {
  if ($('#dict-search').value) {
    $('#dict-search').value = '';
    renderDictionary();
  } else openDictionaryEditor();
});
$('#dict-search').addEventListener('input', renderDictionary);
$('#dict-sort').addEventListener('change', renderDictionary);
$('#dict-editor-close').addEventListener('click', closeDictionaryEditor);
$('#dict-editor-cancel').addEventListener('click', closeDictionaryEditor);
$('#dict-delete-close').addEventListener('click', closeDictionaryDelete);
$('#dict-delete-cancel').addEventListener('click', closeDictionaryDelete);
$('#dict-delete-confirm').addEventListener('click', async () => {
  if (pendingDictionaryDeleteId === null) return;
  const next = dictionaryModel.removeEntry(dictionaryEntries, pendingDictionaryDeleteId);
  await saveDictionaryEntries(next, 'Dictionary entry deleted');
  closeDictionaryDelete();
});

$$('.dict-example').forEach((button) => button.addEventListener('click', () => {
  openDictionaryEditor(null, { from: button.dataset.from, to: button.dataset.to });
}));

for (const backdrop of [$('#dict-editor-backdrop'), $('#dict-delete-backdrop')]) {
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target !== backdrop) return;
    if (backdrop === $('#dict-editor-backdrop')) closeDictionaryEditor();
    else closeDictionaryDelete();
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!$('#dict-delete-backdrop').hidden) closeDictionaryDelete();
  else if (!$('#dict-editor-backdrop').hidden) closeDictionaryEditor();
});

// The main process emits this when automatic learning imports a new entry.
window.vaani.onSettingsChanged(async () => {
  const result = await window.vaani.getSettings();
  settings = result.settings;
  hotkeyLabels = result.hotkeyLabels || hotkeyLabels;
  ensureHotkeyOption(settings.hotkey);
  for (const key of Object.keys(FIELDS)) writeField(key, settings[key]);
  document.documentElement.lang = settings.appLanguage || 'en';
  applyAppearance();
  syncHomeShortcut();
  syncProfileSummary();
  syncDictionaryEntries();
  syncSnippets();
  renderDictionary();
  renderSnippets();
});

// ---------------- snippets ----------------

let snippets = [];
let editingSnippetId = null;
let pendingSnippetDeleteId = null;
const SNIPPET_MODEL = window.VaaniSnippetModel;

function syncSnippets() {
  snippets = SNIPPET_MODEL.ensureEntries(settings.snippets);
  settings.snippets = snippets;
}

function snippetAction(label, path, onClick, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `snippet-action ${className}`.trim();
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="${path}"/></svg>`;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function snippetPreview(value, limit = 360) {
  const text = String(value || '');
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

function renderSnippets() {
  const list = $('#snippet-list');
  const empty = $('#snippet-empty');
  const query = $('#snippet-search').value.trim().toLocaleLowerCase();
  const sort = $('#snippet-sort').value;
  const filtered = snippets.filter((snippet) => {
    if (!query) return true;
    return `${snippet.trigger} ${snippet.text}`.toLocaleLowerCase().includes(query);
  });
  filtered.sort((a, b) => sort === 'alpha'
    ? a.trigger.localeCompare(b.trigger)
    : Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));

  const count = snippets.length;
  $('#snippet-count').textContent = query
    ? `${filtered.length} of ${count}`
    : `${count} ${count === 1 ? 'snippet' : 'snippets'}`;
  list.innerHTML = '';
  empty.hidden = filtered.length > 0;

  if (!filtered.length) {
    const searching = !!query && count > 0;
    $('#snippet-empty-title').textContent = searching ? 'No matching snippets' : 'Your shortcuts will live here';
    $('#snippet-empty-copy').textContent = searching
      ? 'Try another phrase or clear the search.'
      : 'Add a phrase you say often and the exact text it should become.';
    $('#snippet-empty-add').textContent = searching ? 'Clear search' : 'Add your first snippet';
    return;
  }

  filtered.forEach((snippet, index) => {
    const row = document.createElement('div');
    row.className = 'snippet-entry';
    row.style.setProperty('--snippet-delay', `${Math.min(index, 8) * 24}ms`);
    row.tabIndex = 0;
    row.addEventListener('dblclick', () => openSnippetEditor(snippet));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') openSnippetEditor(snippet);
    });

    const trigger = document.createElement('div');
    trigger.className = 'snippet-trigger-block';
    const triggerLabel = document.createElement('span');
    triggerLabel.textContent = 'When I say';
    const triggerValue = document.createElement('strong');
    triggerValue.textContent = `“${snippet.trigger}”`;
    trigger.append(triggerLabel, triggerValue);

    const arrow = document.createElement('div');
    arrow.className = 'snippet-entry-arrow';
    arrow.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="m13.2 5.8-1.4 1.4 3.8 3.8H5v2h10.6l-3.8 3.8 1.4 1.4L19.4 12z"/></svg>';

    const expansion = document.createElement('div');
    expansion.className = 'snippet-expansion-block';
    const expansionLabel = document.createElement('div');
    expansionLabel.className = 'snippet-expansion-label';
    const label = document.createElement('span');
    label.textContent = 'Insert';
    const badge = document.createElement('small');
    badge.textContent = snippet.starter ? 'Starter' : 'Personal';
    expansionLabel.append(label, badge);
    const value = document.createElement('div');
    value.className = 'snippet-expansion-text';
    value.textContent = snippetPreview(snippet.text);
    expansion.append(expansionLabel, value);

    const actions = document.createElement('div');
    actions.className = 'snippet-actions';
    actions.append(
      snippetAction('Edit snippet', 'M3 17.3V21h3.7L17.8 9.9l-3.7-3.7L3 17.3zm17.7-10.2a1 1 0 0 0 0-1.4l-2.4-2.4a1 1 0 0 0-1.4 0L15 5.2l3.7 3.7 2-1.8z', () => openSnippetEditor(snippet)),
      snippetAction('Delete snippet', 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zm3.5-9h1.5v7H9.5v-7zm3.5 0h1.5v7H13v-7zM15.5 4l-1-1h-5l-1 1H5v2h14V4h-3.5z', () => openSnippetDelete(snippet), 'delete')
    );
    row.append(trigger, arrow, expansion, actions);
    list.appendChild(row);
  });
}

function showSnippetError(message) {
  const error = $('#snippet-editor-error');
  error.textContent = message;
  error.hidden = !message;
}

function updateSnippetEditorHints() {
  const trigger = $('#snippet-trigger').value.replace(/\s+/g, ' ').trim();
  $('#snippet-spoken-preview').textContent = trigger
    ? `Say “${trigger}” by itself, or use it naturally inside a sentence.`
    : 'Try a short phrase you would not say accidentally.';
  $('#snippet-char-count').textContent = `${$('#snippet-text').value.length.toLocaleString()} / 12,000`;
}

function openSnippetEditor(snippet = null, seed = null) {
  editingSnippetId = snippet?.id || null;
  $('#snippet-editor-title').textContent = snippet ? 'Edit snippet' : 'Add snippet';
  $('#snippet-editor-save').textContent = snippet ? 'Save changes' : 'Add snippet';
  $('#snippet-trigger').value = snippet?.trigger || seed?.trigger || '';
  $('#snippet-text').value = snippet?.text || seed?.text || '';
  showSnippetError('');
  updateSnippetEditorHints();
  $('#snippet-editor-backdrop').hidden = false;
  requestAnimationFrame(() => $('#snippet-trigger').focus());
}

function closeSnippetEditor() {
  editingSnippetId = null;
  $('#snippet-editor-backdrop').hidden = true;
  showSnippetError('');
}

async function saveSnippets(next, message) {
  settings = await window.vaani.setSettings({ snippets: next });
  syncSnippets();
  renderSnippets();
  if (message) toast(message);
}

function openSnippetDelete(snippet) {
  pendingSnippetDeleteId = snippet.id;
  const expansion = snippetPreview(snippet.text.replace(/\s+/g, ' '), 120);
  $('#snippet-delete-copy').textContent = `“${snippet.trigger}” → “${expansion}” will be deleted permanently.`;
  $('#snippet-delete-backdrop').hidden = false;
  requestAnimationFrame(() => $('#snippet-delete-confirm').focus());
}

function closeSnippetDelete() {
  pendingSnippetDeleteId = null;
  $('#snippet-delete-backdrop').hidden = true;
}

$('#snippet-editor').addEventListener('submit', async (event) => {
  event.preventDefault();
  const trigger = $('#snippet-trigger').value
    .replace(/^[\s“”"']+|[\s“”"']+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const text = $('#snippet-text').value.trim();
  if (!trigger) return showSnippetError('Enter the phrase you want to say.');
  if (!text) return showSnippetError('Enter the text Vaani should insert.');
  const duplicate = snippets.find((snippet) => snippet.id !== editingSnippetId
    && snippet.trigger.toLocaleLowerCase() === trigger.toLocaleLowerCase());
  if (duplicate) return showSnippetError(`“${trigger}” is already used by another snippet.`);

  const existing = snippets.find((snippet) => snippet.id === editingSnippetId);
  const value = {
    ...(existing || {}),
    id: existing?.id || SNIPPET_MODEL.createId(),
    trigger,
    text,
    starter: false,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  const next = existing
    ? SNIPPET_MODEL.updateEntry(snippets, existing.id, value)
    : [...snippets, value];
  await saveSnippets(next, existing ? 'Snippet updated' : 'Snippet added');
  closeSnippetEditor();
});

$('#snippet-add-btn').addEventListener('click', () => openSnippetEditor());
$('#snippet-empty-add').addEventListener('click', () => {
  if ($('#snippet-search').value) {
    $('#snippet-search').value = '';
    renderSnippets();
  } else openSnippetEditor();
});
$('#snippet-search').addEventListener('input', renderSnippets);
$('#snippet-sort').addEventListener('change', renderSnippets);
$('#snippet-trigger').addEventListener('input', updateSnippetEditorHints);
$('#snippet-text').addEventListener('input', updateSnippetEditorHints);
$('#snippet-editor-close').addEventListener('click', closeSnippetEditor);
$('#snippet-editor-cancel').addEventListener('click', closeSnippetEditor);
$('#snippet-delete-close').addEventListener('click', closeSnippetDelete);
$('#snippet-delete-cancel').addEventListener('click', closeSnippetDelete);
$('#snippet-delete-confirm').addEventListener('click', async () => {
  if (!pendingSnippetDeleteId) return;
  await saveSnippets(SNIPPET_MODEL.removeEntry(snippets, pendingSnippetDeleteId), 'Snippet deleted');
  closeSnippetDelete();
});

$$('.snippet-example').forEach((button) => button.addEventListener('click', () => {
  openSnippetEditor(null, {
    trigger: button.dataset.trigger,
    text: button.dataset.text.replace(/\\n/g, '\n')
  });
}));

for (const backdrop of [$('#snippet-editor-backdrop'), $('#snippet-delete-backdrop')]) {
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target !== backdrop) return;
    if (backdrop === $('#snippet-editor-backdrop')) closeSnippetEditor();
    else closeSnippetDelete();
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!$('#snippet-delete-backdrop').hidden) closeSnippetDelete();
  else if (!$('#snippet-editor-backdrop').hidden) closeSnippetEditor();
});

// ---------------- provider config + connection test ----------------

async function refreshConfigInfo() {
  configInfo = await window.vaani.getConfigInfo();
  const status = $('#config-status');
  const detail = $('#provider-status-detail');
  const dot = $('#provider-status-dot');
  dot.className = '';
  if (!configInfo.ok) {
    status.textContent = configInfo.message || 'Could not read config.json';
    detail.textContent = 'Check the local file';
    dot.className = 'fail';
  } else if (!configInfo.configured) {
    status.textContent = 'Setup required';
    detail.textContent = `Missing ${configInfo.missing.join(', ')}`;
    dot.className = 'fail';
  } else {
    status.textContent = configInfo.providerMode === 'override' ? 'Override ready' : 'Built-in provider ready';
    detail.textContent = configInfo.providerMode === 'override'
      ? (configInfo.llmDeployment
        ? `${configInfo.whisperDeployment} · ${configInfo.llmDeployment}`
        : `${configInfo.whisperDeployment} · transcription only`)
      : 'Managed Azure OpenAI';
    dot.className = 'ok';
  }
  return configInfo;
}

async function loadProviderConfig() {
  const result = await window.vaani.getConfig();
  if (!result?.ok) {
    $('#test-result').textContent = result?.message || 'Could not load provider settings';
    $('#test-result').className = 'fail';
    return null;
  }
  const config = result.config || {};
  const mode = config.providerMode === 'override' ? 'override' : 'builtin';
  $(`#provider-mode-${mode}`).checked = true;
  $('#provider-base-url').value = config.baseUrl || '';
  $('#provider-api-key').value = '';
  $('#provider-api-key').placeholder = config.overrideConfigured
    ? 'Saved securely — enter only to replace'
    : 'Enter your API key';
  $('#provider-whisper').value = config.whisperDeployment || '';
  $('#provider-llm').value = config.llmDeployment || '';
  syncProviderMode(config.overrideConfigured);
  return config;
}

function selectedProviderMode() {
  return $('input[name="provider-mode"]:checked')?.value === 'override' ? 'override' : 'builtin';
}

function syncProviderMode(overrideConfigured = !!configInfo?.overrideConfigured) {
  const override = selectedProviderMode() === 'override';
  $('#provider-override-fields').hidden = !override;
  $('#provider-builtin-copy').hidden = override;
  for (const input of $('#provider-override-fields').querySelectorAll('input')) input.disabled = !override;
  $('#provider-base-url').required = override;
  $('#provider-whisper').required = override;
  $('#provider-api-key').required = override && !overrideConfigured;
}

window.vaani.onConfigChanged(async () => {
  await loadProviderConfig();
  await refreshConfigInfo();
  $('#provider-api-key').value = '';
  $('#provider-api-key').placeholder = result.config?.overrideConfigured
    ? 'Saved securely — enter only to replace'
    : 'Enter your API key';
  $('#test-result').textContent = 'Reloaded changes from the local config file.';
  $('#test-result').className = 'ok';
});

async function saveProviderConfig({ announce = true } = {}) {
  syncProviderMode();
  const form = $('#provider-form');
  if (!form.reportValidity()) return null;
  const result = await window.vaani.setConfig({
    providerMode: selectedProviderMode(),
    baseUrl: $('#provider-base-url').value.trim(),
    apiKey: $('#provider-api-key').value.trim(),
    whisperDeployment: $('#provider-whisper').value.trim(),
    llmDeployment: $('#provider-llm').value.trim()
  });
  if (!result?.ok) {
    $('#test-result').textContent = result?.message || 'Could not save provider';
    $('#test-result').className = 'fail';
    return null;
  }
  await refreshConfigInfo();
  if (announce) {
    $('#test-result').textContent = selectedProviderMode() === 'override'
      ? 'Override encrypted and saved by the Vaani server.'
      : 'Built-in provider selected.';
    $('#test-result').className = 'ok';
  }
  return result.config;
}

$('#provider-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveProviderConfig();
});

for (const input of $$('input[name="provider-mode"]')) {
  input.addEventListener('change', () => syncProviderMode());
}

$('#provider-key-toggle').addEventListener('click', () => {
  const input = $('#provider-api-key');
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  $('#provider-key-toggle').textContent = visible ? 'Show' : 'Hide';
});

$('#btn-open-config').addEventListener('click', async () => {
  const result = await window.vaani.openConfig();
  if (!result.ok) toast(result.message || 'Could not open config.json');
});

$('#btn-test').addEventListener('click', async () => {
  const btn = $('#btn-test');
  const out = $('#test-result');
  btn.disabled = true;
  out.className = '';
  out.textContent = 'Testing…';
  const saved = await saveProviderConfig({ announce: false });
  if (saved) {
    const result = await window.vaani.testConnection();
    out.textContent = result.message;
    out.className = result.ok ? 'ok' : 'fail';
  }
  btn.disabled = false;
});

// ---------------- local profile ----------------

let pendingProfilePicture = '';

function profileInitials(firstName = '', lastName = '') {
  const initials = `${String(firstName).trim().charAt(0)}${String(lastName).trim().charAt(0)}`.toUpperCase();
  return initials || 'V';
}

function renderProfileAvatar(element, picture, initials) {
  element.innerHTML = '';
  if (picture) {
    const image = document.createElement('img');
    image.src = picture;
    image.alt = '';
    element.appendChild(image);
  } else {
    const text = document.createElement('span');
    text.textContent = initials;
    element.appendChild(text);
  }
}

function syncProfileSummary() {
  const first = String(settings.profileFirstName || '').trim();
  const last = String(settings.profileLastName || '').trim();
  const name = [first, last].filter(Boolean).join(' ') || 'Your profile';
  const initials = profileInitials(first, last);
  const picture = settings.profilePicture || '';
  $('#sidebar-profile-name').textContent = name;
  $('#settings-profile-name').textContent = name;
  $('#settings-profile-email').textContent = settings.profileEmail || 'Add your details';
  renderProfileAvatar($('#sidebar-profile-avatar'), picture, initials);
  renderProfileAvatar($('#settings-profile-avatar'), picture, initials);
  renderProfileAvatar($('#account-avatar'), pendingProfilePicture || picture, initials);
  $('#greeting').textContent = first ? `Welcome back, ${first}` : 'Welcome back';
}

function populateAccountForm() {
  $('#account-first-name').value = settings.profileFirstName || '';
  $('#account-last-name').value = settings.profileLastName || '';
  $('#account-email').value = settings.profileEmail || '';
  pendingProfilePicture = settings.profilePicture || '';
  syncProfileSummary();
}

function readProfilePicture(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('That image format is not supported.'));
      image.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
        const sx = (image.naturalWidth - sourceSize) / 2;
        const sy = (image.naturalHeight - sourceSize) / 2;
        context.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

$('#account-photo-change').addEventListener('click', () => $('#account-photo-input').click());
$('#account-photo-input').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    toast('Choose an image smaller than 5 MB.');
    return;
  }
  try {
    pendingProfilePicture = await readProfilePicture(file);
    renderProfileAvatar($('#account-avatar'), pendingProfilePicture, profileInitials($('#account-first-name').value, $('#account-last-name').value));
  } catch (error) {
    toast(error.message);
  } finally {
    event.target.value = '';
  }
});

$('#account-photo-remove').addEventListener('click', () => {
  pendingProfilePicture = '';
  renderProfileAvatar($('#account-avatar'), '', profileInitials($('#account-first-name').value, $('#account-last-name').value));
});

for (const selector of ['#account-first-name', '#account-last-name']) {
  $(selector).addEventListener('input', () => {
    renderProfileAvatar(
      $('#account-avatar'),
      pendingProfilePicture,
      profileInitials($('#account-first-name').value, $('#account-last-name').value)
    );
  });
}

$('#account-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  settings = await window.vaani.setSettings({
    profileFirstName: $('#account-first-name').value.trim(),
    profileLastName: $('#account-last-name').value.trim(),
    profileEmail: $('#account-email').value.trim(),
    profilePicture: pendingProfilePicture
  });
  syncProfileSummary();
  $('#account-save-status').textContent = 'Profile saved on this device.';
  $('#account-save-status').className = 'ok';
});

// ---------------- updates ----------------

function showUpdateBanner(version) {
  $('#update-text').textContent = `Vaani ${version} is ready and will restart when idle`;
  $('#update-banner').hidden = false;
}

window.vaani.onUpdateReady(showUpdateBanner);
window.vaani.onMilestoneReached((milestone) => {
  toast(milestone?.message || 'You reached a new dictation milestone.');
});
$('#update-install').addEventListener('click', async () => {
  const result = await window.vaani.installUpdate();
  if (!result?.ok) {
    // nothing actually pending (stale banner) — say so instead of doing nothing
    $('#update-banner').hidden = true;
    toast('No update is pending — you are on the latest version.');
  }
});

// ---------------- microphones ----------------

async function populateMics({ requestPermission = true } = {}) {
  const select = $('#set-mic');
  const refresh = $('#mic-refresh');
  const status = $('#mic-status');
  refresh.classList.add('mic-refreshing');
  try {
    let stream = null;
    if (requestPermission) stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    stream?.getTracks().forEach((track) => track.stop());
    const mics = devices.filter((device) => device.kind === 'audioinput');
    select.innerHTML = '';
    const seen = new Set();
    mics.forEach((mic, index) => {
      if (seen.has(mic.deviceId)) return;
      seen.add(mic.deviceId);
      const opt = document.createElement('option');
      opt.value = mic.deviceId;
      if (mic.deviceId === 'default') opt.textContent = 'System default';
      else if (mic.deviceId === 'communications') opt.textContent = 'Communications default';
      else opt.textContent = mic.label || `Microphone ${index + 1}`;
      select.appendChild(opt);
    });
    if (!select.options.length) {
      const option = document.createElement('option');
      option.value = 'default';
      option.textContent = 'System default';
      select.appendChild(option);
    }
    status.textContent = `${mics.length || 1} microphone option${mics.length === 1 ? '' : 's'} available.`;
  } catch (error) {
    select.innerHTML = '<option value="default">System default</option>';
    status.textContent = error?.name === 'NotAllowedError'
      ? 'Microphone permission is required to list every device.'
      : 'Could not refresh microphones; the system default remains available.';
  } finally {
    refresh.classList.remove('mic-refreshing');
  }
  if (settings.micDeviceId && [...select.options].some((option) => option.value === settings.micDeviceId)) {
    select.value = settings.micDeviceId;
  } else if (settings.micDeviceId && settings.micDeviceId !== 'default') {
    const unavailable = document.createElement('option');
    unavailable.value = settings.micDeviceId;
    unavailable.textContent = 'Previously selected microphone (unavailable)';
    select.appendChild(unavailable);
    select.value = settings.micDeviceId;
  }
}

$('#mic-refresh').addEventListener('click', () => populateMics({ requestPermission: true }));
if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => populateMics({ requestPermission: false }));
}

// ---------------- init ----------------

(async function init() {
  const result = await window.vaani.getSettings();
  const { settings: s, uiohookAvailable, capabilities = {}, systemStatus = {}, environment = {} } = result;
  hotkeyLabels = result.hotkeyLabels || {};
  settings = s;
  history = await window.vaani.getHistory();

  const hotkeySelect = $('#set-hotkey');
  for (const [id, label] of Object.entries(hotkeyLabels)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    hotkeySelect.appendChild(opt);
  }
  ensureHotkeyOption(settings.hotkey);

  for (const key of Object.keys(FIELDS)) writeField(key, settings[key]);
  if (typeof systemStatus.launchAtLogin === 'boolean') writeField('launchAtLogin', systemStatus.launchAtLogin);
  if (!capabilities.audioMuting) {
    $('#set-muteMusicWhileDictating').disabled = true;
    $('#set-muteMusicWhileDictating').closest('.setting-row').querySelector('small').textContent = 'System audio muting is available on Windows.';
  }
  if (!capabilities.notifications) {
    $('#set-milestoneNotifications').disabled = true;
    $('#set-milestoneNotifications').closest('.setting-row').querySelector('small').textContent = 'Desktop notifications are unavailable on this system.';
  }
  document.documentElement.lang = settings.appLanguage || 'en';
  syncStyleControls();
  applyAppearance();
  await refreshConfigInfo();
  await loadProviderConfig();
  populateAccountForm();

  syncDictionaryEntries();
  syncSnippets();
  renderDictionary();
  renderSnippets();

  $('#hotkey-fallback').hidden = uiohookAvailable;
  $('#home-hint').textContent = configInfo?.configured
    ? 'Your voice is ready wherever you type.'
    : 'Add your provider details before starting your first dictation.';
  syncHomeShortcut();
  const currentSession = await window.vaani.getSessionState();
  if (currentSession?.state === 'recording') updateHomeSession({ type: 'start', mode: currentSession.mode });
  else if (currentSession?.state === 'processing') updateHomeSession({ type: 'processing' });
  else updateHomeSession({ type: 'idle' });

  renderAll();
  populateMics();

  // update may have finished downloading before this window opened
  window.vaani.getUpdateState().then((u) => { if (u.ready) showUpdateBanner(u.version); });

  const forceWelcome = FORCE_WELCOME_IN_DEVELOPMENT && environment.isPackaged === false;
  const needsWelcome = !settings.onboardingCompleted && !configInfo?.configured;
  if (forceWelcome || needsWelcome) showWelcomeScreen();
  else routeFromLocation();
})();
