// Local JSON persistence for user settings, Azure configuration, and history.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dictionarySettingsPatch, migrateLegacyDictionary } = require('./dictionary');

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

const CONFIG_DEFAULTS = {
  baseUrl: '',
  apiKey: '',
  apiVersion: '2024-10-21',
  whisperDeployment: '',
  llmDeployment: ''
};

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

class EditableConfig {
  constructor(filePath, seed = {}) {
    this.filePath = filePath;
    this.data = null;
    if (!fs.existsSync(filePath)) this._write({ ...CONFIG_DEFAULTS, ...seed });
    else {
      try { this.load(); } catch { this.data = null; }
    }
  }

  _normalize(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const normalized = {};
    for (const [key, fallback] of Object.entries(CONFIG_DEFAULTS)) {
      const current = source[key];
      normalized[key] = typeof current === 'string' ? current.trim() : fallback;
    }
    if (!normalized.apiVersion) normalized.apiVersion = CONFIG_DEFAULTS.apiVersion;
    return normalized;
  }

  _write(value) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const normalized = this._normalize(value);
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2) + '\n');
    fs.renameSync(tmp, this.filePath);
    this.data = normalized;
    return normalized;
  }

  load() {
    if (!fs.existsSync(this.filePath)) return this._write(CONFIG_DEFAULTS);
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('the root value must be a JSON object');
      }
      this.data = this._normalize(parsed);
      return this.data;
    } catch (err) {
      throw new ConfigurationError(`Could not read config.json: ${err.message}`);
    }
  }

  info() {
    const config = this.load();
    const missing = [];
    if (!config.baseUrl) missing.push('baseUrl');
    if (!config.apiKey) missing.push('apiKey');
    if (!config.whisperDeployment) missing.push('whisperDeployment');
    return {
      path: this.filePath,
      configured: missing.length === 0,
      missing,
      whisperDeployment: config.whisperDeployment,
      llmDeployment: config.llmDeployment,
      apiVersion: config.apiVersion
    };
  }
}

const SETTINGS_DEFAULTS = {
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
  dictionarySchemaVersion: 0,
  dictionaryEntries: [], // [{ id, from, to, starred, source, createdAt }]
  vocabulary: '',
  replacements: [], // [{ from, to }] applied to transcripts after transcription
  spokenCommands: true, // "new line", "period", "scratch that"
  autoStopSec: 8, // end hands-free after this much silence (0 = never)
  polishEnabled: true,
  polishTimeoutSec: 8, // polish deadline; on timeout the raw transcript is pasted
  defaultTone: 'neutral',
  autoTone: true, // auto-adapt tone to the target app (email/chat/AI prompt/code/docs)
  appProfiles: [], // [{ match, tone }] — tone override when foreground app matches
  snippets: [], // [{ trigger, text }] — say the trigger, get the text
  styleInstructions: '', // free-text writing style for the polish stage
  windowTransparency: 0, // 0–70% acrylic see-through on the dashboard (0 = solid)
  accentColor: '#e8e9eb', // primary color for buttons, toggles, charts, heatmap
  autoLearnVocabulary: true, // auto-import repeated proper nouns/acronyms
  dictionarySuggestions: {}, // internal candidate counts kept for auto-learning
  dictionaryDismissed: [] // legacy rejected candidates
};

const LEGACY_CONFIG_KEYS = [
  'transcriptionProvider',
  'baseUrl',
  'apiKey',
  'model',
  'azureApiVersion',
  'chatModel',
  'polishBaseUrl',
  'polishApiKey'
];

class Store {
  constructor(userDataDir) {
    this.settingsFile = new JsonFile(path.join(userDataDir, 'settings.json'), SETTINGS_DEFAULTS);
    this.historyFile = new JsonFile(path.join(userDataDir, 'history.json'), []);

    const legacy = this.settingsFile.data;
    this.configFile = new EditableConfig(path.join(userDataDir, 'config.json'), {
      baseUrl: String(legacy.baseUrl || ''),
      apiKey: String(legacy.apiKey || ''),
      apiVersion: String(legacy.azureApiVersion || CONFIG_DEFAULTS.apiVersion),
      whisperDeployment: String(legacy.model || ''),
      llmDeployment: String(legacy.chatModel || '')
    });

    let migrated = false;
    for (const key of LEGACY_CONFIG_KEYS) {
      if (Object.prototype.hasOwnProperty.call(this.settingsFile.data, key)) {
        delete this.settingsFile.data[key];
        migrated = true;
      }
    }
    const dictionaryMigration = migrateLegacyDictionary(this.settingsFile.data);
    if (dictionaryMigration.changed) {
      Object.assign(this.settingsFile.data, dictionaryMigration.patch);
      migrated = true;
    }
    if (migrated) this.settingsFile.flush();
  }

  get settings() {
    return this.settingsFile.data;
  }

  updateSettings(patch) {
    const nextPatch = patch && typeof patch === 'object' ? { ...patch } : {};
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'dictionaryEntries')) {
      Object.assign(nextPatch, dictionarySettingsPatch(nextPatch.dictionaryEntries));
    }
    Object.assign(this.settingsFile.data, nextPatch);
    this.settingsFile.save();
    return this.settingsFile.data;
  }

  runtimeSettings() {
    const config = this.configFile.load();
    return {
      ...this.settings,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      azureApiVersion: config.apiVersion,
      model: config.whisperDeployment,
      chatModel: config.llmDeployment
    };
  }

  configInfo() {
    return this.configFile.info();
  }

  get configPath() {
    return this.configFile.filePath;
  }

  ensureConfigFile() {
    if (!fs.existsSync(this.configPath)) this.configFile.load();
    return this.configPath;
  }

  get history() {
    return this.historyFile.data;
  }

  addTranscript({ text, durationMs, mode, app, polished, latency, raw }) {
    const entry = {
      id: crypto.randomUUID(),
      text,
      ts: Date.now(),
      durationMs: Math.round(durationMs || 0),
      words: text.split(/\s+/).filter(Boolean).length,
      mode: mode || 'ptt',
      app: app || '',
      polished: !!polished,
      ...(latency ? { latency } : {}), // per-stage ms
      ...(raw ? { raw: String(raw).slice(0, 4000) } : {}) // pre-polish text, for the "fixed words" insight
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

module.exports = {
  Store,
  SETTINGS_DEFAULTS,
  CONFIG_DEFAULTS,
  EditableConfig,
  ConfigurationError
};
