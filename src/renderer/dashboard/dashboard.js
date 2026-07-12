'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let settings = {};
let history = [];
let saveTimer = null;
let configInfo = null;

// ---------------- navigation ----------------

function showView(name) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  $(`#view-${name}`).classList.add('active');
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
}

$$('.nav-item').forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.view)));

$('#btn-dictate').addEventListener('click', () => window.vaani.toggleDictation());

// ---------------- toast ----------------

let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

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
const WISPR_FLOW_USD_PER_MONTH = 12; // Wispr Flow Pro, annual billing

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
  $('#stat-words').textContent = totalWords.toLocaleString();
  $('#stat-count').textContent = history.length.toLocaleString();
  $('#stat-wpm').textContent = totalMs > 3000 ? Math.round(totalWords / (totalMs / 60000)) : '–';

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
  $('#stat-cost').textContent = `$${monthsActive * WISPR_FLOW_USD_PER_MONTH}`;
  $('#stat-cost-sub').textContent = monthsActive
    ? `$${WISPR_FLOW_USD_PER_MONTH}/mo × ${monthsActive} month${monthsActive === 1 ? '' : 's'} of dictating`
    : `$${WISPR_FLOW_USD_PER_MONTH}/mo subscription you didn't pay`;

  // streak: consecutive days (ending today or yesterday) with ≥1 dictation
  const days = new Set(history.map((e) => new Date(e.ts).toDateString()));
  let streak = 0;
  const cursor = new Date();
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1); // grace: today not yet used
  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  $('#stat-streak').textContent = streak;

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
    const name = document.createElement('div');
    name.textContent = app;
    const bar = document.createElement('div');
    bar.className = 'app-bar';
    bar.style.width = `${Math.max(6, Math.round((words / max) * 100))}%`;
    left.append(name, bar);
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
  micDeviceId: { el: '#set-mic', type: 'select' },
  hotkey: { el: '#set-hotkey', type: 'select' },
  autoLearnVocabulary: { el: '#set-autoLearnVocabulary', type: 'bool' },
  polishTimeoutSec: { el: '#set-polishTimeoutSec', type: 'select' },
  defaultTone: { el: '#set-defaultTone', type: 'select' },
  autoTone: { el: '#set-autoTone', type: 'bool' },
  styleInstructions: { el: '#set-styleInstructions', type: 'text' },
  polishEnabled: { el: '#set-polishEnabled', type: 'bool' },
  fastMode: { el: '#set-fastMode', type: 'bool' },
  spokenCommands: { el: '#set-spokenCommands', type: 'bool' },
  autoStopSec: { el: '#set-autoStopSec', type: 'select' },
  windowTransparency: { el: '#set-windowTransparency', type: 'text' },
  accentColor: { el: '#set-accentColor', type: 'text' },
  autoPaste: { el: '#set-autoPaste', type: 'bool' },
  restoreClipboard: { el: '#set-restoreClipboard', type: 'bool' },
  compensateSpace: { el: '#set-compensateSpace', type: 'bool' },
  sounds: { el: '#set-sounds', type: 'bool' },
  launchAtLogin: { el: '#set-launchAtLogin', type: 'bool' }
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

function readSettingsPatch() {
  const patch = {};
  for (const k of Object.keys(FIELDS)) patch[k] = readField(k);
  patch.polishTimeoutSec = Number(patch.polishTimeoutSec) || 8;
  patch.autoStopSec = Number(patch.autoStopSec) || 0;
  patch.windowTransparency = Number(patch.windowTransparency) || 0;
  return patch;
}

function scheduleSave(key) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    settings = await window.vaani.setSettings(readSettingsPatch());
  }, ['styleInstructions', 'windowTransparency', 'accentColor'].includes(key) ? 500 : 0);
}

for (const key of Object.keys(FIELDS)) {
  const node = $(FIELDS[key].el);
  node.addEventListener(FIELDS[key].type === 'text' ? 'input' : 'change', () => scheduleSave(key));
}

// ---------------- appearance (transparency + primary color) ----------------

