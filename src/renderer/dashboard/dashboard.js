'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let settings = {};
let history = [];
let saveTimer = null;

// ---------------- navigation ----------------

function showView(name) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  $(`#view-${name}`).classList.add('active');
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
}

$$('.nav-item').forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.view)));
$$('[data-goto]').forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.goto)));

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

// ---------------- rendering: transcripts ----------------

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

function renderRecent() {
  const list = $('#recent-list');
  list.innerHTML = '';
  const recent = history.slice(0, 5);
  $('#home-empty').hidden = recent.length > 0;
  recent.forEach((e) => list.appendChild(transcriptCard(e)));
}

function renderHistory() {
  const list = $('#history-list');
  const q = $('#search').value.trim().toLowerCase();
  list.innerHTML = '';
  const filtered = q ? history.filter((e) => e.text.toLowerCase().includes(q)) : history;
  $('#history-empty').hidden = filtered.length > 0;

  let lastDay = null;
  for (const entry of filtered) {
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

function renderStats() {
  const totalWords = history.reduce((n, e) => n + e.words, 0);
  const totalMs = history.reduce((n, e) => n + e.durationMs, 0);
  $('#stat-words').textContent = totalWords.toLocaleString();
  $('#stat-count').textContent = history.length.toLocaleString();
  $('#stat-wpm').textContent = totalMs > 3000 ? Math.round(totalWords / (totalMs / 60000)) : '–';

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
  const top = [...byApp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
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

function renderAll() {
  renderStats();
  renderChart();
  renderTopApps();
  renderRecent();
  renderHistory();
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

// ---------------- settings ----------------

const FIELDS = {
  baseUrl: { el: '#set-baseUrl', type: 'text' },
  apiKey: { el: '#set-apiKey', type: 'text' },
  model: { el: '#set-model', type: 'text' },
  language: { el: '#set-language', type: 'select' },
  micDeviceId: { el: '#set-mic', type: 'select' },
  hotkey: { el: '#set-hotkey', type: 'select' },
  vocabulary: { el: '#set-vocabulary', type: 'text' },
  chatModel: { el: '#set-chatModel', type: 'text' },
  defaultTone: { el: '#set-defaultTone', type: 'select' },
  polishEnabled: { el: '#set-polishEnabled', type: 'bool' },
  fastMode: { el: '#set-fastMode', type: 'bool' },
  spokenCommands: { el: '#set-spokenCommands', type: 'bool' },
  autoStopSec: { el: '#set-autoStopSec', type: 'select' },
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

function scheduleSave(key) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const patch = {};
    for (const k of Object.keys(FIELDS)) patch[k] = readField(k);
    patch.baseUrl = patch.baseUrl.trim();
    patch.apiKey = patch.apiKey.trim();
    patch.model = patch.model.trim() || 'whisper-1';
    patch.chatModel = patch.chatModel.trim();
    patch.autoStopSec = Number(patch.autoStopSec) || 0;
    settings = await window.vaani.setSettings(patch);
  }, ['baseUrl', 'apiKey', 'model', 'chatModel', 'vocabulary'].includes(key) ? 500 : 0);
}

for (const key of Object.keys(FIELDS)) {
  const node = $(FIELDS[key].el);
  node.addEventListener(FIELDS[key].type === 'text' ? 'input' : 'change', () => scheduleSave(key));
}

// ---------------- list editors (corrections / tone profiles / snippets) ----------------

let replacements = [];
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
    preview.textContent = sn.text.length > 120 ? sn.text.slice(0, 120) + '…' : sn.text;
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

function renderReplacements() {
  const list = $('#repl-list');
  list.innerHTML = '';
  replacements.forEach((rule, i) => {
    const row = document.createElement('div');
    row.className = 'repl-row';

    const from = document.createElement('span');
    from.className = 'repl-text';
    from.textContent = rule.from;

    const arrow = document.createElement('span');
    arrow.className = 'repl-arrow';
    arrow.textContent = '→';

    const to = document.createElement('span');
    to.className = 'repl-text';
    to.textContent = rule.to || '(remove)';

    const del = document.createElement('button');
    del.className = 'icon-btn delete';
    del.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>';
    del.addEventListener('click', async () => {
      replacements.splice(i, 1);
      settings = await window.vaani.setSettings({ replacements });
      renderReplacements();
    });

    row.append(from, arrow, to, del);
    list.appendChild(row);
  });
}

async function addReplacement() {
  const fromEl = $('#repl-from');
  const toEl = $('#repl-to');
  const from = fromEl.value.trim();
  if (!from) return;
  replacements.push({ from, to: toEl.value.trim() });
  settings = await window.vaani.setSettings({ replacements });
  fromEl.value = '';
  toEl.value = '';
  fromEl.focus();
  renderReplacements();
}

$('#repl-add-btn').addEventListener('click', addReplacement);
$('#repl-to').addEventListener('keydown', (e) => { if (e.key === 'Enter') addReplacement(); });

$('#btn-test').addEventListener('click', async () => {
  const btn = $('#btn-test');
  const out = $('#test-result');
  btn.disabled = true;
  out.className = '';
  out.textContent = 'Testing…';
  clearTimeout(saveTimer);
  const patch = {};
  for (const k of Object.keys(FIELDS)) patch[k] = readField(k);
  settings = await window.vaani.setSettings(patch); // make sure current values are used
  const result = await window.vaani.testConnection();
  out.textContent = result.message;
  out.className = result.ok ? 'ok' : 'fail';
  btn.disabled = false;
});

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

// ---------------- updates ----------------

function showUpdateBanner(version) {
  $('#update-text').textContent = `VaaniFlow ${version} is ready`;
  $('#update-banner').hidden = false;
}

window.vaani.onUpdateReady(showUpdateBanner);
$('#update-install').addEventListener('click', () => window.vaani.installUpdate());

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

  replacements = Array.isArray(settings.replacements) ? settings.replacements : [];
  appProfiles = Array.isArray(settings.appProfiles) ? settings.appProfiles : [];
  snippets = Array.isArray(settings.snippets) ? settings.snippets : [];
  renderReplacements();
  renderAppProfiles();
  renderSnippets();

  $('#hotkey-fallback').hidden = uiohookAvailable;
  $('#home-hint').textContent = settings.baseUrl
    ? `Hold ${hotkeyLabels[settings.hotkey] || 'your hotkey'} anywhere and speak.`
    : 'Set your Whisper server URL in Settings to get started.';

  renderAll();
  populateMics();

  // update may have finished downloading before this window opened
  window.vaani.getUpdateState().then((s) => { if (s.ready) showUpdateBanner(s.version); });

  if (!settings.baseUrl) showView('settings');
})();
