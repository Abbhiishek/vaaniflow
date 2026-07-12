'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store');

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