// Applies the theme instantly from current control values; the acrylic window
// material itself is switched by the main process when the setting persists.
function applyAppearance() {
  const t = Math.max(0, Math.min(70, Number(readField('windowTransparency')) || 0)) / 100;
  const root = document.documentElement.style;
  root.setProperty('--bg-alpha', String(1 - t));
  root.setProperty('--surface-alpha', String(Math.min(1, 1 - t + 0.08)));
  $('#transparency-label').textContent = t > 0 ? `${Math.round(t * 100)}%` : 'off';

  let accent = String(readField('accentColor') || '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(accent)) accent = '#e8e9eb';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  root.setProperty('--accent', accent);
  root.setProperty('--accent-text', luma > 150 ? '#101113' : '#ffffff');
  root.setProperty('--accent-hover', `color-mix(in srgb, ${accent} 82%, white)`);
}

$('#set-windowTransparency').addEventListener('input', applyAppearance);
$('#set-accentColor').addEventListener('input', applyAppearance);
$('#accent-reset').addEventListener('click', () => {
  writeField('accentColor', '#e8e9eb');
  applyAppearance();
  scheduleSave('accentColor');
});

// ---------------- personal dictionary ----------------

let dictionaryEntries = [];
let editingDictionaryId = null;
let pendingDictionaryDeleteId = null;

function syncDictionaryEntries() {
  dictionaryEntries = (Array.isArray(settings.dictionaryEntries) ? settings.dictionaryEntries : [])
    .filter((entry) => entry && entry.from)
    .map((entry) => ({ ...entry, to: String(entry.to ?? entry.from) }));
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
      : 'Add a name, phrase, or replacement and VaaniFlow will use it on your next dictation.';
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
  editingDictionaryId = entry?.id || null;
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
  const next = dictionaryEntries.map((entry) => entry.id === id
    ? { ...entry, starred: !entry.starred }
    : entry);
  const starred = next.find((entry) => entry.id === id)?.starred;
  await saveDictionaryEntries(next, starred ? 'Entry prioritized' : 'Priority removed');
}

function openDictionaryDelete(entry) {
  pendingDictionaryDeleteId = entry.id;
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
  if (!to) return showDictionaryError('Enter how VaaniFlow should write this term.');
  const duplicate = dictionaryEntries.find((entry) => entry.id !== editingDictionaryId
    && entry.from.toLocaleLowerCase() === from.toLocaleLowerCase());
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
    ? dictionaryEntries.map((entry) => entry.id === existing.id ? value : entry)
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
  if (!pendingDictionaryDeleteId) return;
  const next = dictionaryEntries.filter((entry) => entry.id !== pendingDictionaryDeleteId);
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
  const { settings: fresh } = await window.vaani.getSettings();
  settings = fresh;
  writeField('autoLearnVocabulary', settings.autoLearnVocabulary);
  syncDictionaryEntries();
  renderDictionary();
});

// ---------------- list editors (tone profiles / snippets) ----------------

let appProfiles = [];
let snippets = [];

function deleteButton(onClick) {
  const del = document.createElement('button');
  del.className = 'icon-btn delete';
  del.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>';
  del.addEventListener('click', onClick);
  return del;
}

function renderAppProfiles() {
  const list = $('#profile-list');
  list.innerHTML = '';
  appProfiles.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'repl-row';
    const match = document.createElement('span');
    match.className = 'repl-text';
    match.textContent = p.match;
    const arrow = document.createElement('span');
    arrow.className = 'repl-arrow';
    arrow.textContent = '→';
    const tone = document.createElement('span');
    tone.className = 'repl-text';
    tone.textContent = p.tone;
    row.append(match, arrow, tone, deleteButton(async () => {
      appProfiles.splice(i, 1);
      settings = await window.vaani.setSettings({ appProfiles });
      renderAppProfiles();
    }));
    list.appendChild(row);
  });
}

$('#profile-add-btn').addEventListener('click', async () => {
  const matchEl = $('#profile-match');
  const match = matchEl.value.trim();
  if (!match) return;
  appProfiles.push({ match, tone: $('#profile-tone').value });
  settings = await window.vaani.setSettings({ appProfiles });
  matchEl.value = '';
  renderAppProfiles();
});

function renderSnippets() {
  const list = $('#snippet-list');
  list.innerHTML = '';
  snippets.forEach((sn, i) => {
    const row = document.createElement('div');
    row.className = 'repl-row';
    const body = document.createElement('div');
    body.className = 'repl-text';
    const trigger = document.createElement('div');
    trigger.textContent = `“${sn.trigger}”`;
    const preview = document.createElement('div');
    preview.className = 'snippet-body';
    preview.textContent = sn.text.length > 160 ? sn.text.slice(0, 160) + '…' : sn.text;
    body.append(trigger, preview);
    row.append(body, deleteButton(async () => {
      snippets.splice(i, 1);
      settings = await window.vaani.setSettings({ snippets });
      renderSnippets();
    }));
    list.appendChild(row);
  });
}

