'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, SETTINGS_SCHEMA_VERSION } = require('../src/main/store');

function tempUserData(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaaniflow-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('creates config.json and migrates legacy connection settings', (t) => {
  const dir = tempUserData(t);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    baseUrl: 'https://speech.openai.azure.com',
    apiKey: 'secret',
    azureApiVersion: '2024-10-21',
    model: 'whisper-prod',
    chatModel: 'gpt40'
  }));

  const store = new Store(dir);
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.deepEqual(config, {
    baseUrl: 'https://speech.openai.azure.com',
    apiKey: 'secret',
    apiVersion: '2024-10-21',
    whisperDeployment: 'whisper-prod',
    llmDeployment: 'gpt40'
  });
  assert.equal(store.settings.apiKey, undefined);
  assert.equal(store.settings.model, undefined);
});

test('reloads config.json edits for each runtime settings request', (t) => {
  const dir = tempUserData(t);
  const store = new Store(dir);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    baseUrl: 'https://speech.openai.azure.com',
    apiKey: 'new-secret',
    apiVersion: '2024-10-21',
    whisperDeployment: 'whisper-v2',
    llmDeployment: 'gpt40'
  }));

  const runtime = store.runtimeSettings();
  assert.equal(runtime.apiKey, 'new-secret');
  assert.equal(runtime.model, 'whisper-v2');
  assert.equal(runtime.chatModel, 'gpt40');
});

test('updates provider configuration through the store', (t) => {
  const dir = tempUserData(t);
  const store = new Store(dir);
  store.updateConfig({
    baseUrl: 'https://provider.example.com',
    apiKey: 'local-key',
    whisperDeployment: 'speech-prod',
    llmDeployment: 'language-prod'
  });

  assert.deepEqual(store.getConfig(), {
    baseUrl: 'https://provider.example.com',
    apiKey: 'local-key',
    apiVersion: '2024-10-21',
    whisperDeployment: 'speech-prod',
    llmDeployment: 'language-prod'
  });
});

test('provider updates can repair an invalid config file', (t) => {
  const dir = tempUserData(t);
  const store = new Store(dir);
  fs.writeFileSync(path.join(dir, 'config.json'), '{ invalid json');
  assert.doesNotThrow(() => store.updateConfig({
    baseUrl: 'https://provider.example.com',
    apiKey: 'local-key',
    whisperDeployment: 'speech-prod'
  }));
  assert.equal(store.getConfig().whisperDeployment, 'speech-prod');
});

test('surfaces invalid config JSON without preventing Store construction', (t) => {
  const dir = tempUserData(t);
  const store = new Store(dir);
  fs.writeFileSync(path.join(dir, 'config.json'), '{ invalid json');
  assert.throws(() => store.runtimeSettings(), /Could not read config\.json/);
});

test('migrates the legacy vocabulary and corrections into dictionary entries', (t) => {
  const dir = tempUserData(t);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    vocabulary: 'Abhishek, Vaani',
    replacements: [{ from: 'BTW', to: 'by the way' }]
  }));

  const store = new Store(dir);
  assert.equal(store.settings.dictionarySchemaVersion, 1);
  assert.deepEqual(
    store.settings.dictionaryEntries.map(({ from, to }) => ({ from, to })),
    [
      { from: 'Abhishek', to: 'Abhishek' },
      { from: 'Vaani', to: 'Vaani' },
      { from: 'BTW', to: 'by the way' }
    ]
  );
});

test('repairs persisted dictionary entries that have no stable IDs', (t) => {
  const dir = tempUserData(t);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    dictionarySchemaVersion: 1,
    dictionaryEntries: [
      { from: 'Vaani', to: 'Vaani', starred: false },
      { from: 'BTW', to: 'by the way', starred: true }
    ]
  }));

  const store = new Store(dir);
  const ids = store.settings.dictionaryEntries.map((entry) => entry.id);
  assert.equal(ids.every(Boolean), true);
  assert.equal(new Set(ids).size, ids.length);

  const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.deepEqual(persisted.dictionaryEntries.map((entry) => entry.id), ids);
});

test('provides defaults for per-category styles and global cleanup', (t) => {
  const store = new Store(tempUserData(t));
  assert.equal(store.settings.personalStyle, 'casual');
  assert.equal(store.settings.workStyle, 'casual');
  assert.equal(store.settings.emailStyle, 'formal');
  assert.equal(store.settings.otherStyle, 'formal');
  assert.equal(store.settings.cleanupLevel, 'light');
});

test('saved account profile survives a full store restart', (t) => {
  const dir = tempUserData(t);
  const store = new Store(dir);
  store.updateSettings({
    profileFirstName: 'Abhishek',
    profileLastName: 'Kushwaha',
    profileEmail: 'abhishek@example.com',
    profilePicture: 'data:image/jpeg;base64,local-profile'
  }, { flush: true });

  const restarted = new Store(dir);
  assert.equal(restarted.settings.profileFirstName, 'Abhishek');
  assert.equal(restarted.settings.profileLastName, 'Kushwaha');
  assert.equal(restarted.settings.profileEmail, 'abhishek@example.com');
  assert.equal(restarted.settings.profilePicture, 'data:image/jpeg;base64,local-profile');
});

test('custom shortcut survives a full store restart', (t) => {
  const dir = tempUserData(t);
  const store = new Store(dir);
  store.updateSettings({ hotkey: 'custom:Alt+KeyV' }, { flush: true });
  assert.equal(new Store(dir).settings.hotkey, 'custom:Alt+KeyV');
});

test('versions settings migrations and preserves a pre-migration backup', (t) => {
  const dir = tempUserData(t);
  const settingsPath = path.join(dir, 'settings.json');
  const legacy = JSON.stringify({ hotkey: 'ctrl+win', vocabulary: 'Vaani' }, null, 2);
  fs.writeFileSync(settingsPath, legacy);

  const store = new Store(dir);
  assert.equal(store.settings.settingsSchemaVersion, SETTINGS_SCHEMA_VERSION);

  const backupPath = path.join(dir, 'settings.v0.backup.json');
  assert.equal(fs.readFileSync(backupPath, 'utf8'), legacy);

  const firstBackupMtime = fs.statSync(backupPath).mtimeMs;
  new Store(dir);
  assert.equal(fs.statSync(backupPath).mtimeMs, firstBackupMtime);
});
