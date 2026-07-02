// Tiny JSON-file persistence for settings + transcript history. No deps.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class JsonFile {
  constructor(filePath, fallback) {
    this.filePath = filePath;
    this.fallback = fallback;
    this._saveTimer = null;
    this.data = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(this.fallback) ? parsed : { ...this.fallback, ...parsed };
    } catch {
      return Array.isArray(this.fallback) ? [...this.fallback] : { ...this.fallback };
    }
  }

  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    clearTimeout(this._saveTimer);
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('store: failed to write', this.filePath, err.message);
    }
  }
}

const SETTINGS_DEFAULTS = {
  baseUrl: '',
  apiKey: '',
  model: 'whisper-1',
  language: 'auto',
  hotkey: 'ctrl+win',
  micDeviceId: 'default',
  autoPaste: true,
  restoreClipboard: false,
  sounds: true,
  compensateSpace: true,
  launchAtLogin: false,
  timeoutSec: 60,
  fastMode: true,
  vocabulary: '',
  replacements: [], // [{ from, to }] applied to transcripts after transcription
  spokenCommands: true, // "new line", "period", "scratch that"
  autoStopSec: 8, // end hands-free after this much silence (0 = never)
  chatModel: '', // LocalAI chat model for the polish stage ('' = disabled)
  polishEnabled: true,
  defaultTone: 'neutral',
  appProfiles: [], // [{ match, tone }] — tone override when foreground app matches
  snippets: [] // [{ trigger, text }] — say the trigger, get the text
};

class Store {
  constructor(userDataDir) {
    this.settingsFile = new JsonFile(path.join(userDataDir, 'settings.json'), SETTINGS_DEFAULTS);
    this.historyFile = new JsonFile(path.join(userDataDir, 'history.json'), []);
  }

  get settings() {
    return this.settingsFile.data;
  }

  updateSettings(patch) {
    Object.assign(this.settingsFile.data, patch);
    this.settingsFile.save();
    return this.settingsFile.data;
  }

  get history() {
    return this.historyFile.data;
  }

  addTranscript({ text, durationMs, mode, app, polished }) {
    const entry = {
      id: crypto.randomUUID(),
      text,
      ts: Date.now(),
      durationMs: Math.round(durationMs || 0),
      words: text.split(/\s+/).filter(Boolean).length,
      mode: mode || 'ptt',
      app: app || '',
      polished: !!polished
    };
    this.historyFile.data.unshift(entry);
    if (this.historyFile.data.length > 5000) this.historyFile.data.length = 5000;
    this.historyFile.save();
    return entry;
  }

  deleteTranscript(id) {
    const i = this.historyFile.data.findIndex((e) => e.id === id);
    if (i >= 0) this.historyFile.data.splice(i, 1);
    this.historyFile.save();
  }

  clearHistory() {
    this.historyFile.data.length = 0;
    this.historyFile.save();
  }

  flush() {
    this.settingsFile.flush();
    this.historyFile.flush();
  }
}

module.exports = { Store, SETTINGS_DEFAULTS };