$('#snippet-add-btn').addEventListener('click', async () => {
  const trigEl = $('#snippet-trigger');
  const textEl = $('#snippet-text');
  const trigger = trigEl.value.trim();
  const text = textEl.value;
  if (!trigger || !text.trim()) return;
  snippets.push({ trigger, text });
  settings = await window.vaani.setSettings({ snippets });
  trigEl.value = '';
  textEl.value = '';
  renderSnippets();
});

// ---------------- Azure config + connection test ----------------

async function refreshConfigInfo() {
  configInfo = await window.vaani.getConfigInfo();
  $('#config-path').textContent = configInfo.path || 'config.json';
  const status = $('#config-status');
  if (!configInfo.ok) {
    status.textContent = configInfo.message || 'Could not read config.json';
    status.className = 'fail';
  } else if (!configInfo.configured) {
    status.textContent = `Missing configuration: ${configInfo.missing.join(', ')}`;
    status.className = 'fail';
  } else {
    const polish = configInfo.llmDeployment
      ? `polish: ${configInfo.llmDeployment}`
      : 'polish disabled';
    status.textContent = `Ready — Whisper: ${configInfo.whisperDeployment}; ${polish}`;
    status.className = 'ok';
  }
  return configInfo;
}

$('#btn-open-config').addEventListener('click', async () => {
  const result = await window.vaani.openConfig();
  if (!result.ok) toast(result.message || 'Could not open config.json');
});

$('#btn-reload-config').addEventListener('click', async () => {
  await refreshConfigInfo();
  toast(configInfo.ok ? 'Configuration reloaded' : 'Configuration has an error');
});

$('#btn-test').addEventListener('click', async () => {
  const btn = $('#btn-test');
  const out = $('#test-result');
  btn.disabled = true;
  out.className = '';
  out.textContent = 'Testing…';
  clearTimeout(saveTimer);
  settings = await window.vaani.setSettings(readSettingsPatch());
  await refreshConfigInfo();
  const result = await window.vaani.testConnection();
  out.textContent = result.message;
  out.className = result.ok ? 'ok' : 'fail';
  btn.disabled = false;
});

// ---------------- updates ----------------

function showUpdateBanner(version) {
  $('#update-text').textContent = `VaaniFlow ${version} is ready`;
  $('#update-banner').hidden = false;
}

window.vaani.onUpdateReady(showUpdateBanner);
$('#update-install').addEventListener('click', async () => {
  const result = await window.vaani.installUpdate();
  if (!result?.ok) {
    // nothing actually pending (stale banner) — say so instead of doing nothing
    $('#update-banner').hidden = true;
    toast('No update is pending — you are on the latest version.');
  }
});

// ---------------- microphones ----------------

async function populateMics() {
  const select = $('#set-mic');
  try {
    // brief capture so enumerateDevices returns labels
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    stream.getTracks().forEach((t) => t.stop());
    const mics = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
    for (const mic of mics) {
      const opt = document.createElement('option');
      opt.value = mic.deviceId;
      opt.textContent = mic.label || 'Microphone';
      select.appendChild(opt);
    }
  } catch {
    // mic unavailable — leave "System default" only
  }
  // re-apply saved value now that options exist
  if (settings.micDeviceId && [...select.options].some((o) => o.value === settings.micDeviceId)) {
    select.value = settings.micDeviceId;
  }
}

// ---------------- init ----------------

(async function init() {
  const { settings: s, hotkeyLabels, uiohookAvailable } = await window.vaani.getSettings();
  settings = s;
  history = await window.vaani.getHistory();

  const hotkeySelect = $('#set-hotkey');
  for (const [id, label] of Object.entries(hotkeyLabels)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    hotkeySelect.appendChild(opt);
  }

  for (const key of Object.keys(FIELDS)) writeField(key, settings[key]);
  applyAppearance();
  await refreshConfigInfo();

  syncDictionaryEntries();
  appProfiles = Array.isArray(settings.appProfiles) ? settings.appProfiles : [];
  snippets = Array.isArray(settings.snippets) ? settings.snippets : [];
  renderDictionary();
  renderAppProfiles();
  renderSnippets();

  $('#hotkey-fallback').hidden = uiohookAvailable;
  $('#home-hint').textContent = configInfo?.configured
    ? `Hold ${hotkeyLabels[settings.hotkey] || 'your hotkey'} anywhere and speak — everything you dictate lands here.`
    : 'Open config.json from Settings and add your Azure OpenAI deployment details.';

  renderAll();
  populateMics();

  // update may have finished downloading before this window opened
  window.vaani.getUpdateState().then((u) => { if (u.ready) showUpdateBanner(u.version); });

  if (!configInfo?.configured) showView('settings');
})();
